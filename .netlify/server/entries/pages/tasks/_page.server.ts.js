import { fail } from "@sveltejs/kit";
import { r as requireUser } from "../../../chunks/auth.js";
import { p as updateProject, j as createProject, q as deleteTask, u as updateTask, l as listTasks, f as listProjects, h as getCalibrationSamples, d as getSettings, i as getSchedulableTasks, s as getAllFutureBlocks } from "../../../chunks/queries.js";
import { b as buildCalibrationTable, e as effectiveEstimate } from "../../../chunks/index3.js";
import { r as replan, d as dismissAdoptedTask } from "../../../chunks/planner.js";
const load = async (event) => {
  const user = await requireUser(event);
  const now = /* @__PURE__ */ new Date();
  const [tasks, projects, samples, settings, schedulable, futureBlocks] = await Promise.all([
    listTasks(user.id),
    listProjects(user.id),
    getCalibrationSamples(user.id),
    getSettings(user.id),
    getSchedulableTasks(user.id, now),
    // Both ours and the adopted ones: this is a display, not a replan.
    getAllFutureBlocks(user.id, now)
  ]);
  const calibration = buildCalibrationTable(samples);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const schedulableById = new Map(schedulable.map((t) => [t.id, t]));
  const plannedHoursByTask = /* @__PURE__ */ new Map();
  for (const block of futureBlocks) {
    const hours = (block.end.getTime() - block.start.getTime()) / 36e5;
    plannedHoursByTask.set(block.taskId, (plannedHoursByTask.get(block.taskId) ?? 0) + hours);
  }
  return {
    timezone: settings?.timezone ?? "Europe/Paris",
    projects: projects.map((p) => ({ id: p.id, name: p.name, status: p.status })),
    tasks: tasks.map((task) => {
      const forScheduler = schedulableById.get(task.id);
      const estimate = forScheduler ? effectiveEstimate(forScheduler, calibration) : effectiveEstimate(task, calibration);
      return {
        id: task.id,
        title: task.title,
        status: task.status,
        kind: task.kind,
        source: task.source,
        deadline: task.deadline,
        earliestStart: task.earliestStart,
        dependsOnTaskId: task.dependsOnTaskId,
        splittable: task.splittable,
        minBlockMinutes: task.minBlockMinutes,
        projectName: task.projectId ? projectById.get(task.projectId)?.name ?? null : null,
        waitingReason: task.waitingReason,
        // Raw and calibrated, always together. A silent multiplier destroys
        // trust in the tool.
        rawHours: estimate.rawHours,
        effectiveHours: Math.round(estimate.effectiveHours * 100) / 100,
        multiplier: estimate.multiplier,
        inferred: estimate.inferred,
        hoursAlreadyDone: forScheduler ? Math.round(forScheduler.hoursAlreadyDone * 100) / 100 : 0,
        plannedHours: Math.round((plannedHoursByTask.get(task.id) ?? 0) * 100) / 100
      };
    })
  };
};
const actions = {
  setStatus: async (event) => {
    const user = await requireUser(event);
    const form = await event.request.formData();
    const taskId = String(form.get("taskId") ?? "");
    const status = String(form.get("status") ?? "");
    if (!["inbox", "active", "waiting", "done"].includes(status)) {
      return fail(400, { message: "Unknown status." });
    }
    await updateTask(user.id, taskId, {
      status,
      // Leaving the reason alone here: the dropdown does not carry one, and
      // blanking it every time the status is touched would lose what the
      // user typed. The edit form owns the reason.
      completedAt: status === "done" ? /* @__PURE__ */ new Date() : null
    });
    await replanQuietly(user.id);
    return { ok: true };
  },
  update: async (event) => {
    const user = await requireUser(event);
    const form = await event.request.formData();
    const taskId = String(form.get("taskId") ?? "");
    const estimateRaw = String(form.get("estimateHours") ?? "").trim();
    const deadlineRaw = String(form.get("deadline") ?? "").trim();
    const deadline = deadlineRaw ? new Date(deadlineRaw) : null;
    const earliestRaw = String(form.get("earliestStart") ?? "").trim();
    const earliestStart = earliestRaw ? new Date(earliestRaw) : null;
    const dependsOn = String(form.get("dependsOnTaskId") ?? "") || null;
    if (dependsOn === taskId) {
      return fail(400, { message: "A task cannot depend on itself." });
    }
    if (dependsOn && await wouldCycle(user.id, taskId, dependsOn)) {
      return fail(400, { message: "That would make two tasks wait for each other." });
    }
    const minBlockRaw = String(form.get("minBlockMinutes") ?? "").trim();
    await updateTask(user.id, taskId, {
      title: String(form.get("title") ?? "").trim() || void 0,
      estimateHours: estimateRaw ? Number(estimateRaw) : null,
      deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
      earliestStart: earliestStart && !Number.isNaN(earliestStart.getTime()) ? earliestStart : null,
      projectId: String(form.get("projectId") ?? "") || null,
      dependsOnTaskId: dependsOn,
      splittable: form.get("splittable") === "on",
      minBlockMinutes: minBlockRaw ? Math.max(5, Number(minBlockRaw)) : void 0,
      waitingReason: String(form.get("waitingReason") ?? "").trim() || null
    });
    await replanQuietly(user.id);
    return { ok: true };
  },
  /** Take an adopted task out of the app. Google Calendar is not touched. */
  dismiss: async (event) => {
    const user = await requireUser(event);
    const form = await event.request.formData();
    const ok = await dismissAdoptedTask(user.id, String(form.get("taskId") ?? ""));
    if (!ok) return fail(400, { message: "That task did not come from the calendar." });
    return { ok: true, message: "Removed here. The calendar event is untouched." };
  },
  remove: async (event) => {
    const user = await requireUser(event);
    const form = await event.request.formData();
    await deleteTask(user.id, String(form.get("taskId") ?? ""));
    await replanQuietly(user.id);
    return { ok: true };
  },
  createProject: async (event) => {
    const user = await requireUser(event);
    const form = await event.request.formData();
    const name = String(form.get("name") ?? "").trim();
    if (!name) return fail(400, { message: "A project needs a name." });
    await createProject(user.id, {
      name,
      clientName: String(form.get("clientName") ?? "").trim() || null,
      agreedFee: form.get("agreedFee") ? Number(form.get("agreedFee")) : null
    });
    return { ok: true };
  },
  archiveProject: async (event) => {
    const user = await requireUser(event);
    const form = await event.request.formData();
    await updateProject(user.id, String(form.get("projectId") ?? ""), { status: "archived" });
    return { ok: true };
  },
  replan: async (event) => {
    const user = await requireUser(event);
    const result = await replan(user.id);
    return {
      ok: true,
      message: [
        `${result.blocksWritten} blocks planned`,
        result.calendarSync ? `calendar: +${result.calendarSync.inserted} ~${result.calendarSync.updated} −${result.calendarSync.removed}` : "calendar not updated",
        ...result.warnings
      ].join(" · ")
    };
  }
};
async function wouldCycle(userId, taskId, startAt) {
  const all = await listTasks(userId);
  const byId = new Map(all.map((task) => [task.id, task]));
  let current = startAt;
  for (let steps = 0; steps <= all.length && current; steps++) {
    if (current === taskId) return true;
    current = byId.get(current)?.dependsOnTaskId ?? null;
  }
  return false;
}
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
