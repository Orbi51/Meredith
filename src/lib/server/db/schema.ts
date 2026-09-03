/**
 * Drizzle schema — §4 of the plan.
 *
 * Single user, but everything hangs off a `users` row anyway: it is where the
 * Google refresh token and the settings live, and it costs nothing now.
 *
 * All timestamps are `timestamp with time zone` and are stored as UTC. The
 * user's timezone lives in settings and is applied at display time only.
 */

import { relations } from 'drizzle-orm';
import {
	boolean,
	doublePrecision,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core';

export const projectStatus = pgEnum('project_status', ['active', 'waiting', 'done', 'archived']);
export const taskStatus = pgEnum('task_status', ['inbox', 'active', 'waiting', 'done']);
export const taskKind = pgEnum('task_kind', ['creative', 'admin', 'machine']);
export const blockStatus = pgEnum('block_status', ['planned', 'confirmed', 'skipped']);

export const users = pgTable('users', {
	id: uuid('id').primaryKey().defaultRandom(),
	email: text('email').notNull().unique(),
	name: text('name'),
	googleAccountId: text('google_account_id'),
	/** Encrypted at rest — see `$lib/server/crypto`. Never send this to a client. */
	googleRefreshToken: text('google_refresh_token'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const settings = pgTable('settings', {
	userId: uuid('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	timezone: text('timezone').notNull().default('Europe/Paris'),
	/** The app's own secondary calendar. The only calendar we ever write to. */
	targetCalendarId: text('target_calendar_id'),
	/** Incremental sync token from the Google events.list response. */
	syncToken: text('sync_token'),
	weeklyCapacityHours: doublePrecision('weekly_capacity_hours').notNull().default(35),
	defaultBufferPercent: integer('default_buffer_percent').notNull().default(0),
	calibrationEnabled: boolean('calibration_enabled').notNull().default(true),
	horizonDays: integer('horizon_days').notNull().default(21),
	/**
	 * ISO week of the last completed Monday ritual, e.g. "2026-W37". The app
	 * opens straight to /plan on Monday mornings until this matches the current
	 * week.
	 */
	ritualCompletedWeek: text('ritual_completed_week')
});

export const projects = pgTable('projects', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	clientName: text('client_name'),
	deadline: timestamp('deadline', { withTimezone: true }),
	agreedHours: doublePrecision('agreed_hours'),
	/** Used with actual hours worked to show an effective hourly rate. */
	agreedFee: doublePrecision('agreed_fee'),
	status: projectStatus('status').notNull().default('active'),
	color: text('color').notNull().default('#6366f1'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const tasks = pgTable('tasks', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
	title: text('title').notNull(),
	notes: text('notes'),
	/** null means "infer from the median actual of similar past tasks". */
	estimateHours: doublePrecision('estimate_hours'),
	deadline: timestamp('deadline', { withTimezone: true }),
	earliestStart: timestamp('earliest_start', { withTimezone: true }),
	kind: taskKind('kind').notNull().default('creative'),
	splittable: boolean('splittable').notNull().default(true),
	minBlockMinutes: integer('min_block_minutes').notNull().default(120),
	dependsOnTaskId: uuid('depends_on_task_id'),
	status: taskStatus('status').notNull().default('inbox'),
	/** e.g. "client feedback" — a waiting task still consumes future capacity. */
	waitingReason: text('waiting_reason'),
	/** ISO week, e.g. "2026-W37". Set during the Monday ritual. */
	committedToWeek: text('committed_to_week'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	completedAt: timestamp('completed_at', { withTimezone: true })
});

export const blocks = pgTable('blocks', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	taskId: uuid('task_id')
		.notNull()
		.references(() => tasks.id, { onDelete: 'cascade' }),
	start: timestamp('start', { withTimezone: true }).notNull(),
	end: timestamp('end', { withTimezone: true }).notNull(),
	/**
	 * Stable mapping to the Google event. On replan we UPDATE the event at this
	 * id — never delete-and-recreate, which would destroy notification state.
	 */
	googleEventId: text('google_event_id'),
	status: blockStatus('status').notNull().default('planned'),
	/** Filled in on confirmation; feeds the calibration samples. */
	actualMinutes: integer('actual_minutes'),
	pool: text('pool').notNull().default('human')
});

export const workingHours = pgTable('working_hours', {
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	/** 0 = Sunday ... 6 = Saturday. */
	dayOfWeek: integer('day_of_week').notNull(),
	/** [{ start: "09:00", end: "12:30", preferredKind: "creative" | null }] */
	intervals: jsonb('intervals')
		.$type<{ start: string; end: string; preferredKind: 'creative' | 'admin' | null }[]>()
		.notNull()
});

export const calibrationSamples = pgTable('calibration_samples', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
	projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
	taskKind: taskKind('task_kind').notNull(),
	estimateHours: doublePrecision('estimate_hours'),
	actualHours: doublePrecision('actual_hours').notNull(),
	completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow()
});

export const projectRelations = relations(projects, ({ many }) => ({
	tasks: many(tasks)
}));

export const taskRelations = relations(tasks, ({ one, many }) => ({
	project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
	blocks: many(blocks)
}));

export const blockRelations = relations(blocks, ({ one }) => ({
	task: one(tasks, { fields: [blocks.taskId], references: [tasks.id] })
}));
