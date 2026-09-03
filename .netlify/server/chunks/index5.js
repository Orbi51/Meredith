import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { b as private_env } from "./shared-server.js";
import { relations } from "drizzle-orm";
import { pgEnum, pgTable, timestamp, text, uuid, integer, boolean, doublePrecision, jsonb } from "drizzle-orm/pg-core";
const projectStatus = pgEnum("project_status", ["active", "waiting", "done", "archived"]);
const taskStatus = pgEnum("task_status", ["inbox", "active", "waiting", "done"]);
const taskKind = pgEnum("task_kind", ["creative", "admin", "machine"]);
const blockStatus = pgEnum("block_status", ["planned", "confirmed", "skipped"]);
const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  googleAccountId: text("google_account_id"),
  /** Encrypted at rest — see `$lib/server/crypto`. Never send this to a client. */
  googleRefreshToken: text("google_refresh_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
const settings = pgTable("settings", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("Europe/Paris"),
  /** The app's own secondary calendar. The only calendar we ever write to. */
  targetCalendarId: text("target_calendar_id"),
  /** Incremental sync token from the Google events.list response. */
  syncToken: text("sync_token"),
  weeklyCapacityHours: doublePrecision("weekly_capacity_hours").notNull().default(35),
  defaultBufferPercent: integer("default_buffer_percent").notNull().default(0),
  calibrationEnabled: boolean("calibration_enabled").notNull().default(true),
  horizonDays: integer("horizon_days").notNull().default(21),
  /**
   * ISO week of the last completed Monday ritual, e.g. "2026-W37". The app
   * opens straight to /plan on Monday mornings until this matches the current
   * week.
   */
  ritualCompletedWeek: text("ritual_completed_week"),
  /**
   * A fingerprint of the last overcommitment report the user was notified
   * about. §10: interrupt only when the report gets WORSE. A notification
   * because the calendar shuffled is noise, and noise is why people abandon
   * these tools.
   */
  lastRiskDigest: text("last_risk_digest"),
  lastBriefSentOn: text("last_brief_sent_on")
});
const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  clientName: text("client_name"),
  deadline: timestamp("deadline", { withTimezone: true }),
  agreedHours: doublePrecision("agreed_hours"),
  /** Used with actual hours worked to show an effective hourly rate. */
  agreedFee: doublePrecision("agreed_fee"),
  /**
   * ISO 4217 code the fee is agreed in. Japanese clients bill in JPY; the
   * books are in EUR.
   */
  currency: text("currency").notNull().default("EUR"),
  /**
   * How many EUR one unit of `currency` buys. Frozen once set rather than
   * recomputed: for accounts, the rate that counts is the one on the invoice
   * date, not today's — and a fee that silently changes value every time the
   * page loads is not a number anyone can plan against.
   */
  fxRateToEur: doublePrecision("fx_rate_to_eur"),
  /** The date the stored rate is from (ECB reference rate). */
  fxRateAt: text("fx_rate_at"),
  status: projectStatus("status").notNull().default("active"),
  color: text("color").notNull().default("#6366f1"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  notes: text("notes"),
  /** null means "infer from the median actual of similar past tasks". */
  estimateHours: doublePrecision("estimate_hours"),
  deadline: timestamp("deadline", { withTimezone: true }),
  earliestStart: timestamp("earliest_start", { withTimezone: true }),
  kind: taskKind("kind").notNull().default("creative"),
  splittable: boolean("splittable").notNull().default(true),
  minBlockMinutes: integer("min_block_minutes").notNull().default(120),
  dependsOnTaskId: uuid("depends_on_task_id"),
  status: taskStatus("status").notNull().default("inbox"),
  /** e.g. "client feedback" — a waiting task still consumes future capacity. */
  waitingReason: text("waiting_reason"),
  /** ISO week, e.g. "2026-W37". Set during the Monday ritual. */
  committedToWeek: text("committed_to_week"),
  /**
   * 'app' for tasks captured here, 'calendar' for work adopted from an event
   * already in Google Calendar. Adopted tasks are shown differently and their
   * time is fixed — the app never moves an event it does not own.
   */
  source: text("source", { enum: ["app", "calendar"] }).notNull().default("app"),
  /** The Google event this task was adopted from. Null for app-created tasks. */
  sourceEventId: text("source_event_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true })
});
const blocks = pgTable("blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  start: timestamp("start", { withTimezone: true }).notNull(),
  end: timestamp("end", { withTimezone: true }).notNull(),
  /**
   * Stable mapping to the Google event. On replan we UPDATE the event at this
   * id — never delete-and-recreate, which would destroy notification state.
   */
  googleEventId: text("google_event_id"),
  status: blockStatus("status").notNull().default("planned"),
  /** Filled in on confirmation; feeds the calibration samples. */
  actualMinutes: integer("actual_minutes"),
  /**
   * 'app' — we created this event on our own calendar and may move or delete
   * it. 'external' — it mirrors an event on one of the user's own calendars.
   * External blocks are never written to, moved or deleted by a replan.
   */
  source: text("source", { enum: ["app", "external"] }).notNull().default("app"),
  pool: text("pool").notNull().default("human")
});
const workingHours = pgTable("working_hours", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** 0 = Sunday ... 6 = Saturday. */
  dayOfWeek: integer("day_of_week").notNull(),
  /** [{ start: "09:00", end: "12:30", preferredKind: "creative" | null }] */
  intervals: jsonb("intervals").$type().notNull()
});
const calibrationSamples = pgTable("calibration_samples", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  taskKind: taskKind("task_kind").notNull(),
  estimateHours: doublePrecision("estimate_hours"),
  actualHours: doublePrecision("actual_hours").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow()
});
const projectRelations = relations(projects, ({ many }) => ({
  tasks: many(tasks)
}));
const taskRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  blocks: many(blocks)
}));
const blockRelations = relations(blocks, ({ one }) => ({
  task: one(tasks, { fields: [blocks.taskId], references: [tasks.id] })
}));
const ignoredEvents = pgTable("ignored_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  googleEventId: text("google_event_id").notNull(),
  ignoredAt: timestamp("ignored_at", { withTimezone: true }).notNull().defaultNow()
});
const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
const schema = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  blockRelations,
  blockStatus,
  blocks,
  calibrationSamples,
  ignoredEvents,
  projectRelations,
  projectStatus,
  projects,
  pushSubscriptions,
  settings,
  taskKind,
  taskRelations,
  taskStatus,
  tasks,
  users,
  workingHours
}, Symbol.toStringTag, { value: "Module" }));
let instance = null;
function getDb() {
  if (!instance) {
    if (!private_env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
    }
    instance = drizzle(postgres(private_env.DATABASE_URL, { max: 5 }), { schema });
  }
  return instance;
}
const db = new Proxy({}, {
  get(_target, property) {
    const real = getDb();
    const value = Reflect.get(real, property);
    return typeof value === "function" ? value.bind(real) : value;
  }
});
export {
  projects as a,
  blocks as b,
  calibrationSamples as c,
  db as d,
  ignoredEvents as i,
  pushSubscriptions as p,
  settings as s,
  tasks as t,
  users as u,
  workingHours as w
};
