/**
 * Every database read and write the app does, in one place.
 *
 * The scheduler is pure, so something has to translate between database rows
 * and the shapes it expects. That translation lives here rather than being
 * scattered through route handlers.
 */

import { and, asc, eq, gte, inArray, isNotNull, lt, lte, ne, or } from 'drizzle-orm';
import { db, schema } from './index';
import { DEFAULT_MIN_BLOCK_MINUTES } from '$lib/scheduler/types';
import type { SchedulableTask, TaskKind, WorkingHours } from '$lib/scheduler/types';
import type { CalibrationSample } from '$lib/scheduler/calibration';

export type UserRow = typeof schema.users.$inferSelect;
export type SettingsRow = typeof schema.settings.$inferSelect;
export type TaskRow = typeof schema.tasks.$inferSelect;
export type ProjectRow = typeof schema.projects.$inferSelect;
export type BlockRow = typeof schema.blocks.$inferSelect;

/** Statuses the scheduler places work for. See note on `waiting` below. */
const SCHEDULABLE_STATUSES = ['inbox', 'active'] as const;

export async function getUserByEmail(email: string): Promise<UserRow | null> {
	const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
	return user ?? null;
}

export async function getSettings(userId: string): Promise<SettingsRow | null> {
	const [row] = await db
		.select()
		.from(schema.settings)
		.where(eq(schema.settings.userId, userId));
	return row ?? null;
}

export async function updateSettings(
	userId: string,
	values: Partial<typeof schema.settings.$inferInsert>
) {
	await db.update(schema.settings).set(values).where(eq(schema.settings.userId, userId));
}

export async function getWorkingHours(userId: string): Promise<WorkingHours[]> {
	const rows = await db
		.select()
		.from(schema.workingHours)
		.where(eq(schema.workingHours.userId, userId))
		.orderBy(asc(schema.workingHours.dayOfWeek));

	return rows.map((row) => ({
		dayOfWeek: row.dayOfWeek,
		intervals: row.intervals
	}));
}

export async function replaceWorkingHours(userId: string, hours: WorkingHours[]) {
	await db.delete(schema.workingHours).where(eq(schema.workingHours.userId, userId));
	if (hours.length === 0) return;
	await db.insert(schema.workingHours).values(
		hours.map((h) => ({
			userId,
			dayOfWeek: h.dayOfWeek,
			intervals: h.intervals as { start: string; end: string; preferredKind: 'creative' | 'admin' | null }[]
		}))
	);
}

export async function listProjects(userId: string): Promise<ProjectRow[]> {
	return db
		.select()
		.from(schema.projects)
		.where(and(eq(schema.projects.userId, userId), ne(schema.projects.status, 'archived')))
		.orderBy(asc(schema.projects.name));
}

export async function createProject(
	userId: string,
	values: Omit<typeof schema.projects.$inferInsert, 'userId'>
): Promise<ProjectRow> {
	const [row] = await db
		.insert(schema.projects)
		.values({ ...values, userId })
		.returning();
	return row as ProjectRow;
}

export async function updateProject(
	userId: string,
	projectId: string,
	values: Partial<typeof schema.projects.$inferInsert>
) {
	await db
		.update(schema.projects)
		.set(values)
		.where(and(eq(schema.projects.userId, userId), eq(schema.projects.id, projectId)));
}

export async function listTasks(userId: string): Promise<TaskRow[]> {
	return db
		.select()
		.from(schema.tasks)
		.where(and(eq(schema.tasks.userId, userId), ne(schema.tasks.status, 'done')))
		.orderBy(asc(schema.tasks.createdAt));
}

export async function getTask(userId: string, taskId: string): Promise<TaskRow | null> {
	const [row] = await db
		.select()
		.from(schema.tasks)
		.where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, taskId)));
	return row ?? null;
}

export async function createTask(
	userId: string,
	values: Omit<typeof schema.tasks.$inferInsert, 'userId'>
): Promise<TaskRow> {
	const kind = (values.kind ?? 'creative') as TaskKind;
	const [row] = await db
		.insert(schema.tasks)
		.values({
			...values,
			userId,
			// A sensible minimum block follows from the kind unless the user says
			// otherwise — creative work in 30-minute slivers is worthless.
			minBlockMinutes: values.minBlockMinutes ?? DEFAULT_MIN_BLOCK_MINUTES[kind]
		})
		.returning();
	return row as TaskRow;
}

export async function updateTask(
	userId: string,
	taskId: string,
	values: Partial<typeof schema.tasks.$inferInsert>
) {
	await db
		.update(schema.tasks)
		.set(values)
		.where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, taskId)));
}

export async function deleteTask(userId: string, taskId: string) {
	await db
		.delete(schema.tasks)
		.where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, taskId)));
}

/**
 * Tasks the scheduler should place, as the shape it wants.
 *
 * `waiting` tasks are deliberately excluded: work blocked on client feedback
 * should not occupy the calendar today. Their deadlines still matter, and the
 * Monday ritual (Phase 3) surfaces them separately.
 *
 * `hoursAlreadyDone` comes from blocks that are frozen — already worked, or
 * in progress — so a replan schedules only what is genuinely left.
 */
export async function getSchedulableTasks(
	userId: string,
	now: Date
): Promise<SchedulableTask[]> {
	const rows = await db
		.select()
		.from(schema.tasks)
		.where(
			and(
				eq(schema.tasks.userId, userId),
				inArray(schema.tasks.status, [...SCHEDULABLE_STATUSES])
			)
		)
		.orderBy(asc(schema.tasks.createdAt));

	const doneByTask = await hoursWorkedByTask(userId, now);

	return rows.map((row) => ({
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
		hoursAlreadyDone: doneByTask.get(row.id) ?? 0,
		createdAt: row.createdAt
	}));
}

/**
 * Hours already spent per task: confirmed blocks use their recorded actual,
 * and blocks that have started but not been confirmed count their planned
 * length. Skipped blocks count for nothing — that work still needs doing.
 */
async function hoursWorkedByTask(userId: string, now: Date): Promise<Map<string, number>> {
	const rows = await db
		.select()
		.from(schema.blocks)
		.where(and(eq(schema.blocks.userId, userId), lt(schema.blocks.start, now)));

	const byTask = new Map<string, number>();
	for (const row of rows) {
		if (row.status === 'skipped') continue;
		const plannedHours = (row.end.getTime() - row.start.getTime()) / 3_600_000;
		const hours = row.actualMinutes !== null ? row.actualMinutes / 60 : plannedHours;
		byTask.set(row.taskId, (byTask.get(row.taskId) ?? 0) + hours);
	}
	return byTask;
}

/**
 * Blocks a replan must not move: anything that has already started. Past and
 * in-progress work is history, and history is not reschedulable.
 */
export async function getFrozenBlocks(userId: string, now: Date): Promise<BlockRow[]> {
	return db
		.select()
		.from(schema.blocks)
		.where(and(eq(schema.blocks.userId, userId), lte(schema.blocks.start, now)))
		.orderBy(asc(schema.blocks.start));
}

/** Future planned blocks — the ones a replan is free to rewrite. */
export async function getFutureBlocks(userId: string, now: Date): Promise<BlockRow[]> {
	return db
		.select()
		.from(schema.blocks)
		.where(
			and(
				eq(schema.blocks.userId, userId),
				gte(schema.blocks.start, now),
				eq(schema.blocks.status, 'planned')
			)
		)
		.orderBy(asc(schema.blocks.start));
}

export async function getBlocksBetween(
	userId: string,
	from: Date,
	to: Date
): Promise<BlockRow[]> {
	return db
		.select()
		.from(schema.blocks)
		.where(
			and(
				eq(schema.blocks.userId, userId),
				gte(schema.blocks.start, from),
				lt(schema.blocks.start, to)
			)
		)
		.orderBy(asc(schema.blocks.start));
}

export async function getBlock(userId: string, blockId: string): Promise<BlockRow | null> {
	const [row] = await db
		.select()
		.from(schema.blocks)
		.where(and(eq(schema.blocks.userId, userId), eq(schema.blocks.id, blockId)));
	return row ?? null;
}

export async function updateBlock(
	userId: string,
	blockId: string,
	values: Partial<typeof schema.blocks.$inferInsert>
) {
	await db
		.update(schema.blocks)
		.set(values)
		.where(and(eq(schema.blocks.userId, userId), eq(schema.blocks.id, blockId)));
}

/** Google event ids we have written and may need to clean up. */
export async function getKnownGoogleEventIds(userId: string): Promise<string[]> {
	const rows = await db
		.select({ googleEventId: schema.blocks.googleEventId })
		.from(schema.blocks)
		.where(and(eq(schema.blocks.userId, userId), isNotNull(schema.blocks.googleEventId)));
	return rows.map((r) => r.googleEventId).filter((id): id is string => id !== null);
}

export async function addCalibrationSample(
	userId: string,
	sample: Omit<typeof schema.calibrationSamples.$inferInsert, 'userId'>
) {
	await db.insert(schema.calibrationSamples).values({ ...sample, userId });
}

export async function getCalibrationSamples(userId: string): Promise<CalibrationSample[]> {
	const rows = await db
		.select()
		.from(schema.calibrationSamples)
		.where(eq(schema.calibrationSamples.userId, userId));

	return rows.map((row) => ({
		taskKind: row.taskKind,
		projectId: row.projectId,
		estimateHours: row.estimateHours,
		actualHours: row.actualHours
	}));
}

/** Tasks blocked on someone else — shown, but not scheduled. */
export async function listWaitingTasks(userId: string): Promise<TaskRow[]> {
	return db
		.select()
		.from(schema.tasks)
		.where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.status, 'waiting')))
		.orderBy(asc(schema.tasks.deadline));
}

/** Used by the today view: is anything due or overdue that we should shout about? */
export async function tasksWithDeadlineBefore(userId: string, before: Date): Promise<TaskRow[]> {
	return db
		.select()
		.from(schema.tasks)
		.where(
			and(
				eq(schema.tasks.userId, userId),
				ne(schema.tasks.status, 'done'),
				isNotNull(schema.tasks.deadline),
				or(lt(schema.tasks.deadline, before), eq(schema.tasks.status, 'waiting'))
			)
		)
		.orderBy(asc(schema.tasks.deadline));
}
