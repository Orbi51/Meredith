import { redirect } from "@sveltejs/kit";
import { r as requireUser } from "../../../chunks/auth.js";
import { d as getSettings, f as listProjects, k as createTask } from "../../../chunks/queries.js";
import { p as parseQuickAdd } from "../../../chunks/index4.js";
const load = async (event) => {
  await requireUser(event);
  return {};
};
const actions = {
  default: async (event) => {
    const user = await requireUser(event);
    const form = await event.request.formData();
    const title = String(form.get("title") ?? "").trim();
    const text = String(form.get("text") ?? "").trim();
    const url = String(form.get("url") ?? "").trim();
    const headline = title || text || url || "Shared item";
    const settings = await getSettings(user.id);
    const projects = await listProjects(user.id);
    const parsed = await parseQuickAdd(headline, {
      projects: projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName })),
      timezone: settings?.timezone ?? "Europe/Paris",
      now: /* @__PURE__ */ new Date()
    });
    const notes = [text && text !== headline ? text : null, url && url !== headline ? url : null].filter(Boolean).join("\n");
    await createTask(user.id, {
      title: parsed.title,
      projectId: parsed.projectId,
      estimateHours: parsed.estimateHours,
      deadline: parsed.deadline,
      kind: parsed.kind,
      notes: notes || null,
      // Shared things arrive without thought behind them, so they land in
      // the inbox rather than being scheduled straight away.
      status: "inbox"
    });
    redirect(303, "/tasks");
  }
};
export {
  actions,
  load
};
