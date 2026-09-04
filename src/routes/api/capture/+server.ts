/**
 * Direct capture, with no parse-preview step.
 *
 * Used by the offline queue when it flushes, and by the share target. There is
 * no user watching, so the parse result is accepted as-is — §8's rule that
 * input is never rejected matters more here than anywhere.
 */

import { json } from '@sveltejs/kit';
import { currentUser } from '$lib/server/auth';
import {
	createTask,
	getSettings,
	latestWorkingHour,
	listProjects
} from '$lib/server/db/queries';
import { parseQuickAdd } from '$lib/server/parse';
import { replan } from '$lib/server/planner';
import { DEFAULT_MIN_BLOCK_MINUTES } from '$lib/scheduler/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const user = await currentUser(event);
	if (!user) return json({ error: 'signed out' }, { status: 401 });

	const body = (await event.request.json()) as { text?: string; capturedAt?: string };
	const text = (body.text ?? '').trim();
	if (!text) return json({ error: 'empty' }, { status: 400 });

	const settings = await getSettings(user.id);
	const timezone = settings?.timezone ?? 'Europe/Paris';
	const projects = await listProjects(user.id);
	const endOfDay = await latestWorkingHour(user.id);

	// Dates resolve against when the user TYPED it, not when the queue drained.
	// "demain", captured on a train on Monday and flushed on Wednesday, still
	// means Tuesday.
	const capturedAt = body.capturedAt ? new Date(body.capturedAt) : new Date();
	const now = Number.isNaN(capturedAt.getTime()) ? new Date() : capturedAt;

	const parsed = await parseQuickAdd(text, {
		projects: projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName })),
		timezone,
		now,
		hoursPerDay: settings?.hoursPerDay,
		endOfDay: endOfDay ?? undefined
	});

	const task = await createTask(user.id, {
		title: parsed.title,
		projectId: parsed.projectId,
		estimateHours: parsed.estimateHours,
		deadline: parsed.deadline,
		kind: parsed.kind,
		minBlockMinutes: DEFAULT_MIN_BLOCK_MINUTES[parsed.kind],
		notes: parsed.notes,
		status: 'inbox'
	});

	try {
		await replan(user.id);
	} catch {
		/* the task is saved, which is the part that matters */
	}

	return json({ id: task.id, title: task.title });
};
