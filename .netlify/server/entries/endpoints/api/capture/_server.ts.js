import { json } from "@sveltejs/kit";
import { c as currentUser } from "../../../../chunks/auth.js";
import { d as getSettings, f as listProjects, k as createTask } from "../../../../chunks/queries.js";
import { p as parseQuickAdd } from "../../../../chunks/index4.js";
import { r as replan } from "../../../../chunks/planner.js";
import { D as DEFAULT_MIN_BLOCK_MINUTES } from "../../../../chunks/types.js";
const POST = async (event) => {
  const user = await currentUser(event);
  if (!user) return json({ error: "signed out" }, { status: 401 });
  const body = await event.request.json();
  const text = (body.text ?? "").trim();
  if (!text) return json({ error: "empty" }, { status: 400 });
  const settings = await getSettings(user.id);
  const timezone = settings?.timezone ?? "Europe/Paris";
  const projects = await listProjects(user.id);
  const capturedAt = body.capturedAt ? new Date(body.capturedAt) : /* @__PURE__ */ new Date();
  const now = Number.isNaN(capturedAt.getTime()) ? /* @__PURE__ */ new Date() : capturedAt;
  const parsed = await parseQuickAdd(text, {
    projects: projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName })),
    timezone,
    now
  });
  const task = await createTask(user.id, {
    title: parsed.title,
    projectId: parsed.projectId,
    estimateHours: parsed.estimateHours,
    deadline: parsed.deadline,
    kind: parsed.kind,
    minBlockMinutes: DEFAULT_MIN_BLOCK_MINUTES[parsed.kind],
    notes: parsed.notes,
    status: "inbox"
  });
  try {
    await replan(user.id);
  } catch {
  }
  return json({ id: task.id, title: task.title });
};
export {
  POST
};
