import { fail, redirect } from "@sveltejs/kit";
import { r as requireUser } from "../../../chunks/auth.js";
import { j as createProject, k as createTask, f as listProjects, d as getSettings } from "../../../chunks/queries.js";
import { p as parseQuickAdd } from "../../../chunks/index4.js";
import { r as replan } from "../../../chunks/planner.js";
import { D as DEFAULT_MIN_BLOCK_MINUTES } from "../../../chunks/types.js";
const load = async (event) => {
  const user = await requireUser(event);
  const text = event.url.searchParams.get("text") ?? "";
  const [projects, settings] = await Promise.all([listProjects(user.id), getSettings(user.id)]);
  const parsed = text.trim() ? await parseQuickAdd(text, {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      clientName: p.clientName
    })),
    timezone: settings?.timezone ?? "Europe/Paris",
    now: /* @__PURE__ */ new Date()
  }) : null;
  return {
    text,
    parsed,
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    timezone: settings?.timezone ?? "Europe/Paris"
  };
};
const actions = {
  save: async (event) => {
    const user = await requireUser(event);
    const form = await event.request.formData();
    const title = String(form.get("title") ?? "").trim();
    if (!title) return fail(400, { message: "A title is the one thing a task needs." });
    const kindValue = String(form.get("kind") ?? "creative");
    const kind = kindValue === "admin" || kindValue === "machine" ? kindValue : "creative";
    let projectId = String(form.get("projectId") ?? "") || null;
    const newProjectName = String(form.get("newProjectName") ?? "").trim();
    if (!projectId && newProjectName && form.get("createProject") === "on") {
      const project = await createProject(user.id, { name: newProjectName });
      projectId = project.id;
    }
    const estimateRaw = String(form.get("estimateHours") ?? "").trim();
    const estimateHours = estimateRaw ? Number(estimateRaw) : null;
    const deadlineRaw = String(form.get("deadline") ?? "").trim();
    const deadline = deadlineRaw ? new Date(deadlineRaw) : null;
    await createTask(user.id, {
      title,
      projectId,
      estimateHours: estimateHours !== null && Number.isFinite(estimateHours) ? estimateHours : null,
      deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
      kind,
      minBlockMinutes: DEFAULT_MIN_BLOCK_MINUTES[kind],
      notes: String(form.get("notes") ?? "").trim() || null,
      status: "active"
    });
    try {
      await replan(user.id);
    } catch {
    }
    redirect(303, "/tasks");
  }
};
export {
  actions,
  load
};
