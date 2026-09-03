/**
 * Task and project management.
 *
 * The list shows every task the scheduler knows about, what it is actually
 * reserving time for (calibrated, next to the raw estimate — §6), and where
 * the plan has run out of room.
 */

import { fail } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import {
	createProject,
	deleteTask,
	getCalibrationSamples,
	getFutureBlocks,
	getSchedulableTasks,
	getSettings,
	listProjects,
	listTasks,
	updateProject,
	updateTask
} from '$lib/server/db/queries';
import { buildCalibrationTable, effectiveEstimate } from '$lib/scheduler/calibration';
import { replan } from '$lib/server/planner';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = await requireUser(event);
	const now = new Date();

	const [tasks, projects, samples, settings, schedulable, futureBlocks] = await Promise.all([
		listTasks(user.id),
		listProjects(user.id),
		getCalibrationSamples(user.id),
		getSettings(user.id),
		getSchedulableTasks(user.id, now),
		getFutureBlocks(user.id, now)
	]);

	const calibration = buildCalibrationTable(samples);
	const projectById = new Map(projects.map((p) => [p.id, p]));
	const schedulableById = new Map(schedulable.map((t) => [t.id, t]));

	// How much of each task the plan has actually found room for.
	const plannedHoursByTask = new Map<string, number>();
	for (const block of futureBlocks) {
		const hours = (block.end.getTime() - block.start.getTime()) / 3_600_000;
		plannedHoursByTask.set(block.taskId, (plannedHoursByTask.get(block.taskId) ?? 0) + hours);
	}

	return {
		timezone: settings?.timezone ?? 'Europe/Paris',
		projects: projects.map((p) => ({ id: p.id, name: p.name, status: p.status })),
		tasks: tasks.map((task) => {
			const forScheduler = schedulableById.get(task.id);
			const estimate = forScheduler
				? effectiveEstimate(forScheduler, calibration)
				: effectiveEstimate(task, calibration);

			return {
				id: task.id,
				title: task.title,
				status: task.status,
				kind: task.kind,
				deadline: task.deadline,
				projectName: task.projectId ? (projectById.get(task.projectId)?.name ?? null) : null,
				waitingReason: task.waitingReason,
				// Raw and calibrated, always together. A silent multiplier destroys
				// trust in the tool.
				rawHours: estimate.rawHours,
				effectiveHours: Math.round(estimate.effectiveHours * 100) / 100,
				multiplier: estimate.multiplier,
				inferred: estimate.inferred,
				hoursAlreadyDone: forScheduler ? Math.round(forScheduler.hoursAlreadyDone * 100) / 100 : 0,
				plannedHours: Math.round((plannedHoursByTask.get(task.id) ?? 0) * 100) / 100
			};
		})
	};
};

export const actions: Actions = {
	setStatus: async (event) => {
		const user = await requireUser(event);
		const form = await event.request.formData();
		const taskId = String(form.get('taskId') ?? '');
		const status = String(form.get('status') ?? '');

		if (!['inbox', 'active', 'waiting', 'done'].includes(status)) {
			return fail(400, { message: 'Unknown status.' });
		}

		await updateTask(user.id, taskId, {
			status: status as 'inbox' | 'active' | 'waiting' | 'done',
			waitingReason: status === 'waiting' ? String(form.get('waitingReason') ?? '') || null : null,
			completedAt: status === 'done' ? new Date() : null
		});

		await replanQuietly(user.id);
		return { ok: true };
	},

	update: async (event) => {
		const user = await requireUser(event);
		const form = await event.request.formData();
		const taskId = String(form.get('taskId') ?? '');

		const estimateRaw = String(form.get('estimateHours') ?? '').trim();
		const deadlineRaw = String(form.get('deadline') ?? '').trim();
		const deadline = deadlineRaw ? new Date(deadlineRaw) : null;

		await updateTask(user.id, taskId, {
			title: String(form.get('title') ?? '').trim() || undefined,
			estimateHours: estimateRaw ? Number(estimateRaw) : null,
			deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
			projectId: String(form.get('projectId') ?? '') || null
		});

		await replanQuietly(user.id);
		return { ok: true };
	},

	remove: async (event) => {
		const user = await requireUser(event);
		const form = await event.request.formData();
		await deleteTask(user.id, String(form.get('taskId') ?? ''));
		await replanQuietly(user.id);
		return { ok: true };
	},

	createProject: async (event) => {
		const user = await requireUser(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'A project needs a name.' });

		await createProject(user.id, {
			name,
			clientName: String(form.get('clientName') ?? '').trim() || null,
			agreedFee: form.get('agreedFee') ? Number(form.get('agreedFee')) : null
		});
		return { ok: true };
	},

	archiveProject: async (event) => {
		const user = await requireUser(event);
		const form = await event.request.formData();
		await updateProject(user.id, String(form.get('projectId') ?? ''), { status: 'archived' });
		return { ok: true };
	},

	replan: async (event) => {
		const user = await requireUser(event);
		const result = await replan(user.id);
		return {
			ok: true,
			message: [
				`${result.blocksWritten} blocks planned`,
				result.calendarSync
					? `calendar: +${result.calendarSync.inserted} ~${result.calendarSync.updated} −${result.calendarSync.removed}`
					: 'calendar not updated',
				...result.warnings
			].join(' · ')
		};
	}
};

async function replanQuietly(userId: string) {
	try {
		await replan(userId);
	} catch {
		/* the next replan will catch up */
	}
}
