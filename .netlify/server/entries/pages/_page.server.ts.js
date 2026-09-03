import { fail, redirect } from "@sveltejs/kit";
import { formatInTimeZone } from "date-fns-tz";
import { c as currentUser } from "../../chunks/auth.js";
import { u as updateTask, g as getBlock, a as updateBlock, b as getTask, c as addCalibrationSample, d as getSettings, e as getBlocksBetween, l as listTasks, f as listProjects, h as getCalibrationSamples, i as getSchedulableTasks } from "../../chunks/queries.js";
import { b as buildCalibrationTable, e as effectiveEstimate } from "../../chunks/index3.js";
import { r as replan } from "../../chunks/planner.js";
import { w as wallClockToInstant } from "../../chunks/intervals.js";
const load = async (event) => {
  const user = await currentUser(event);
  if (!user) return { signedIn: false };
  const settings = await getSettings(event.locals.userId ? event.locals.userId : user.id);
  const timezone = settings?.timezone ?? "Europe/Paris";
  const now = /* @__PURE__ */ new Date();
  const isoDayOfWeek = Number(formatInTimeZone(now, timezone, "i"));
  const hourOfDay = Number(formatInTimeZone(now, timezone, "H"));
  const currentWeek = formatInTimeZone(now, timezone, "RRRR-'W'II");
  if (isoDayOfWeek === 1 && hourOfDay < 12 && settings?.ritualCompletedWeek !== currentWeek) {
    redirect(303, "/plan");
  }
  const civilToday = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const dayStart = wallClockToInstant(civilToday, "00:00", timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 36e5);
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
  const hoursOf = (start, end) => (end.getTime() - start.getTime()) / 36e5;
  const humanBlocks = blocks.filter((b) => b.pool === "human");
  const committedHours = humanBlocks.reduce((sum, b) => sum + hoursOf(b.start, b.end), 0);
  const remainingHours = humanBlocks.filter((b) => b.end.getTime() > now.getTime() && b.status === "planned").reduce((sum, b) => sum + hoursOf(b.start, b.end), 0);
  const next = humanBlocks.find((b) => b.end.getTime() > now.getTime() && b.status === "planned");
  return {
    signedIn: true,
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
        title: task?.title ?? "Unknown task",
        projectName: project?.name ?? null,
        projectColor: project?.color ?? null
      };
    }),
    atRisk: schedulable.filter((task) => task.deadline && task.deadline.getTime() < now.getTime()).map((task) => ({
      taskId: task.id,
      title: task.title,
      deadline: task.deadline,
      effectiveHours: effectiveEstimate(task, calibration).effectiveHours
    }))
  };
};
const ADJUSTMENT_MINUTES = 30;
const actions = {
  /**
   * One tap per finished block: as planned / +30 / −30 / skipped.
   * Confirming records a calibration sample; skipping returns the work to the
   * pool so the next replan finds a new home for it — never silently dropped.
   */
  confirm: async (event) => {
    const user = await currentUser(event);
    if (!user) return fail(401, { message: "Signed out." });
    const form = await event.request.formData();
    const blockId = String(form.get("blockId") ?? "");
    const outcome = String(form.get("outcome") ?? "");
    const block = await getBlock(user.id, blockId);
    if (!block) return fail(404, { message: "No such block." });
    const plannedMinutes = (block.end.getTime() - block.start.getTime()) / 6e4;
    if (outcome === "skipped") {
      await updateBlock(user.id, blockId, { status: "skipped", actualMinutes: 0 });
      await replanQuietly(user.id);
      return { ok: true };
    }
    const actualMinutes = outcome === "more" ? plannedMinutes + ADJUSTMENT_MINUTES : outcome === "less" ? Math.max(0, plannedMinutes - ADJUSTMENT_MINUTES) : plannedMinutes;
    await updateBlock(user.id, blockId, { status: "confirmed", actualMinutes });
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
    if (!user) return fail(401, { message: "Signed out." });
    const form = await event.request.formData();
    const taskId = String(form.get("taskId") ?? "");
    await updateTask(user.id, taskId, { status: "done", completedAt: /* @__PURE__ */ new Date() });
    await replanQuietly(user.id);
    return { ok: true };
  }
};
async function replanQuietly(userId) {
  try {
    await replan(userId);
  } catch {
  }
}
export {
  actions,
  load
};
