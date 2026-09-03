/**
 * The today view (§10). No ritual, no ceremony: what is happening today, how
 * much of it is left, the one thing that matters most, and anything that has
 * become impossible.
 */

import { fail } from '@sveltejs/kit';
import { formatInTimeZone } from 'date-fns-tz';
import { currentUser } from '$lib/server/auth';
import {
	addCalibrationSample,
	getBlock,
	getBlocksBetween,
	getSettings,
	getTask,
	listProjects,
	listTasks,
	updateBlock,
	updateTask
} from '$lib/server/db/queries';
import { buildCalibrationTable, effectiveEstimate } from '$lib/scheduler/calibration';
import { getCalibrationSamples, getSchedulableTasks } from '$lib/server/db/queries';
import { replan } from '$lib/server/planner';
import { wallClockToInstant } from '$lib/scheduler/intervals';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = await currentUser(event);
	if (!user) return { signedIn: false as const };

	const settings = await getSettings(event.locals.userId ? event.locals.userId : user.id);
	const timezone = settings?.timezone ?? 'Europe/Paris';
	const now = new Date();

	// "Today" is a civil day in the user's timezone, not a 24-hour window.
	const civilToday = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
	const dayStart = wallClockToInstant(civilToday, '00:00', timezone);
	const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);

	const [blocks, tasks, projects, samples, schedulable] = await Promise.all([
		getBlocksBetween(user.id, dayStart, dayEnd),
		listTasks(user.id),
		listProjects(user.id),
		getCalibrationSamples(user.id),
		getSchedulableTasks(user.id, now)
	]);

	const calibration = buildCalibrationTable(samples);
	const taskById = new Map(tasks.map((t) => [t.id, t]));
	const projectById = new Map(projects.map((p) => [p.id, p]));

	const hoursOf = (start: Date, end: Date) => (end.getTime() - start.getTime()) / 3_600_000;

	const humanBlocks = blocks.filter((b) => b.pool === 'human');
	const committedHours = humanBlocks.reduce((sum, b) => sum + hoursOf(b.start, b.end), 0);
	const remainingHours = humanBlocks
		.filter((b) => b.end.getTime() > now.getTime() && b.status === 'planned')
		.reduce((sum, b) => sum + hoursOf(b.start, b.end), 0);

	// The single most pressing thing: the first unfinished block of the day.
	const next = humanBlocks.find((b) => b.end.getTime() > now.getTime() && b.status === 'planned');

	return {
		signedIn: true as const,
		timezone,
		now,
		committedHours,
		remainingHours,
		nextBlockId: next?.id ?? null,
		blocks: blocks.map((block) => {
			const task = taskById.get(block.taskId);
			const project = task?.projectId ? projectById.get(task.projectId) : null;
			return {
				id: block.id,
				start: block.start,
				end: block.end,
				status: block.status,
				pool: block.pool,
				taskId: block.taskId,
				title: task?.title ?? 'Unknown task',
				projectName: project?.name ?? null,
				projectColor: project?.color ?? null
			};
		}),
		atRisk: schedulable
			.filter((task) => task.deadline && task.deadline.getTime() < now.getTime())
			.map((task) => ({
				taskId: task.id,
				title: task.title,
				deadline: task.deadline as Date,
				effectiveHours: effectiveEstimate(task, calibration).effectiveHours
			}))
	};
};

/** Minutes to add or subtract on the one-tap confirmations. */
const ADJUSTMENT_MINUTES = 30;

export const actions: Actions = {
	/**
	 * One tap per finished block: as planned / +30 / −30 / skipped.
	 * Confirming records a calibration sample; skipping returns the work to the
	 * pool so the next replan finds a new home for it — never silently dropped.
	 */
	confirm: async (event) => {
		const user = await currentUser(event);
		if (!user) return fail(401, { message: 'Signed out.' });

		const form = await event.request.formData();
		const blockId = String(form.get('blockId') ?? '');
		const outcome = String(form.get('outcome') ?? '');

		const block = await getBlock(user.id, blockId);
		if (!block) return fail(404, { message: 'No such block.' });

		const plannedMinutes = (block.end.getTime() - block.start.getTime()) / 60_000;

		if (outcome === 'skipped') {
			await updateBlock(user.id, blockId, { status: 'skipped', actualMinutes: 0 });
			// No calibration sample: a block that did not happen says nothing about
			// how long the work takes.
			await replanQuietly(user.id);
			return { ok: true };
		}

		const actualMinutes =
			outcome === 'more'
				? plannedMinutes + ADJUSTMENT_MINUTES
				: outcome === 'less'
					? Math.max(0, plannedMinutes - ADJUSTMENT_MINUTES)
					: plannedMinutes;

		await updateBlock(user.id, blockId, { status: 'confirmed', actualMinutes });

		const task = await getTask(user.id, block.taskId);
		if (task) {
			await addCalibrationSample(user.id, {
				taskId: task.id,
				projectId: task.projectId,
				taskKind: task.kind,
				// The sample compares this block's share of the estimate against what
				// it actually took, so a split task contributes once per block.
				estimateHours: task.estimateHours !== null ? plannedMinutes / 60 : null,
				actualHours: actualMinutes / 60
			});
		}

		await replanQuietly(user.id);
		return { ok: true };
	},

	complete: async (event) => {
		const user = await currentUser(event);
		if (!user) return fail(401, { message: 'Signed out.' });

		const form = await event.request.formData();
		const taskId = String(form.get('taskId') ?? '');
		await updateTask(user.id, taskId, { status: 'done', completedAt: new Date() });
		await replanQuietly(user.id);
		return { ok: true };
	}
};

/** A replan failure must never lose the confirmation the user just made. */
async function replanQuietly(userId: string) {
	try {
		await replan(userId);
	} catch {
		/* the next replan will catch up */
	}
}
