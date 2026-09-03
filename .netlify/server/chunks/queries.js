import { eq, and, ne, asc, gte, lt, or, lte, inArray } from "drizzle-orm";
import { d as db, s as settings, t as tasks, b as blocks, a as projects, w as workingHours, c as calibrationSamples, u as users } from "./index5.js";
import { D as DEFAULT_MIN_BLOCK_MINUTES } from "./types.js";
const SCHEDULABLE_STATUSES = ["inbox", "active"];
async function getUserByEmail(email) {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user ?? null;
}
async function getSettings(userId) {
  const [row] = await db.select().from(settings).where(eq(settings.userId, userId));
  return row ?? null;
}
async function updateSettings(userId, values) {
  await db.update(settings).set(values).where(eq(settings.userId, userId));
}
async function getWorkingHours(userId) {
  const rows = await db.select().from(workingHours).where(eq(workingHours.userId, userId)).orderBy(asc(workingHours.dayOfWeek));
  return rows.map((row) => ({
    dayOfWeek: row.dayOfWeek,
    intervals: row.intervals
  }));
}
async function replaceWorkingHours(userId, hours) {
  await db.delete(workingHours).where(eq(workingHours.userId, userId));
  if (hours.length === 0) return;
  await db.insert(workingHours).values(
    hours.map((h) => ({
      userId,
      dayOfWeek: h.dayOfWeek,
      intervals: h.intervals
    }))
  );
}
async function listProjects(userId) {
  return db.select().from(projects).where(and(eq(projects.userId, userId), ne(projects.status, "archived"))).orderBy(asc(projects.name));
}
async function createProject(userId, values) {
  const [row] = await db.insert(projects).values({ ...values, userId }).returning();
  return row;
}
async function updateProject(userId, projectId, values) {
  await db.update(projects).set(values).where(and(eq(projects.userId, userId), eq(projects.id, projectId)));
}
async function listTasks(userId) {
  return db.select().from(tasks).where(and(eq(tasks.userId, userId), ne(tasks.status, "done"))).orderBy(asc(tasks.createdAt));
}
async function getTask(userId, taskId) {
  const [row] = await db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.id, taskId)));
  return row ?? null;
}
async function createTask(userId, values) {
  const kind = values.kind ?? "creative";
  const [row] = await db.insert(tasks).values({
    ...values,
    userId,
    // A sensible minimum block follows from the kind unless the user says
    // otherwise — creative work in 30-minute slivers is worthless.
    minBlockMinutes: values.minBlockMinutes ?? DEFAULT_MIN_BLOCK_MINUTES[kind]
  }).returning();
  return row;
}
async function updateTask(userId, taskId, values) {
  await db.update(tasks).set(values).where(and(eq(tasks.userId, userId), eq(tasks.id, taskId)));
}
async function deleteTask(userId, taskId) {
  await db.delete(tasks).where(and(eq(tasks.userId, userId), eq(tasks.id, taskId)));
}
async function getSchedulableTasks(userId, now) {
  const rows = await db.select().from(tasks).where(
    and(
      eq(tasks.userId, userId),
      inArray(tasks.status, [...SCHEDULABLE_STATUSES]),
      // Work adopted from the calendar already has its slot. Scheduling
      // it again would reserve a second one for the same job.
      eq(tasks.source, "app")
    )
  ).orderBy(asc(tasks.createdAt));
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
async function hoursWorkedByTask(userId, now) {
  const rows = await db.select().from(blocks).where(and(eq(blocks.userId, userId), lt(blocks.start, now)));
  const byTask = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (row.status === "skipped") continue;
    const plannedHours = (row.end.getTime() - row.start.getTime()) / 36e5;
    const hours = row.actualMinutes !== null ? row.actualMinutes / 60 : plannedHours;
    byTask.set(row.taskId, (byTask.get(row.taskId) ?? 0) + hours);
  }
  return byTask;
}
async function getFrozenBlocks(userId, now) {
  return db.select().from(blocks).where(
    and(
      eq(blocks.userId, userId),
      // Already started, OR mirroring an event on the user's own calendar.
      // An external block is frozen at any time: the app does not own that
      // event and has no business moving the work away from it.
      or(lte(blocks.start, now), eq(blocks.source, "external"))
    )
  ).orderBy(asc(blocks.start));
}
async function getFutureBlocks(userId, now) {
  return db.select().from(blocks).where(
    and(
      eq(blocks.userId, userId),
      gte(blocks.start, now),
      eq(blocks.status, "planned"),
      // Never a candidate for reuse or deletion — see getFrozenBlocks.
      eq(blocks.source, "app")
    )
  ).orderBy(asc(blocks.start));
}
async function getBlocksBetween(userId, from, to) {
  return db.select().from(blocks).where(
    and(
      eq(blocks.userId, userId),
      gte(blocks.start, from),
      lt(blocks.start, to)
    )
  ).orderBy(asc(blocks.start));
}
async function getBlock(userId, blockId) {
  const [row] = await db.select().from(blocks).where(and(eq(blocks.userId, userId), eq(blocks.id, blockId)));
  return row ?? null;
}
async function updateBlock(userId, blockId, values) {
  await db.update(blocks).set(values).where(and(eq(blocks.userId, userId), eq(blocks.id, blockId)));
}
async function addCalibrationSample(userId, sample) {
  await db.insert(calibrationSamples).values({ ...sample, userId });
}
async function getCalibrationSamples(userId) {
  const rows = await db.select().from(calibrationSamples).where(eq(calibrationSamples.userId, userId));
  return rows.map((row) => ({
    taskKind: row.taskKind,
    projectId: row.projectId,
    estimateHours: row.estimateHours,
    actualHours: row.actualHours
  }));
}
async function listWaitingTasks(userId) {
  return db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.status, "waiting"))).orderBy(asc(tasks.deadline));
}
async function getAllFutureBlocks(userId, now) {
  return db.select().from(blocks).where(
    and(
      eq(blocks.userId, userId),
      gte(blocks.start, now),
      ne(blocks.status, "skipped")
    )
  ).orderBy(asc(blocks.start));
}
export {
  updateBlock as a,
  getTask as b,
  addCalibrationSample as c,
  getSettings as d,
  getBlocksBetween as e,
  listProjects as f,
  getBlock as g,
  getCalibrationSamples as h,
  getSchedulableTasks as i,
  createProject as j,
  createTask as k,
  listTasks as l,
  updateSettings as m,
  listWaitingTasks as n,
  getWorkingHours as o,
  updateProject as p,
  deleteTask as q,
  replaceWorkingHours as r,
  getAllFutureBlocks as s,
  getFrozenBlocks as t,
  updateTask as u,
  getUserByEmail as v,
  getFutureBlocks as w
};
