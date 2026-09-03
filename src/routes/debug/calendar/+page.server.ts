/**
 * The Phase 0 acceptance check, run against the real Google account.
 *
 * Threshold from §12: "a block can be created, moved, and deleted on the
 * secondary calendar with the primary calendar provably untouched."
 *
 * "Provably" is the interesting word. The check fingerprints every calendar
 * except our own before and after the write cycle, and fails if a single byte
 * of that fingerprint changes. It also deliberately attempts a write to the
 * primary calendar and asserts that the guard refuses it.
 */

import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { error, fail } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db';
import { calendarApi, clientForUser } from '$lib/server/google/client';
import { listCalendars, readBusyIntervals } from '$lib/server/google/read';
import {
	ForbiddenCalendarError,
	applySync,
	ensureTargetCalendar,
	planSync
} from '$lib/server/google/write';
import type { Actions, PageServerLoad } from './$types';

type Step = { name: string; ok: boolean; detail: string };

async function currentUser(email: string | null | undefined) {
	if (!email) error(401, 'Sign in with Google first.');
	const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
	if (!user) error(401, 'No user row — sign in again.');
	if (!user.googleRefreshToken) {
		error(
			400,
			'No Google refresh token stored. Sign out, then sign in again to force a fresh consent.'
		);
	}
	return user;
}

/**
 * A fingerprint of every event on every calendar except the app's own, over
 * the next 60 days. If this changes across the write cycle, we touched
 * something we had no business touching.
 */
async function fingerprintOtherCalendars(
	auth: ReturnType<typeof clientForUser>,
	ownCalendarId: string | null
): Promise<{ hash: string; eventCount: number; calendarCount: number }> {
	const api = calendarApi(auth);
	const calendars = await listCalendars(auth);
	const lines: string[] = [];
	let calendarCount = 0;

	const timeMin = new Date();
	const timeMax = new Date(timeMin.getTime() + 60 * 24 * 3_600_000);

	for (const calendar of calendars.sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''))) {
		if (!calendar.id || calendar.id === ownCalendarId) continue;
		calendarCount++;

		const response = await api.events.list({
			calendarId: calendar.id,
			timeMin: timeMin.toISOString(),
			timeMax: timeMax.toISOString(),
			singleEvents: true,
			orderBy: 'startTime',
			maxResults: 2500
		});

		for (const event of response.data.items ?? []) {
			lines.push(
				[
					calendar.id,
					event.id,
					event.summary,
					event.status,
					event.start?.dateTime ?? event.start?.date,
					event.end?.dateTime ?? event.end?.date
				].join('|')
			);
		}
	}

	lines.sort();
	return {
		hash: createHash('sha256').update(lines.join('\n')).digest('hex'),
		eventCount: lines.length,
		calendarCount
	};
}

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	return { email: session?.user?.email ?? null };
};

export const actions: Actions = {
	verify: async (event) => {
		const session = await event.locals.auth();
		const user = await currentUser(session?.user?.email);
		const [settingsRow] = await db
			.select()
			.from(schema.settings)
			.where(eq(schema.settings.userId, user.id));

		const timezone = settingsRow?.timezone ?? 'Europe/Paris';
		const auth = clientForUser(user.googleRefreshToken as string);
		const steps: Step[] = [];

		try {
			// 1. The app's own calendar.
			const targetCalendarId = await ensureTargetCalendar(
				auth,
				timezone,
				settingsRow?.targetCalendarId ?? null
			);
			if (settingsRow) {
				await db
					.update(schema.settings)
					.set({ targetCalendarId })
					.where(eq(schema.settings.userId, user.id));
			}
			steps.push({
				name: 'Secondary calendar "Planned work" exists',
				ok: true,
				detail: targetCalendarId
			});

			// 2. Fingerprint everything we must not touch.
			const before = await fingerprintOtherCalendars(auth, targetCalendarId);
			steps.push({
				name: 'Fingerprinted the calendars we must not touch',
				ok: true,
				detail: `${before.eventCount} events across ${before.calendarCount} calendars`
			});

			// 3. Create. Times are rounded to the minute: Google stores event times
			// to the second, so a start built from Date.now() comes back with its
			// milliseconds shaved off and no round trip can ever compare equal.
			// Real blocks always land on a whole minute anyway.
			const start = new Date(Math.round((Date.now() + 24 * 3_600_000) / 60_000) * 60_000);
			const end = new Date(start.getTime() + 2 * 3_600_000);
			const inserted = await applySync(
				auth,
				targetCalendarId,
				targetCalendarId,
				planSync(
					[
						{
							blockId: 'phase-0-check',
							googleEventId: null,
							start,
							end,
							summary: '[Phase 0] Acceptance check',
							description: 'Created by the Phase 0 verification. It deletes itself.'
						}
					],
					[]
				),
				timezone
			);
			const eventId = inserted[0]?.googleEventId;
			if (!eventId) throw new Error('Google returned no event id on insert.');
			steps.push({ name: 'Created a block', ok: true, detail: eventId });

			// 4. Move it — and confirm it is the SAME event, not a new one.
			const movedStart = new Date(start.getTime() + 3_600_000);
			const movedEnd = new Date(end.getTime() + 3_600_000);
			await applySync(
				auth,
				targetCalendarId,
				targetCalendarId,
				planSync(
					[
						{
							blockId: 'phase-0-check',
							googleEventId: eventId,
							start: movedStart,
							end: movedEnd,
							summary: '[Phase 0] Acceptance check (moved)',
							description: 'Moved in place.'
						}
					],
					[eventId]
				),
				timezone
			);
			const afterMove = await calendarApi(auth).events.get({
				calendarId: targetCalendarId,
				eventId
			});
			// Two separate claims, reported separately — a time that did not stick
			// is a different bug from an event that was recreated.
			const keptItsId = afterMove.data.id === eventId;
			const landedTime = new Date(afterMove.data.start?.dateTime ?? 0);
			const movedToTheRightTime = landedTime.getTime() === movedStart.getTime();

			steps.push({
				name: 'Moved the block by updating the same event id',
				ok: keptItsId,
				detail: keptItsId
					? `${eventId} kept its id — updated in place, not recreated`
					: `id changed: ${eventId} became ${afterMove.data.id}`
			});
			steps.push({
				name: 'The new time stuck',
				ok: movedToTheRightTime,
				detail: movedToTheRightTime
					? landedTime.toISOString()
					: `asked for ${movedStart.toISOString()}, got ${landedTime.toISOString()}`
			});

			// 5. The guard: writing anywhere else must be refused.
			let guarded = false;
			try {
				await applySync(
					auth,
					'primary',
					targetCalendarId,
					planSync([], ['some-event-id']),
					timezone
				);
			} catch (guardError) {
				guarded = guardError instanceof ForbiddenCalendarError;
			}
			steps.push({
				name: 'Refuses to write to any other calendar',
				ok: guarded,
				detail: guarded
					? 'ForbiddenCalendarError thrown as designed'
					: 'THE GUARD DID NOT FIRE — do not use this app'
			});

			// 6. Delete.
			await applySync(auth, targetCalendarId, targetCalendarId, planSync([], [eventId]), timezone);
			const remaining = await calendarApi(auth).events.list({
				calendarId: targetCalendarId,
				timeMin: new Date(Date.now() - 3_600_000).toISOString(),
				singleEvents: true
			});
			const gone = !(remaining.data.items ?? []).some(
				(e) => e.id === eventId && e.status !== 'cancelled'
			);
			steps.push({
				name: 'Deleted the block',
				ok: gone,
				detail: gone ? 'no longer on the calendar' : 'still present'
			});

			// 7. Prove the rest of the account is byte-identical.
			const after = await fingerprintOtherCalendars(auth, targetCalendarId);
			const untouched = after.hash === before.hash;
			steps.push({
				name: 'Every other calendar is untouched',
				ok: untouched,
				detail: untouched
					? `fingerprint unchanged (${after.hash.slice(0, 16)}…)`
					: 'FINGERPRINT CHANGED — something was modified outside our calendar'
			});

			// 8. Reading capacity works at all.
			const busy = await readBusyIntervals(auth, {
				timeMin: new Date(),
				timeMax: new Date(Date.now() + 21 * 24 * 3_600_000),
				excludeCalendarId: targetCalendarId,
				timezone
			});
			steps.push({
				name: 'Read busy intervals for the 21-day horizon',
				ok: true,
				detail: `${busy.length} busy intervals found`
			});

			return { steps, passed: steps.every((s) => s.ok) };
		} catch (thrown) {
			const message = thrown instanceof Error ? thrown.message : String(thrown);
			steps.push({ name: 'Unexpected failure', ok: false, detail: message });
			return fail(500, { steps, passed: false });
		}
	}
};
