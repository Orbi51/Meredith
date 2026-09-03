/**
 * The week view: the main surface on desktop (§11). Planned blocks and the
 * capacity they consume, day by day.
 */

import { formatInTimeZone } from 'date-fns-tz';
import { requireUser } from '$lib/server/auth';
import {
	getBlocksBetween,
	getFrozenBlocks,
	getSettings,
	listProjects,
	listTasks
} from '$lib/server/db/queries';
import { buildSchedulerInput } from '$lib/server/planner';
import { schedule } from '$lib/scheduler';
import { addCivilDays, wallClockToInstant } from '$lib/scheduler/intervals';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = await requireUser(event);
	const settings = await getSettings(user.id);
	const timezone = settings?.timezone ?? 'Europe/Paris';
	const now = new Date();

	// The ISO week containing `offset` weeks from today, Monday to Sunday.
	const offset = Number(event.url.searchParams.get('offset') ?? '0') || 0;
	const todayCivil = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
	const isoDayOfWeek = Number(formatInTimeZone(now, timezone, 'i')); // 1 = Monday
	const mondayCivil = addCivilDays(todayCivil, -(isoDayOfWeek - 1) + offset * 7);

	const days = Array.from({ length: 7 }, (_, i) => addCivilDays(mondayCivil, i));
	const weekStart = wallClockToInstant(mondayCivil, '00:00', timezone);
	const weekEnd = wallClockToInstant(addCivilDays(mondayCivil, 7), '00:00', timezone);

	const [blocks, tasks, projects, frozen] = await Promise.all([
		getBlocksBetween(user.id, weekStart, weekEnd),
		listTasks(user.id),
		listProjects(user.id),
		getFrozenBlocks(user.id, now)
	]);

	const taskById = new Map(tasks.map((t) => [t.id, t]));
	const projectById = new Map(projects.map((p) => [p.id, p]));

	// Capacity for the week comes from the scheduler's own view of the world, so
	// the number here and the number the planner used cannot drift apart.
	let capacity: { weekIso: string; committedHours: number; availableHours: number }[] = [];
	if (settings) {
		const input = await buildSchedulerInput(user.id, now, [], frozen, settings);
		capacity = schedule(input).capacityUsed;
	}

	const weekIso = formatInTimeZone(weekStart, timezone, "RRRR-'W'II");

	return {
		timezone,
		weekIso,
		offset,
		capacity: capacity.find((c) => c.weekIso === weekIso) ?? null,
		days: days.map((civil) => ({
			civil,
			label: formatInTimeZone(wallClockToInstant(civil, '12:00', timezone), timezone, 'EEE d MMM'),
			isToday: civil === todayCivil,
			blocks: blocks
				.filter((b) => formatInTimeZone(b.start, timezone, 'yyyy-MM-dd') === civil)
				.map((block) => {
					const task = taskById.get(block.taskId);
					const project = task?.projectId ? projectById.get(task.projectId) : null;
					return {
						id: block.id,
						start: block.start,
						end: block.end,
						status: block.status,
						pool: block.pool,
						title: task?.title ?? 'Unknown task',
						projectName: project?.name ?? null,
						color: project?.color ?? '#6366f1'
					};
				})
		}))
	};
};
