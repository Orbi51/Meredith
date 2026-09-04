/**
 * Adopting work that already lives in Google Calendar.
 *
 * The user schedules real work by hand — "N3dge - Textures and materials" —
 * and wants it visible here rather than in a second place they have to
 * remember to check. Those events become tasks, automatically.
 *
 * Three rules make this safe:
 *
 * 1. **The event is never touched.** It stays on the user's own calendar, at
 *    its own time. We mirror it as a block marked `external`, which a replan
 *    will never move, rewrite or delete. The Phase 0 guarantee — this app
 *    writes to exactly one calendar, its own — is unaffected.
 *
 * 2. **Adopted work is never scheduled again.** Its time is already booked.
 *    Feeding the task to the scheduler as well would reserve a second slot for
 *    work that is already in the diary.
 *
 * 3. **Only work is adopted, not appointments.** A dentist appointment is
 *    capacity being consumed, not a task. The signal is the user's own naming
 *    convention: "Project - task". Anything else stays pure capacity.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from './db';
import type { CalendarAppointment } from './google/read';
import { parseStructured } from './parse/structured';
import { detectKind } from './parse/deterministic';
import { latestWorkingHour } from './db/queries';
import type { ProjectRow } from './db/queries';

/**
 * Does this event look like work the user scheduled for themselves?
 *
 * The spaced dash is their own convention for "Project - task", and it is a
 * good discriminator in practice: work blocks match, while "Rendez-vous chez
 * Dr Renaud BERQUET" and "Morning Planning" do not.
 */
export function looksLikeWork(appointment: CalendarAppointment): boolean {
	// An all-day event is a marker for a day, not a block of work.
	if (appointment.allDay) return false;
	return /\s+[-–—]\s+/.test(appointment.summary);
}

export type AdoptionResult = {
	adopted: number;
	updated: number;
	skippedIgnored: number;
};

/**
 * Bring calendar work into the app, idempotently.
 *
 * Running twice changes nothing: each event is adopted at most once, keyed by
 * its Google event id. An event that has since moved has its mirrored block
 * moved to match.
 */
export async function adoptCalendarWork(
	userId: string,
	appointments: CalendarAppointment[],
	projects: ProjectRow[],
	timezone: string,
	now: Date
): Promise<AdoptionResult> {
	const candidates = appointments.filter(looksLikeWork);
	if (candidates.length === 0) return { adopted: 0, updated: 0, skippedIgnored: 0 };

	const eventIds = candidates.map((a) => a.eventId);

	// Events the user has already dismissed. Bringing them back would make
	// "remove from the app" meaningless.
	const ignored = new Set(
		(
			await db
				.select({ id: schema.ignoredEvents.googleEventId })
				.from(schema.ignoredEvents)
				.where(
					and(
						eq(schema.ignoredEvents.userId, userId),
						inArray(schema.ignoredEvents.googleEventId, eventIds)
					)
				)
		).map((row) => row.id)
	);

	const existing = await db
		.select()
		.from(schema.tasks)
		.where(
			and(eq(schema.tasks.userId, userId), inArray(schema.tasks.sourceEventId, eventIds))
		);
	const existingByEvent = new Map(existing.map((task) => [task.sourceEventId as string, task]));

	const choices = projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName }));
	const endOfDay = await latestWorkingHour(userId);
	const result: AdoptionResult = { adopted: 0, updated: 0, skippedIgnored: 0 };

	for (const appointment of candidates) {
		if (ignored.has(appointment.eventId)) {
			result.skippedIgnored++;
			continue;
		}

		const hours = (appointment.end.getTime() - appointment.start.getTime()) / 3_600_000;
		const already = existingByEvent.get(appointment.eventId);

		if (already) {
			// The event may have been moved or retitled in Google since we adopted
			// it. Google is the authority for an event we do not own.
			await moveMirroredBlock(userId, already.id, appointment);
			result.updated++;
			continue;
		}

		// The title follows the same dash convention the quick-add parser knows,
		// so reuse it rather than inventing a second way to read the same thing.
		const parsed = parseStructured(appointment.summary, {
			projects: choices,
			timezone,
			now,
			endOfDay: endOfDay ?? undefined
		});

		const [task] = await db
			.insert(schema.tasks)
			.values({
				userId,
				title: parsed.title,
				projectId: parsed.projectId,
				// The event's own length is the estimate — it is what the user set
				// aside for the job, which is a better number than any guess.
				estimateHours: Math.round(hours * 100) / 100,
				deadline: parsed.deadline,
				kind: detectKind(appointment.summary)?.value ?? parsed.kind,
				status: 'active',
				source: 'calendar',
				sourceEventId: appointment.eventId,
				notes: parsed.unmatchedProjectName
					? `From calendar. Project "${parsed.unmatchedProjectName}" is not set up here yet.`
					: 'From calendar.'
			})
			.returning();

		if (!task) continue;

		await db.insert(schema.blocks).values({
			userId,
			taskId: task.id,
			start: appointment.start,
			end: appointment.end,
			// No googleEventId: that column means "an event WE created and may
			// delete". This block mirrors someone else's event and must never be
			// handed to the sync.
			googleEventId: null,
			status: 'planned',
			pool: 'human',
			source: 'external'
		});

		result.adopted++;
	}

	return result;
}

/** Keep the mirrored block in step with an event that moved in Google. */
async function moveMirroredBlock(
	userId: string,
	taskId: string,
	appointment: CalendarAppointment
) {
	const [block] = await db
		.select()
		.from(schema.blocks)
		.where(
			and(
				eq(schema.blocks.userId, userId),
				eq(schema.blocks.taskId, taskId),
				eq(schema.blocks.source, 'external')
			)
		);

	if (!block) return;
	if (
		block.start.getTime() === appointment.start.getTime() &&
		block.end.getTime() === appointment.end.getTime()
	) {
		return;
	}

	// A block the user has already confirmed is history; moving it would
	// rewrite what actually happened.
	if (block.status !== 'planned') return;

	await db
		.update(schema.blocks)
		.set({ start: appointment.start, end: appointment.end })
		.where(eq(schema.blocks.id, block.id));
}

/**
 * Remove an adopted task from the app without touching Google Calendar.
 *
 * The event id is remembered so the next automatic import does not simply
 * bring it back.
 */
export async function dismissAdoptedTask(userId: string, taskId: string): Promise<boolean> {
	const [task] = await db
		.select()
		.from(schema.tasks)
		.where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, taskId)));

	if (!task || task.source !== 'calendar' || !task.sourceEventId) return false;

	await db
		.insert(schema.ignoredEvents)
		.values({ userId, googleEventId: task.sourceEventId })
		.onConflictDoNothing();

	// Blocks cascade with the task. Nothing here reaches Google: the mirrored
	// block carries no googleEventId, so the sync has never known about it.
	await db.delete(schema.tasks).where(eq(schema.tasks.id, task.id));
	return true;
}
