import { fail } from "@sveltejs/kit";
import { formatInTimeZone } from "date-fns-tz";
import { and, eq, gte, lt } from "drizzle-orm";
import { d as db, b as blocks } from "../../../chunks/index5.js";
import { r as requireUser } from "../../../chunks/auth.js";
import { d as getSettings, m as updateSettings, u as updateTask, g as getBlock, a as updateBlock, b as getTask, c as addCalibrationSample, i as getSchedulableTasks, f as listProjects, h as getCalibrationSamples, n as listWaitingTasks, o as getWorkingHours, l as listTasks } from "../../../chunks/queries.js";
import { b as buildCalibrationTable, e as effectiveEstimate, c as availableHoursBetween } from "../../../chunks/index3.js";
import { e as expandWorkingHours, s as subtractIntervals, t as totalHours, w as wallClockToInstant, a as addCivilDays } from "../../../chunks/intervals.js";
import { d as readAppointments, c as clientForUser } from "../../../chunks/write.js";
import { r as replan, p as previewPlan } from "../../../chunks/planner.js";
const PRESSURE_HORIZON_DAYS = 21;
function isoWeek(instant, timezone) {
  return formatInTimeZone(instant, timezone, "RRRR-'W'II");
}
function mondayOf(instant, timezone, weekOffset = 0) {
  const civil = formatInTimeZone(instant, timezone, "yyyy-MM-dd");
  const isoDow = Number(formatInTimeZone(instant, timezone, "i"));
  return wallClockToInstant(addCivilDays(civil, -(isoDow - 1) + weekOffset * 7), "00:00", timezone);
}
const load = async (event) => {
  const user = await requireUser(event);
  const settings = await getSettings(user.id);
  const timezone = settings?.timezone ?? "Europe/Paris";
  const now = /* @__PURE__ */ new Date();
  const thisMonday = mondayOf(now, timezone);
  const lastMonday = mondayOf(now, timezone, -1);
  const nextMonday = mondayOf(now, timezone, 1);
  const currentWeek = isoWeek(now, timezone);
  const lastWeekBlocks = await db.select().from(blocks).where(
    and(
      eq(blocks.userId, user.id),
      gte(blocks.start, lastMonday),
      lt(blocks.start, thisMonday)
    )
  ).orderBy(blocks.start);
  const [tasks, projects, samples, waiting, workingHours, allRows] = await Promise.all([
    getSchedulableTasks(user.id, now),
    listProjects(user.id),
    getCalibrationSamples(user.id),
    listWaitingTasks(user.id),
    getWorkingHours(user.id),
    listTasks(user.id)
  ]);
  const tasksCommittedThisWeek = new Set(
    allRows.filter((row) => row.committedToWeek === currentWeek).map((row) => row.id)
  );
  const calibration = buildCalibrationTable(samples);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const allTaskTitles = /* @__PURE__ */ new Map();
  for (const task of tasks) allTaskTitles.set(task.id, task.title);
  for (const task of waiting) allTaskTitles.set(task.id, task.title);
  const hoursOf = (a, b) => (b.getTime() - a.getTime()) / 36e5;
  const review = lastWeekBlocks.map((block) => ({
    id: block.id,
    start: block.start,
    end: block.end,
    status: block.status,
    plannedHours: Math.round(hoursOf(block.start, block.end) * 100) / 100,
    actualHours: block.actualMinutes !== null ? block.actualMinutes / 60 : null,
    title: allTaskTitles.get(block.taskId) ?? "Unknown task"
  }));
  const reviewTotals = {
    planned: Math.round(review.reduce((s, b) => s + b.plannedHours, 0) * 100) / 100,
    actual: Math.round(
      review.reduce((s, b) => s + (b.actualHours ?? (b.status === "skipped" ? 0 : 0)), 0) * 100
    ) / 100,
    unreviewed: review.filter((b) => b.status === "planned").length
  };
  const pressureUntil = new Date(now.getTime() + PRESSURE_HORIZON_DAYS * 24 * 36e5);
  let horizonAppointments = [];
  const warnings = [];
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
  const from = now.getTime() > thisMonday.getTime() ? now : thisMonday;
  const workingIntervals = expandWorkingHours(workingHours, from, nextMonday, timezone);
  const freeIntervals = subtractIntervals(workingIntervals, appointments);
  const workingHoursThisWeek = Math.round(totalHours(workingIntervals) * 10) / 10;
  const availableHours = Math.round(totalHours(freeIntervals) * 10) / 10;
  const freeOverHorizon = subtractIntervals(
    expandWorkingHours(workingHours, now, pressureUntil, timezone),
    horizonAppointments
  );
  const pressure = [...tasks, ...waiting.map(toSchedulable)].filter((task) => task.deadline && task.deadline.getTime() <= pressureUntil.getTime()).map((task) => {
    const estimate = effectiveEstimate(task, calibration);
    const remaining = Math.max(0, estimate.effectiveHours - task.hoursAlreadyDone);
    return {
      taskId: task.id,
      title: task.title,
      projectName: task.projectId ? projectById.get(task.projectId)?.name ?? null : null,
      deadline: task.deadline,
      remainingHours: Math.round(remaining * 100) / 100,
      rawHours: estimate.rawHours,
      multiplier: estimate.multiplier,
      inferred: estimate.inferred,
      // Slack in WORKING hours, which is the only measure that tells the
      // truth about a deadline three weeks out with four working days in it.
      slackHours: Math.round(
        (availableHoursBetween(freeOverHorizon, now, task.deadline) - remaining) * 10
      ) / 10,
      waiting: waiting.some((w) => w.id === task.id),
      committed: tasksCommittedThisWeek.has(task.id)
    };
  }).sort((a, b) => a.slackHours - b.slackHours);
  const committable = tasks.map((task) => {
    const estimate = effectiveEstimate(task, calibration);
    const remaining = Math.max(0, estimate.effectiveHours - task.hoursAlreadyDone);
    return {
      taskId: task.id,
      title: task.title,
      projectName: task.projectId ? projectById.get(task.projectId)?.name ?? null : null,
      deadline: task.deadline,
      remainingHours: Math.round(remaining * 100) / 100,
      rawHours: estimate.rawHours,
      multiplier: estimate.multiplier,
      inferred: estimate.inferred,
      committed: tasksCommittedThisWeek.has(task.id)
    };
  });
  const committedHours = Math.round(committable.filter((t) => t.committed).reduce((s, t) => s + t.remainingHours, 0) * 10) / 10;
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
  function toSchedulable(row) {
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
const actions = {
  /** Step 1: one tap per block. Twenty blocks should clear in under a minute. */
  review: async (event) => {
    const user = await requireUser(event);
    const form = await event.request.formData();
    const blockId = String(form.get("blockId") ?? "");
    const outcome = String(form.get("outcome") ?? "");
    const block = await getBlock(user.id, blockId);
    if (!block) return fail(404, { message: "No such block." });
    const plannedMinutes = (block.end.getTime() - block.start.getTime()) / 6e4;
    if (outcome === "skipped") {
      await updateBlock(user.id, blockId, { status: "skipped", actualMinutes: 0 });
      return { ok: true };
    }
    const actualMinutes = outcome === "more" ? plannedMinutes + 30 : outcome === "less" ? Math.max(0, plannedMinutes - 30) : plannedMinutes;
    await updateBlock(user.id, blockId, { status: "confirmed", actualMinutes });
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
    const timezone = settings?.timezone ?? "Europe/Paris";
    const form = await event.request.formData();
    const taskId = String(form.get("taskId") ?? "");
    const wanted = form.get("committed") === "true";
    await updateTask(user.id, taskId, {
      committedToWeek: wanted ? isoWeek(/* @__PURE__ */ new Date(), timezone) : null,
      // Committing to a week is also a decision to start it: an inbox task
      // the user has just promised to do this week is an active task.
      status: wanted ? "active" : void 0
    });
    return { ok: true };
  },
  /** Step 6a: what WOULD happen. Nothing is written. */
  preview: async (event) => {
    const user = await requireUser(event);
    const settings = await getSettings(user.id);
    const timezone = settings?.timezone ?? "Europe/Paris";
    const { output, input, warnings } = await previewPlan(user.id);
    const titles = new Map(input.tasks.map((t) => [t.id, t.title]));
    return {
      preview: {
        blocks: output.blocks.map((block) => ({
          start: block.start.toISOString(),
          end: block.end.toISOString(),
          day: formatInTimeZone(block.start, timezone, "EEE d MMM"),
          time: `${formatInTimeZone(block.start, timezone, "HH:mm")}–${formatInTimeZone(block.end, timezone, "HH:mm")}`,
          title: titles.get(block.taskId) ?? "Unknown task",
          pool: block.pool
        })),
        unplaced: output.unplaced.map((u) => ({
          title: titles.get(u.taskId) ?? "Unknown task",
          hoursShort: u.hoursShort,
          reason: u.reason
        })),
        atRisk: output.atRisk.map((r) => ({
          title: titles.get(r.taskId) ?? "Unknown task",
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
    const timezone = settings?.timezone ?? "Europe/Paris";
    const result = await replan(user.id);
    await updateSettings(user.id, { ritualCompletedWeek: isoWeek(/* @__PURE__ */ new Date(), timezone) });
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
export {
  actions,
  load
};
