/**
 * Writing planned blocks to Google Calendar.
 *
 * Two rules, both enforced here rather than left to discipline:
 *
 * 1. We write ONLY to the app's own secondary calendar. Every mutating call
 *    goes through `assertOwnCalendar`, so a bug elsewhere cannot delete a real
 *    appointment.
 * 2. We diff, we do not wipe. Events are updated in place by their stored id.
 *    Delete-all-and-recreate would reset notification state on every replan and
 *    hammer the API for no benefit.
 */

import type { OAuth2Client } from 'google-auth-library';
import { calendarApi } from './client';

export const TARGET_CALENDAR_NAME = 'Planned work';

export class ForbiddenCalendarError extends Error {
	constructor(attemptedCalendarId: string, ownCalendarId: string) {
		super(
			`Refusing to write to calendar "${attemptedCalendarId}". ` +
				`This app only ever writes to its own calendar ("${ownCalendarId}").`
		);
		this.name = 'ForbiddenCalendarError';
	}
}

function assertOwnCalendar(calendarId: string, ownCalendarId: string | null): asserts ownCalendarId {
	if (!ownCalendarId) {
		throw new Error('No target calendar configured. Run ensureTargetCalendar first.');
	}
	if (calendarId !== ownCalendarId) {
		throw new ForbiddenCalendarError(calendarId, ownCalendarId);
	}
}

/**
 * Find or create the secondary calendar. Idempotent: a second run reuses the
 * existing one rather than creating "Planned work" twice.
 */
export async function ensureTargetCalendar(
	auth: OAuth2Client,
	timezone: string,
	existingId: string | null
): Promise<string> {
	const api = calendarApi(auth);

	if (existingId) {
		try {
			const existing = await api.calendars.get({ calendarId: existingId });
			if (existing.data.id) return existing.data.id;
		} catch {
			// Deleted on the Google side — fall through and make a new one.
		}
	}

	const list = await api.calendarList.list({ maxResults: 250 });
	const found = list.data.items?.find((c) => c.summary === TARGET_CALENDAR_NAME);
	if (found?.id) return found.id;

	const created = await api.calendars.insert({
		requestBody: {
			summary: TARGET_CALENDAR_NAME,
			description: 'Work blocks planned automatically. Edits here are overwritten on replan.',
			timeZone: timezone
		}
	});

	if (!created.data.id) throw new Error('Google did not return an id for the new calendar.');
	return created.data.id;
}

/** A block as the app wants Google to hold it. */
export type DesiredEvent = {
	blockId: string;
	/** null for a block that has never been written to Google. */
	googleEventId: string | null;
	start: Date;
	end: Date;
	summary: string;
	description: string;
	/** Google colour id, derived from the project colour. */
	colorId?: string;
};

export type SyncPlan = {
	insert: DesiredEvent[];
	update: DesiredEvent[];
	/** Google event ids no longer backed by a block. */
	remove: string[];
};

/**
 * Work out the minimal set of changes. Pure — no API calls — so it can be
 * unit-tested and, more usefully, previewed to the user before anything is
 * written. §9 step 6: never write without showing a preview first.
 */
export function planSync(desired: DesiredEvent[], existingEventIds: string[]): SyncPlan {
	const desiredIds = new Set(
		desired.map((event) => event.googleEventId).filter((id): id is string => id !== null)
	);

	return {
		insert: desired.filter((event) => event.googleEventId === null),
		update: desired.filter((event) => event.googleEventId !== null),
		remove: existingEventIds.filter((id) => !desiredIds.has(id))
	};
}

export type AppliedEvent = { blockId: string; googleEventId: string };

/**
 * Apply a sync plan. Returns the block-to-event mapping for every inserted
 * event so the caller can persist it — without that, the next replan would
 * insert duplicates instead of updating.
 */
export async function applySync(
	auth: OAuth2Client,
	calendarId: string,
	ownCalendarId: string | null,
	plan: SyncPlan,
	timezone: string
): Promise<AppliedEvent[]> {
	assertOwnCalendar(calendarId, ownCalendarId);
	const api = calendarApi(auth);
	const applied: AppliedEvent[] = [];

	for (const event of plan.insert) {
		const created = await api.events.insert({
			calendarId,
			requestBody: toRequestBody(event, timezone)
		});
		if (created.data.id) applied.push({ blockId: event.blockId, googleEventId: created.data.id });
	}

	for (const event of plan.update) {
		await api.events.patch({
			calendarId,
			eventId: event.googleEventId as string,
			requestBody: toRequestBody(event, timezone)
		});
		applied.push({ blockId: event.blockId, googleEventId: event.googleEventId as string });
	}

	for (const eventId of plan.remove) {
		try {
			await api.events.delete({ calendarId, eventId });
		} catch (error) {
			// Already gone (410/404) is the outcome we wanted anyway.
			if (!isMissing(error)) throw error;
		}
	}

	return applied;
}

function toRequestBody(event: DesiredEvent, timezone: string) {
	return {
		summary: event.summary,
		description: event.description,
		start: { dateTime: event.start.toISOString(), timeZone: timezone },
		end: { dateTime: event.end.toISOString(), timeZone: timezone },
		...(event.colorId ? { colorId: event.colorId } : {})
	};
}

function isMissing(error: unknown): boolean {
	if (typeof error !== 'object' || error === null || !('code' in error)) return false;
	const code = (error as { code: unknown }).code;
	return code === 404 || code === 410;
}

/** `[Project] Task title`, per §7. */
export function eventSummary(projectName: string | null, taskTitle: string): string {
	return projectName ? `[${projectName}] ${taskTitle}` : taskTitle;
}

export function eventDescription(options: {
	rawEstimateHours: number | null;
	effectiveEstimateHours: number;
	deadline: Date | null;
	taskUrl: string;
	timezone: string;
}): string {
	const lines: string[] = [];

	// Raw and calibrated side by side — §6. The user must never wonder why a
	// 6h task is occupying 9h of their week.
	if (options.rawEstimateHours !== null) {
		const raw = `Estimate: ${options.rawEstimateHours}h`;
		lines.push(
			options.effectiveEstimateHours !== options.rawEstimateHours
				? `${raw} (scheduled as ${round(options.effectiveEstimateHours)}h after calibration)`
				: raw
		);
	} else {
		lines.push(`Estimate: ${round(options.effectiveEstimateHours)}h (inferred from past work)`);
	}

	if (options.deadline) {
		lines.push(
			`Deadline: ${options.deadline.toLocaleString('fr-FR', { timeZone: options.timezone })}`
		);
	}

	lines.push('', options.taskUrl);
	return lines.join('\n');
}

function round(hours: number): number {
	return Math.round(hours * 100) / 100;
}
