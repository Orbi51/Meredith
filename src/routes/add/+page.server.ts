/**
 * Quick capture (§8).
 *
 * Two steps, both cheap: the typed text is parsed on load and shown as
 * editable fields, then saved. Nothing is mandatory, nothing is rejected, and
 * a misparse costs one click rather than a trip to an edit screen.
 */

import { fail, redirect } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { createProject, createTask, getSettings, listProjects } from '$lib/server/db/queries';
import { parseQuickAdd } from '$lib/server/parse';
import { replan } from '$lib/server/planner';
import { DEFAULT_MIN_BLOCK_MINUTES } from '$lib/scheduler/types';
import type { TaskKind } from '$lib/scheduler/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = await requireUser(event);
	const text = event.url.searchParams.get('text') ?? '';
	const [projects, settings] = await Promise.all([listProjects(user.id), getSettings(user.id)]);

	const parsed = text.trim()
		? await parseQuickAdd(text, {
				projects: projects.map((p) => ({
					id: p.id,
					name: p.name,
					clientName: p.clientName
				})),
				timezone: settings?.timezone ?? 'Europe/Paris',
				now: new Date()
			})
		: null;

	return {
		text,
		parsed,
		projects: projects.map((p) => ({ id: p.id, name: p.name })),
		timezone: settings?.timezone ?? 'Europe/Paris'
	};
};

export const actions: Actions = {
	save: async (event) => {
		const user = await requireUser(event);
		const form = await event.request.formData();

		const title = String(form.get('title') ?? '').trim();
		if (!title) return fail(400, { message: 'A title is the one thing a task needs.' });

		const kindValue = String(form.get('kind') ?? 'creative');
		const kind: TaskKind =
			kindValue === 'admin' || kindValue === 'machine' ? kindValue : 'creative';

		// The user may have accepted the offer to create a project the parser
		// spotted but could not match. Never done without that explicit tick.
		let projectId = String(form.get('projectId') ?? '') || null;
		const newProjectName = String(form.get('newProjectName') ?? '').trim();
		if (!projectId && newProjectName && form.get('createProject') === 'on') {
			const project = await createProject(user.id, { name: newProjectName });
			projectId = project.id;
		}

		const estimateRaw = String(form.get('estimateHours') ?? '').trim();
		const estimateHours = estimateRaw ? Number(estimateRaw) : null;

		const deadlineRaw = String(form.get('deadline') ?? '').trim();
		const deadline = deadlineRaw ? new Date(deadlineRaw) : null;

		await createTask(user.id, {
			title,
			projectId,
			estimateHours: estimateHours !== null && Number.isFinite(estimateHours) ? estimateHours : null,
			deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
			kind,
			minBlockMinutes: DEFAULT_MIN_BLOCK_MINUTES[kind],
			notes: String(form.get('notes') ?? '').trim() || null,
			status: 'active'
		});

		// §10: replan whenever a task is added. A failure here must not lose the
		// task the user just captured, so it is swallowed and surfaced later.
		try {
			await replan(user.id);
		} catch {
			/* the task is saved; the next replan will pick it up */
		}

		redirect(303, '/tasks');
	}
};
