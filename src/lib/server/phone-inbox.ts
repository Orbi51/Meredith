/**
 * Draining the phone's inbox into the plan.
 *
 * Runs on every replan, which in practice means "whenever the app is open on
 * the machine". Anything typed into Google Tasks on the phone becomes a real
 * task here, parsed by exactly the same parser as the quick-add bar — the dash
 * format works from the phone too.
 *
 * Failure is never allowed to stop a replan: if the Tasks scope was never
 * granted, or Google is down, planning carries on with what is already known.
 */

import type { OAuth2Client } from 'google-auth-library';
import { createTask, listProjects } from './db/queries';
import { parseQuickAdd } from './parse';
import {
	ensureInboxList,
	isMissingTasksScope,
	markCaptureTaken,
	readPhoneCaptures
} from './google/tasks';
import { DEFAULT_MIN_BLOCK_MINUTES } from '$lib/scheduler/types';
import { formatInTimeZone } from 'date-fns-tz';

export type InboxResult = {
	imported: number;
	titles: string[];
	/** Set when the user has not granted the Tasks scope yet. */
	needsTasksScope: boolean;
	/** The app's own list, created on first use. Stored so it is found again. */
	listId: string | null;
	warning: string | null;
};

export async function drainPhoneInbox(
	userId: string,
	auth: OAuth2Client,
	timezone: string,
	knownListId: string | null
): Promise<InboxResult> {
	const result: InboxResult = {
		imported: 0,
		titles: [],
		needsTasksScope: false,
		listId: null,
		warning: null
	};

	let captures;
	let listId: string;
	try {
		// The app's own list, and only ever that one. The user's other lists are
		// theirs; swallowing a personal item into the plan and marking it
		// completed is not a mistake they could undo by hand.
		listId = await ensureInboxList(auth, knownListId);
		result.listId = listId;
		captures = await readPhoneCaptures(auth, listId);
	} catch (error) {
		if (isMissingTasksScope(error)) {
			// Not a failure — a setup step. Sign out and in once to grant it.
			result.needsTasksScope = true;
			return result;
		}
		result.warning = `Could not read Google Tasks: ${
			error instanceof Error ? error.message : String(error)
		}`;
		return result;
	}

	if (captures.length === 0) return result;

	const projects = await listProjects(userId);
	const choices = projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName }));

	for (const capture of captures) {
		try {
			const parsed = await parseQuickAdd(capture.text, {
				projects: choices,
				timezone,
				// Resolve dates against when it was TYPED. "demain", captured on
				// Monday and drained on Wednesday, still means Tuesday.
				now: capture.capturedAt
			});

			await createTask(userId, {
				title: parsed.title,
				projectId: parsed.projectId,
				estimateHours: parsed.estimateHours,
				deadline: parsed.deadline,
				kind: parsed.kind,
				minBlockMinutes: DEFAULT_MIN_BLOCK_MINUTES[parsed.kind],
				notes: [capture.notes, parsed.notes, 'Captured on the phone.']
					.filter(Boolean)
					.join('\n'),
				// Straight to active: it was typed deliberately, and leaving it in
				// the inbox would mean it is not scheduled and nobody is told.
				status: 'active'
			});

			await markCaptureTaken(
				auth,
				capture,
				parsed.deadline
					? `due ${formatInTimeZone(parsed.deadline, timezone, 'EEE d MMM')}`
					: null,
				listId
			);

			result.imported++;
			result.titles.push(parsed.title);
		} catch (error) {
			// One bad capture must not strand the rest. It stays outstanding in
			// Google Tasks and will be retried on the next run.
			result.warning = `Could not import "${capture.text}": ${
				error instanceof Error ? error.message : String(error)
			}`;
		}
	}

	return result;
}
