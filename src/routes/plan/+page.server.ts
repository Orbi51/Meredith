/**
 * The Monday ritual (§9) — the spine of the app.
 *
 * Ten minutes, six steps, in order:
 *   1. Review last week      — feeds calibration
 *   2. Fixed commitments     — context, read-only
 *   3. Capacity              — the budget, as one number
 *   4. Deadline pressure     — what is about to break
 *   5. Commit                — what you are promising to do
 *   6. Generate              — preview, then write on confirmation
 *
 * Step 5 is the point of the whole app: the user will want to commit to more
 * than fits, and this is where that becomes impossible to miss.
 */

import { fail } from '@sveltejs/kit';
import { formatInTimeZone } from 'date-fns-tz';
import { and, eq, gte, lt } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { requireUser } from '$lib/server/auth';
import {
	addCalibrationSample,
	getBlock,
	getCalibrationSamples,
	getSchedulableTasks,
	getSettings,
	getTask,
	listProjects,
	listTasks,
	listWaitingTasks,
	updateBlock,
	updateSettings,
	updateTask
} from '$lib/server/db/queries';
import { buildCalibrationTable, effectiveEstimate } from '$lib/scheduler/calibration';
import { addCivilDays, totalHours, wallClockToInstant } from '$lib/scheduler/intervals';
import { availableHoursBetween } from '$lib/scheduler/slack';
import { expandWorkingHours, subtractIntervals } from '$lib/scheduler/intervals';
import { getWorkingHours } from '$lib/server/db/queries';
import { clientForUser } from '$lib/server/google/client';
import { readAppointments } from '$lib/server/google/read';
import { previewPlan, replan } from '$lib/server/planner';
import type { Actions, PageServerLoad } from './$types';

/** Deadlines this far out are the ones worth worrying about on a Monday. */
const PRESSURE_HORIZON_DAYS = 21;

function isoWeek(instant: Date, timezone: string): string {
	return formatInTimeZone(instant, timezone, "RRRR-'W'II");
}

/** Monday 00:00 of the week containing `instant`, as an instant. */
function mondayOf(instant: Date, timezone: string, weekOffset = 0): Date {
	const civil = formatInTimeZone(instant, timezone, 'yyyy-MM-dd');
	const isoDow = Number(formatInTimeZone(instant, timezone, 'i')); // 1 = Monday
	return wallClockToInstant(addCivilDays(civil, -(isoDow - 1) + weekOffset * 7), '00:00', timezone);
}

export const load: PageServerLoad = async (event) => {
	const user = await requireUser(event);
	const settings = await getSettings(user.id);
	const timezone = settings?.timezone ?? 'Europe/Paris';
	const now = new Date();

	const thisMonday = mondayOf(now, timezone);
	const lastMonday = mondayOf(now, timezone, -1);
	const nextMonday = mondayOf(now, timezone, 1);
	const currentWeek = isoWeek(now, timezone);

	// ---------------------------------------------------- step 1: last week
	const lastWeekBlocks = await db
		.select()
		.from(schema.blocks)
		.where(
			and(
				eq(schema.blocks.userId, user.id),
				gte(schema.blocks.start, lastMonday),
				lt(schema.blocks.start, thisMonday)
			)
		)
		.orderBy(schema.blocks.start);

	const [tasks, projects, samples, waiting, workingHours, allRows] = await Promise.all([
		getSchedulableTasks(user.id, now),
		listProjects(user.id),
		getCalibrationSamples(user.id),
		listWaitingTasks(user.id),
		getWorkingHours(user.id),
		listTasks(user.id)
	]);

	// Which tasks the user has already promised to this week.
	const tasksCommittedThisWeek = new Set(
		allRows.filter((row) => row.committedToWeek === currentWeek).map((row) => row.id)
	);

	const calibration = buildCalibrationTable(samples);
	const projectById = new Map(projects.map((p) => [p.id, p]));
	const allTaskTitles = new Map<string, string>();
	for (const task of tasks) allTaskTitles.set(task.id, task.title);
	for (const task of waiting) allTaskTitles.set(task.id, task.title);

	const hoursOf = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

	const review = lastWeekBlocks.map((block) => ({
		id: block.id,
		start: block.start,
		end: block.end,
		status: block.status,
		plannedHours: Math.round(hoursOf(block.start, block.end) * 100) / 100,
		actualHours: block.actualMinutes !== null ? block.actualMinutes / 60 : null,
		title: allTaskTitles.get(block.taskId) ?? 'Unknown task'
	}));

	const reviewTotals = {
		planned: Math.round(review.reduce((s, b) => s + b.plannedHours, 0) * 100) / 100,
		actual:
			Math.round(
				review.reduce((s, b) => s + (b.actualHours ?? (b.status === 'skipped' ? 0 : 0)), 0) * 100
			) / 100,
		unreviewed: review.filter((b) => b.status === 'planned').length
	};

	// -------------------------------------------- step 2: fixed commitments
	//
	// ONE read of the calendar, covering the whole pressure horizon. Step 2
	// shows the slice for this week; step 4 needs every hour up to a deadline
	// three weeks out. Reading twice cost 2.3s a page load, which is felt on
	// every click of the ritual.
	const pressureUntil = new Date(now.getTime() + PRESSURE_HORIZON_DAYS * 24 * 3_600_000);
	let horizonAppointments: { start: Date; end: Date; summary: string; allDay: boolean }[] = [];
	const warnings: string[] = [];
	if (user.googleRefreshToken) {
		try {
			horizonAppointments = await readAppointments(clientForUser(user.googleRefreshToken), {
				timeMin: now,
				timeMax: pressureUntil,
				excludeCalendarId: settings?.targetCalendarId ?? null,
				timezone
			});
		} catch (error) {
			warnings.push(
				`Could not read appointments: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	const appointments = horizonAppointments.filter(
		(appointment) => appointment.start.getTime() < nextMonday.getTime()
	);

	// -------------------------------------------------------- step 3: capacity
	// working hours − fixed commitments = what is actually left this week.
	const from = now.getTime() > thisMonday.getTime() ? now : thisMonday;
	const workingIntervals = expandWorkingHours(workingHours, from, nextMonday, timezone);
	const freeIntervals = subtractIntervals(workingIntervals, appointments);
	const workingHoursThisWeek = Math.round(totalHours(workingIntervals) * 10) / 10;
	const availableHours = Math.round(totalHours(freeIntervals) * 10) / 10;

	// ------------------------------------------------ step 4: deadline pressure
	//
	// Slack must be measured over every working hour before the deadline, not
	// just the hours left in THIS week. A task due next Thursday can draw on
	// next week's capacity, and calling it impossible because this week is full
	// is a false alarm — the one thing that would stop the user believing the
	// report at all.
	const freeOverHorizon = subtractIntervals(
		expandWorkingHours(workingHours, now, pressureUntil, timezone),
		horizonAppointments
	);
	const pressure = [...tasks, ...waiting.map(toSchedulable)]
		.filter((task) => task.deadline && task.deadline.getTime() <= pressureUntil.getTime())
		.map((task) => {
			const estimate = effectiveEstimate(task, calibration);
			const remaining = Math.max(0, estimate.effectiveHours - task.hoursAlreadyDone);
			return {
				taskId: task.id,
				title: task.title,
				projectName: task.projectId ? (projectById.get(task.projectId)?.name ?? null) : null,
				deadline: task.deadline as Date,
				remainingHours: Math.round(remaining * 100) / 100,
				rawHours: estimate.rawHours,
				multiplier: estimate.multiplier,
				inferred: estimate.inferred,
				// Slack in WORKING hours, which is the only measure that tells the
				// truth about a deadline three weeks out with four working days in it.
				slackHours:
					Math.round(
						(availableHoursBetween(freeOverHorizon, now, task.deadline as Date) - remaining) * 10
					) / 10,
				waiting: waiting.some((w) => w.id === task.id),
				committed: tasksCommittedThisWeek.has(task.id)
			};
		})
		.sort((a, b) => a.slackHours - b.slackHours);

	// ----------------------------------------------------------- step 5: commit
	const committable = tasks.map((task) => {
		const estimate = effectiveEstimate(task, calibration);
		const remaining = Math.max(0, estimate.effectiveHours - task.hoursAlreadyDone);
		return {
			taskId: task.id,
			title: task.title,
			projectName: task.projectId ? (projectById.get(task.projectId)?.name ?? null) : null,
			deadline: task.deadline,
			remainingHours: Math.round(remaining * 100) / 100,
			rawHours: estimate.rawHours,
			multiplier: estimate.multiplier,
			inferred: estimate.inferred,
			committed: tasksCommittedThisWeek.has(task.id)
		};
	});

	const committedHours =
		Math.round(committable.filter((t) => t.committed).reduce((s, t) => s + t.remainingHours, 0) * 10) /
		10;

	return {
		timezone,
		now,
		currentWeek,
		alreadyDoneThisWeek: settings?.ritualCompletedWeek === currentWeek,
		warnings,
		review,
		reviewTotals,
		appointments,
		capacity: {
			workingHours: workingHoursThisWeek,
			appointmentHours: Math.round((workingHoursThisWeek - availableHours) * 10) / 10,
			availableHours,
			committedHours,
			overrunHours: Math.round((committedHours - availableHours) * 10) / 10
		},
		pressure,
		committable
	};

	function toSchedulable(row: (typeof waiting)[number]) {
		return {
			id: row.id,
			projectId: row.projectId,
			title: row.title,
			estimateHours: row.estimateHours,
			deadline: row.deadline,
			earliestStart: row.earliestStart,
			kind: row.kind,
			splittable: row.splittable,
			minBlockMinutes: row.minBlockMinutes,
			dependsOnTaskId: row.dependsOnTaskId,
			hoursAlreadyDone: 0,
			createdAt: row.createdAt
		};
	}
};

export const actions: Actions = {
	/** Step 1: one tap per block. Twenty blocks should clear in under a minute. */
	review: async (event) => {
		const user = await requireUser(event);
		const form = await event.request.formData();
		const blockId = String(form.get('blockId') ?? '');
		const outcome = String(form.get('outcome') ?? '');

		const block = await getBlock(user.id, blockId);
		if (!block) return fail(404, { message: 'No such block.' });

		const plannedMinutes = (block.end.getTime() - block.start.getTime()) / 60_000;

		if (outcome === 'skipped') {
			// A block that did not happen teaches us nothing about how long the
			// work takes, so it records no calibration sample. The work itself
			// returns to the pool and is rescheduled.
			await updateBlock(user.id, blockId, { status: 'skipped', actualMinutes: 0 });
			return { ok: true };
		}

		const actualMinutes =
			outcome === 'more'
				? plannedMinutes + 30
				: outcome === 'less'
					? Math.max(0, plannedMinutes - 30)
					: plannedMinutes;

		await updateBlock(user.id, blockId, { status: 'confirmed', actualMinutes });

		const task = await getTask(user.id, block.taskId);
		if (task) {
			await addCalibrationSample(user.id, {
				taskId: task.id,
				projectId: task.projectId,
				taskKind: task.kind,
				estimateHours: task.estimateHours !== null ? plannedMinutes / 60 : null,
				actualHours: actualMinutes / 60
			});
		}
		return { ok: true };
	},

	/** Step 5: commit a task to this week, or take it back out. */
	commit: async (event) => {
		const user = await requireUser(event);
		const settings = await getSettings(user.id);
		const timezone = settings?.timezone ?? 'Europe/Paris';
		const form = await event.request.formData();

		const taskId = String(form.get('taskId') ?? '');
		const wanted = form.get('committed') === 'true';

		await updateTask(user.id, taskId, {
			committedToWeek: wanted ? isoWeek(new Date(), timezone) : null,
			// Committing to a week is also a decision to start it: an inbox task
			// the user has just promised to do this week is an active task.
			status: wanted ? 'active' : undefined
		});
		return { ok: true };
	},

	/** Step 6a: what WOULD happen. Nothing is written. */
	preview: async (event) => {
		const user = await requireUser(event);
		const settings = await getSettings(user.id);
		const timezone = settings?.timezone ?? 'Europe/Paris';

		const { output, input, warnings } = await previewPlan(user.id);
		const titles = new Map(input.tasks.map((t) => [t.id, t.title]));

		return {
			preview: {
				blocks: output.blocks.map((block) => ({
					start: block.start.toISOString(),
					end: block.end.toISOString(),
					day: formatInTimeZone(block.start, timezone, 'EEE d MMM'),
					time: `${formatInTimeZone(block.start, timezone, 'HH:mm')}–${formatInTimeZone(block.end, timezone, 'HH:mm')}`,
					title: titles.get(block.taskId) ?? 'Unknown task',
					pool: block.pool
				})),
				unplaced: output.unplaced.map((u) => ({
					title: titles.get(u.taskId) ?? 'Unknown task',
					hoursShort: u.hoursShort,
					reason: u.reason
				})),
				atRisk: output.atRisk.map((r) => ({
					title: titles.get(r.taskId) ?? 'Unknown task',
					slackHours: r.slackHours,
					pastDeadline: r.scheduledPastDeadline
				})),
				capacityUsed: output.capacityUsed,
				warnings
			}
		};
	},

	/** Step 6b: the user has seen the preview and said yes. */
	generate: async (event) => {
		const user = await requireUser(event);
		const settings = await getSettings(user.id);
		const timezone = settings?.timezone ?? 'Europe/Paris';

		const result = await replan(user.id);
		await updateSettings(user.id, { ritualCompletedWeek: isoWeek(new Date(), timezone) });

		return {
			generated: {
				blocks: result.blocksWritten,
				calendar: result.calendarSync,
				unplaced: result.output.unplaced.length,
				warnings: result.warnings
			}
		};
	}
};
