/**
 * PWA share target (§11).
 *
 * A URL, a note or a reference image shared from the phone lands in the inbox.
 * Everything stays inside the app — no third-party routing.
 */

import { redirect } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import {
	createTask,
	getSettings,
	latestWorkingHour,
	listProjects
} from '$lib/server/db/queries';
import { parseQuickAdd } from '$lib/server/parse';
import type { Actions, PageServerLoad } from './$types';

/** A GET here means the user opened /share directly; nothing to do. */
export const load: PageServerLoad = async (event) => {
	await requireUser(event);
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const user = await requireUser(event);
		const form = await event.request.formData();

		const title = String(form.get('title') ?? '').trim();
		const text = String(form.get('text') ?? '').trim();
		const url = String(form.get('url') ?? '').trim();

		// Android puts the shared URL in `text` as often as in `url`.
		const headline = title || text || url || 'Shared item';
		const settings = await getSettings(user.id);
		const projects = await listProjects(user.id);
		const endOfDay = await latestWorkingHour(user.id);

		const parsed = await parseQuickAdd(headline, {
			projects: projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName })),
			timezone: settings?.timezone ?? 'Europe/Paris',
			now: new Date(),
			hoursPerDay: settings?.hoursPerDay,
			endOfDay: endOfDay ?? undefined
		});

		const notes = [text && text !== headline ? text : null, url && url !== headline ? url : null]
			.filter(Boolean)
			.join('\n');

		await createTask(user.id, {
			title: parsed.title,
			projectId: parsed.projectId,
			estimateHours: parsed.estimateHours,
			deadline: parsed.deadline,
			kind: parsed.kind,
			notes: notes || null,
			// Shared things arrive without thought behind them, so they land in
			// the inbox rather than being scheduled straight away.
			status: 'inbox'
		});

		redirect(303, '/tasks');
	}
};
