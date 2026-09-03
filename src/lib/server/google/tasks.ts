/**
 * Google Tasks as the phone's capture surface.
 *
 * This is what lets the app stay local. The problem hosting was meant to solve
 * was "capture on my phone, see the plan on my phone" — and both halves are
 * already available through apps Google ships:
 *
 *   - **Seeing the plan**: the app writes blocks to its own `Planned work`
 *     calendar, which appears in the Google Calendar app already.
 *   - **Capturing**: anything typed into the Google Tasks app is drained into
 *     the inbox here the next time the app runs on the machine.
 *
 * The task is completed in Google Tasks once it has been taken, so it is never
 * imported twice and the phone list stays empty — an inbox, not an archive.
 *
 * The trade is honest: nothing is planned while the machine is off. For
 * someone who works at that machine, a capture waiting twenty minutes to be
 * scheduled costs nothing.
 */

import type { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';

/** The list drained on each run. Google's default list is called this. */
export const DEFAULT_LIST_TITLE = 'My Tasks';

export type CapturedFromPhone = {
	/** Google's task id, used to complete it once imported. */
	id: string;
	listId: string;
	/** What the user typed. Fed to the same parser as the quick-add bar. */
	text: string;
	/** Anything they added in the notes field. */
	notes: string | null;
	/** When they typed it — dates resolve against this, not against import time. */
	capturedAt: Date;
};

function api(auth: OAuth2Client) {
	return google.tasks({ version: 'v1', auth });
}

/**
 * Is the failure "you never granted the Tasks scope"?
 *
 * Worth distinguishing: that is a setup step the user has to take, not a bug,
 * and it must not look like the calendar being broken.
 */
export function isMissingTasksScope(error: unknown): boolean {
	const status = (error as { code?: number; status?: number }).code ?? (error as { status?: number }).status;
	return status === 403 || status === 401;
}

/**
 * Read everything outstanding from the user's task lists.
 *
 * Completed and deleted tasks are skipped — the app only wants what is still
 * waiting. Tasks the app itself created (recognisable by their notes) are
 * skipped too, so a round trip cannot loop.
 */
export async function readPhoneCaptures(
	auth: OAuth2Client,
	options: { listTitle?: string | null } = {}
): Promise<CapturedFromPhone[]> {
	const tasks = api(auth);
	const lists = await tasks.tasklists.list({ maxResults: 100 });

	const wanted = (lists.data.items ?? []).filter((list) => {
		if (!list.id) return false;
		// No title configured: drain every list, which is what someone who has
		// never thought about Google Tasks lists would expect.
		if (!options.listTitle) return true;
		return list.title === options.listTitle;
	});

	const captures: CapturedFromPhone[] = [];

	const responses = await Promise.all(
		wanted.map((list) =>
			tasks.tasks
				.list({
					tasklist: list.id as string,
					showCompleted: false,
					showDeleted: false,
					showHidden: false,
					maxResults: 100
				})
				.then((response) => ({ listId: list.id as string, items: response.data.items ?? [] }))
		)
	);

	for (const { listId, items } of responses) {
		for (const item of items) {
			if (!item.id || !item.title?.trim()) continue;
			if (item.status === 'completed') continue;
			// Written by this app on a previous run — never re-import it.
			if (item.notes?.includes(APP_MARKER)) continue;

			captures.push({
				id: item.id,
				listId,
				text: item.title.trim(),
				notes: item.notes?.trim() || null,
				// `updated` is the only timestamp Google exposes here. It is when
				// the task was last touched, which for a fresh capture is when it
				// was typed — close enough for "demain" to mean the right day.
				capturedAt: item.updated ? new Date(item.updated) : new Date()
			});
		}
	}

	return captures;
}

/** Marker so the app never re-imports something it wrote itself. */
const APP_MARKER = '[capacity]';

/**
 * Mark a captured task as done in Google Tasks, so the phone list empties as
 * the work is taken into the plan.
 *
 * Completing rather than deleting: if something goes wrong, the user can still
 * see what was taken in the Google Tasks "completed" view. Deletion would make
 * a parsing mistake unrecoverable.
 */
export async function markCaptureTaken(
	auth: OAuth2Client,
	capture: CapturedFromPhone,
	scheduledFor: string | null
): Promise<void> {
	await api(auth).tasks.patch({
		tasklist: capture.listId,
		task: capture.id,
		requestBody: {
			status: 'completed',
			notes: [
				capture.notes,
				`${APP_MARKER} taken into the plan${scheduledFor ? ` — ${scheduledFor}` : ''}`
			]
				.filter(Boolean)
				.join('\n')
		}
	});
}

/**
 * Push a one-line summary of the day back to Google Tasks.
 *
 * Without hosting there is no web push, so this is the phone-visible brief: a
 * task dated today whose title is the state of the plan. It replaces yesterday's
 * rather than accumulating.
 */
export async function writeDailyBriefTask(
	auth: OAuth2Client,
	options: { listId?: string | null; title: string; day: string }
): Promise<void> {
	const tasks = api(auth);

	const listId =
		options.listId ??
		(await tasks.tasklists.list({ maxResults: 1 })).data.items?.[0]?.id ??
		null;
	if (!listId) return;

	// Clear the previous brief so there is only ever one.
	const existing = await tasks.tasks.list({
		tasklist: listId,
		showCompleted: false,
		maxResults: 100
	});
	for (const item of existing.data.items ?? []) {
		if (item.id && item.notes?.includes(BRIEF_MARKER)) {
			await tasks.tasks.delete({ tasklist: listId, task: item.id });
		}
	}

	await tasks.tasks.insert({
		tasklist: listId,
		requestBody: {
			title: options.title,
			notes: `${APP_MARKER} ${BRIEF_MARKER} written automatically`,
			due: `${options.day}T00:00:00.000Z`
		}
	});
}

const BRIEF_MARKER = '[brief]';
