import { and, eq, inArray } from "drizzle-orm";
import { d as db, i as ignoredEvents, t as tasks, b as blocks, u as users } from "./index5.js";
import { d as getSettings, m as updateSettings, f as listProjects, t as getFrozenBlocks, i as getSchedulableTasks, o as getWorkingHours, h as getCalibrationSamples, w as getFutureBlocks } from "./queries.js";
import { s as schedule, b as buildCalibrationTable, e as effectiveEstimate } from "./index3.js";
import { c as clientForUser, e as ensureTargetCalendar, d as readAppointments, g as eventDescription, h as eventSummary, p as planSync, a as applySync, r as readBusyIntervals } from "./write.js";
import { p as parseStructured, d as detectKind } from "./structured.js";
function looksLikeWork(appointment) {
  if (appointment.allDay) return false;
  return /\s+[-–—]\s+/.test(appointment.summary);
}
async function adoptCalendarWork(userId, appointments, projects, timezone, now) {
  const candidates = appointments.filter(looksLikeWork);
  if (candidates.length === 0) return { adopted: 0, updated: 0, skippedIgnored: 0 };
  const eventIds = candidates.map((a) => a.eventId);
  const ignored = new Set(
    (await db.select({ id: ignoredEvents.googleEventId }).from(ignoredEvents).where(
      and(
        eq(ignoredEvents.userId, userId),
        inArray(ignoredEvents.googleEventId, eventIds)
      )
    )).map((row) => row.id)
  );
  const existing = await db.select().from(tasks).where(
    and(eq(tasks.userId, userId), inArray(tasks.sourceEventId, eventIds))
  );
  const existingByEvent = new Map(existing.map((task) => [task.sourceEventId, task]));
  const choices = projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName }));
  const result = { adopted: 0, updated: 0, skippedIgnored: 0 };
  for (const appointment of candidates) {
    if (ignored.has(appointment.eventId)) {
      result.skippedIgnored++;
      continue;
    }
    const hours = (appointment.end.getTime() - appointment.start.getTime()) / 36e5;
    const already = existingByEvent.get(appointment.eventId);
    if (already) {
      await moveMirroredBlock(userId, already.id, appointment);
      result.updated++;
      continue;
    }
    const parsed = parseStructured(appointment.summary, { projects: choices, timezone, now });
    const [task] = await db.insert(tasks).values({
      userId,
      title: parsed.title,
      projectId: parsed.projectId,
      // The event's own length is the estimate — it is what the user set
      // aside for the job, which is a better number than any guess.
      estimateHours: Math.round(hours * 100) / 100,
      deadline: parsed.deadline,
      kind: detectKind(appointment.summary)?.value ?? parsed.kind,
      status: "active",
      source: "calendar",
      sourceEventId: appointment.eventId,
      notes: parsed.unmatchedProjectName ? `From calendar. Project "${parsed.unmatchedProjectName}" is not set up here yet.` : "From calendar."
    }).returning();
    if (!task) continue;
    await db.insert(blocks).values({
      userId,
      taskId: task.id,
      start: appointment.start,
      end: appointment.end,
      // No googleEventId: that column means "an event WE created and may
      // delete". This block mirrors someone else's event and must never be
      // handed to the sync.
      googleEventId: null,
      status: "planned",
      pool: "human",
      source: "external"
    });
    result.adopted++;
  }
  return result;
}
async function moveMirroredBlock(userId, taskId, appointment) {
  const [block] = await db.select().from(blocks).where(
    and(
      eq(blocks.userId, userId),
      eq(blocks.taskId, taskId),
      eq(blocks.source, "external")
    )
  );
  if (!block) return;
  if (block.start.getTime() === appointment.start.getTime() && block.end.getTime() === appointment.end.getTime()) {
    return;
  }
  if (block.status !== "planned") return;
  await db.update(blocks).set({ start: appointment.start, end: appointment.end }).where(eq(blocks.id, block.id));
}
async function dismissAdoptedTask(userId, taskId) {
  const [task] = await db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.id, taskId)));
  if (!task || task.source !== "calendar" || !task.sourceEventId) return false;
  await db.insert(ignoredEvents).values({ userId, googleEventId: task.sourceEventId }).onConflictDoNothing();
  await db.delete(tasks).where(eq(tasks.id, task.id));
  return true;
}
async function buildSchedulerInput(userId, now, busyIntervals, frozen, settings) {
  const [tasks2, workingHours, samples] = await Promise.all([
    getSchedulableTasks(userId, now),
    getWorkingHours(userId),
    getCalibrationSamples(userId)
  ]);
  const frozenAsBusy = frozen.filter((block) => block.end.getTime() > now.getTime() && block.pool === "human").map((block) => ({ start: block.start, end: block.end }));
  return {
    now,
    horizonDays: settings.horizonDays,
    tasks: tasks2,
    busyIntervals: [...busyIntervals, ...frozenAsBusy],
    workingHours,
    calibration: buildCalibrationTable(samples),
    timezone: settings.timezone
  };
}
async function replan(userId, options = {}) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const warnings = [];
  const settings = await getSettings(userId);
  if (!settings) throw new Error("No settings row for this user.");
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const canUseGoogle = Boolean(user?.googleRefreshToken) && !options.skipCalendar;
  let busyIntervals = [];
  let auth = null;
  let targetCalendarId = settings.targetCalendarId;
  if (canUseGoogle) {
    try {
      auth = clientForUser(user.googleRefreshToken);
      targetCalendarId = await ensureTargetCalendar(
        auth,
        settings.timezone,
        settings.targetCalendarId
      );
      if (targetCalendarId !== settings.targetCalendarId) {
        await updateSettings(userId, { targetCalendarId });
      }
      const appointments = await readAppointments(auth, {
        timeMin: now,
        timeMax: new Date(now.getTime() + settings.horizonDays * 24 * 36e5),
        excludeCalendarId: targetCalendarId,
        timezone: settings.timezone
      });
      busyIntervals = appointments.map((a) => ({ start: a.start, end: a.end }));
      await adoptCalendarWork(
        userId,
        appointments,
        await listProjects(userId),
        settings.timezone,
        now
      );
    } catch (error) {
      warnings.push(
        `Could not read Google Calendar: ${error instanceof Error ? error.message : String(error)}`
      );
      auth = null;
    }
  }
  const frozen = await getFrozenBlocks(userId, now);
  const input = await buildSchedulerInput(userId, now, busyIntervals, frozen, settings);
  const output = schedule(input);
  const { kept: blockRows, orphanedEventIds } = await persistBlocks(userId, now, output);
  let calendarSync = null;
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
        `Plan saved, but Google Calendar was not updated: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return { output, blocksWritten: blockRows.length, calendarSync, warnings };
}
async function persistBlocks(userId, now, output) {
  const existing = await getFutureBlocks(userId, now);
  const spareByTask = /* @__PURE__ */ new Map();
  for (const row of existing) {
    const list = spareByTask.get(row.taskId);
    if (list) list.push(row);
    else spareByTask.set(row.taskId, [row]);
  }
  const kept = [];
  for (const block of output.blocks) {
    const spares = spareByTask.get(block.taskId);
    const reused = spares?.shift();
    if (reused) {
      const [row] = await db.update(blocks).set({ start: block.start, end: block.end, pool: block.pool, status: "planned" }).where(eq(blocks.id, reused.id)).returning();
      if (row) kept.push(row);
    } else {
      const [row] = await db.insert(blocks).values({
        userId,
        taskId: block.taskId,
        start: block.start,
        end: block.end,
        pool: block.pool,
        status: "planned"
      }).returning();
      if (row) kept.push(row);
    }
  }
  const orphanedEventIds = [];
  for (const spares of spareByTask.values()) {
    for (const orphan of spares) {
      if (orphan.googleEventId) orphanedEventIds.push(orphan.googleEventId);
      await db.delete(blocks).where(eq(blocks.id, orphan.id));
    }
  }
  return { kept, orphanedEventIds };
}
async function pushToCalendar(userId, auth, targetCalendarId, settings, blocks$1, orphanedEventIds, input) {
  const projects = await listProjects(userId);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  const desired = [];
  for (const block of blocks$1) {
    if (block.source === "external") continue;
    const task = taskById.get(block.taskId);
    if (!task) continue;
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
  const previouslyWritten = blocks$1.map((b) => b.googleEventId).filter((id) => id !== null);
  const plan = planSync(desired, [...previouslyWritten, ...orphanedEventIds]);
  const applied = await applySync(
    auth,
    targetCalendarId,
    targetCalendarId,
    plan,
    settings.timezone
  );
  for (const { blockId, googleEventId } of applied) {
    await db.update(blocks).set({ googleEventId }).where(eq(blocks.id, blockId));
  }
  return {
    inserted: plan.insert.length,
    updated: plan.update.length,
    removed: plan.remove.length
  };
}
function baseUrl() {
  return process.env.PUBLIC_BASE_URL ?? "http://localhost:5173";
}
async function previewPlan(userId, options = {}) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const warnings = [];
  const settings = await getSettings(userId);
  if (!settings) throw new Error("No settings row for this user.");
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  let busyIntervals = [];
  if (user?.googleRefreshToken) {
    try {
      const auth = clientForUser(user.googleRefreshToken);
      busyIntervals = await readBusyIntervals(auth, {
        timeMin: now,
        timeMax: new Date(now.getTime() + settings.horizonDays * 24 * 36e5),
        excludeCalendarId: settings.targetCalendarId,
        timezone: settings.timezone
      });
    } catch (error) {
      warnings.push(
        `Could not read Google Calendar: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  const frozen = await getFrozenBlocks(userId, now);
  const input = await buildSchedulerInput(userId, now, busyIntervals, frozen, settings);
  return { output: schedule(input), input, warnings };
}
export {
  buildSchedulerInput as b,
  dismissAdoptedTask as d,
  previewPlan as p,
  replan as r
};
