/**
 * Replanning: the one operation that reads everything, runs the scheduler, and
 * writes the result to the database and to Google Calendar.
 *
 * Called whenever something invalidates the plan — a task added or edited, a
 * block confirmed or skipped, a calendar change, or the daily cron.
 *
 * Two invariants, both load-bearing:
 *
 * 1. **Only the future is rewritten.** Blocks that have already started are
 *    frozen: they are history, and history is not reschedulable. They are fed
 *    back into the scheduler as busy time so nothing is booked over them.
 * 2. **Google events are updated, never recreated.** A block row keeps its
 *    googleEventId across replans, so a block that merely moves keeps the
 *    reminder the user has already seen.
 */

import { eq } from 'drizzle-orm';
import { db, schema } from './db';
import {
	getCalibrationSamples,
	getFrozenBlocks,
	getFutureBlocks,
	getSchedulableTasks,
	getSettings,
	getWorkingHours,
	listProjects,
	updateSettings
} from './db/queries';
import type { BlockRow, SettingsRow } from './db/queries';
import { buildCalibrationTable } from '$lib/scheduler/calibration';
import { effectiveEstimate, schedule } from '$lib/scheduler';
import type { SchedulerInput, SchedulerOutput } from '$lib/scheduler/types';
import { clientForUser } from './google/client';
import { readBusyIntervals } from './google/read';
import {
	applySync,
	ensureTargetCalendar,
	eventDescription,
	eventSummary,
	planSync
} from './google/write';
import type { DesiredEvent } from './google/write';

export type ReplanResult = {
	output: SchedulerOutput;
	blocksWritten: number;
	/** Null when the plan was not pushed to Google (no credentials, or dryRun). */
	calendarSync: { inserted: number; updated: number; removed: number } | null;
	warnings: string[];
};

export type ReplanOptions = {
	now?: Date;
	/** Compute the plan and persist blocks, but do not touch Google Calendar. */
	skipCalendar?: boolean;
};

/** Assemble the scheduler's input from the database and Google. */
export async function buildSchedulerInput(
	userId: string,
	now: Date,
	busyIntervals: { start: Date; end: Date }[],
	frozen: BlockRow[],
	settings: SettingsRow
): Promise<SchedulerInput> {
	const [tasks, workingHours, samples] = await Promise.all([
		getSchedulableTasks(userId, now),
		getWorkingHours(userId),
		getCalibrationSamples(userId)
	]);

	// Frozen blocks occupy real time. Handing them to the scheduler as busy
	// intervals is what stops a replan booking new work on top of the block the
	// user is sitting in right now.
	const frozenAsBusy = frozen
		.filter((block) => block.end.getTime() > now.getTime() && block.pool === 'human')
		.map((block) => ({ start: block.start, end: block.end }));

	return {
		now,
		horizonDays: settings.horizonDays,
		tasks,
		busyIntervals: [...busyIntervals, ...frozenAsBusy],
		workingHours,
		calibration: buildCalibrationTable(samples),
		timezone: settings.timezone
	};
}

export async function replan(userId: string, options: ReplanOptions = {}): Promise<ReplanResult> {
	const now = options.now ?? new Date();
	const warnings: string[] = [];

	const settings = await getSettings(userId);
	if (!settings) throw new Error('No settings row for this user.');

	const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
	const canUseGoogle = Boolean(user?.googleRefreshToken) && !options.skipCalendar;

	// ---------------------------------------------------------------- read
	let busyIntervals: { start: Date; end: Date }[] = [];
	let auth: ReturnType<typeof clientForUser> | null = null;
	let targetCalendarId = settings.targetCalendarId;

	if (canUseGoogle) {
		try {
			auth = clientForUser(user!.googleRefreshToken as string);
			targetCalendarId = await ensureTargetCalendar(
				auth,
				settings.timezone,
				settings.targetCalendarId
			);
			if (targetCalendarId !== settings.targetCalendarId) {
				await updateSettings(userId, { targetCalendarId });
			}
			busyIntervals = await readBusyIntervals(auth, {
				timeMin: now,
				timeMax: new Date(now.getTime() + settings.horizonDays * 24 * 3_600_000),
				excludeCalendarId: targetCalendarId,
				timezone: settings.timezone
			});
		} catch (error) {
			// A calendar that cannot be read is a reason to plan with less
			// information, not a reason to refuse to plan at all.
			warnings.push(
				`Could not read Google Calendar: ${error instanceof Error ? error.message : String(error)}`
			);
			auth = null;
		}
	}

	const frozen = await getFrozenBlocks(userId, now);
	const input = await buildSchedulerInput(userId, now, busyIntervals, frozen, settings);

	// -------------------------------------------------------------- schedule
	const output = schedule(input);

	// --------------------------------------------------------------- persist
	const { kept: blockRows, orphanedEventIds } = await persistBlocks(userId, now, output);

	// ---------------------------------------------------------------- google
	let calendarSync: ReplanResult['calendarSync'] = null;
	if (auth && targetCalendarId) {
		try {
			calendarSync = await pushToCalendar(
				userId,
				auth,
				targetCalendarId,
				settings,
				[...frozen, ...blockRows],
				orphanedEventIds,
				input
			);
		} catch (error) {
			warnings.push(
				`Plan saved, but Google Calendar was not updated: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	}

	return { output, blocksWritten: blockRows.length, calendarSync, warnings };
}

/**
 * Write the scheduler's blocks to the database, reusing existing rows for the
 * same task wherever possible.
 *
 * The reuse is the important part: a reused row carries its googleEventId, so
 * a block that shifts by an hour becomes a patch of an existing Google event
 * rather than a delete and an insert.
 */
async function persistBlocks(
	userId: string,
	now: Date,
	output: SchedulerOutput
): Promise<{ kept: BlockRow[]; orphanedEventIds: string[] }> {
	const existing = await getFutureBlocks(userId, now);

	// Existing rows, oldest first, grouped by the task they belong to.
	const spareByTask = new Map<string, BlockRow[]>();
	for (const row of existing) {
		const list = spareByTask.get(row.taskId);
		if (list) list.push(row);
		else spareByTask.set(row.taskId, [row]);
	}

	const kept: BlockRow[] = [];

	for (const block of output.blocks) {
		const spares = spareByTask.get(block.taskId);
		const reused = spares?.shift();

		if (reused) {
			const [row] = await db
				.update(schema.blocks)
				.set({ start: block.start, end: block.end, pool: block.pool, status: 'planned' })
				.where(eq(schema.blocks.id, reused.id))
				.returning();
			if (row) kept.push(row);
		} else {
			const [row] = await db
				.insert(schema.blocks)
				.values({
					userId,
					taskId: block.taskId,
					start: block.start,
					end: block.end,
					pool: block.pool,
					status: 'planned'
				})
				.returning();
			if (row) kept.push(row);
		}
	}

	// Anything left over is a block the new plan has no use for. Collect its
	// Google event id BEFORE deleting the row — once the row is gone the id is
	// gone with it, and the event would linger on the calendar forever.
	const orphanedEventIds: string[] = [];
	for (const spares of spareByTask.values()) {
		for (const orphan of spares) {
			if (orphan.googleEventId) orphanedEventIds.push(orphan.googleEventId);
			await db.delete(schema.blocks).where(eq(schema.blocks.id, orphan.id));
		}
	}

	return { kept, orphanedEventIds };
}

/** Push the current set of blocks to the app's own calendar. */
async function pushToCalendar(
	userId: string,
	auth: ReturnType<typeof clientForUser>,
	targetCalendarId: string,
	settings: SettingsRow,
	blocks: BlockRow[],
	orphanedEventIds: string[],
	input: SchedulerInput
): Promise<{ inserted: number; updated: number; removed: number }> {
	const projects = await listProjects(userId);
	const projectById = new Map(projects.map((p) => [p.id, p]));
	const taskById = new Map(input.tasks.map((t) => [t.id, t]));

	const desired: DesiredEvent[] = [];
	for (const block of blocks) {
		const task = taskById.get(block.taskId);
		if (!task) continue; // a frozen block whose task is done — leave it alone

		const project = task.projectId ? projectById.get(task.projectId) : null;
		const estimate = effectiveEstimate(task, input.calibration);

		desired.push({
			blockId: block.id,
			googleEventId: block.googleEventId,
			start: block.start,
			end: block.end,
			summary: eventSummary(project?.name ?? null, task.title),
			description: eventDescription({
				rawEstimateHours: estimate.rawHours,
				effectiveEstimateHours: estimate.effectiveHours,
				deadline: task.deadline,
				taskUrl: `${baseUrl()}/tasks/${task.id}`,
				timezone: settings.timezone
			})
		});
	}

	// Only events we previously wrote are candidates for deletion — we never
	// enumerate and delete whatever happens to be on the calendar.
	const previouslyWritten = blocks
		.map((b) => b.googleEventId)
		.filter((id): id is string => id !== null);

	const plan = planSync(desired, [...previouslyWritten, ...orphanedEventIds]);
	const applied = await applySync(
		auth,
		targetCalendarId,
		targetCalendarId,
		plan,
		settings.timezone
	);

	// Persist the ids of anything newly inserted, or the next replan inserts
	// duplicates instead of updating.
	for (const { blockId, googleEventId } of applied) {
		await db
			.update(schema.blocks)
			.set({ googleEventId })
			.where(eq(schema.blocks.id, blockId));
	}

	return {
		inserted: plan.insert.length,
		updated: plan.update.length,
		removed: plan.remove.length
	};
}

function baseUrl(): string {
	return process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173';
}
