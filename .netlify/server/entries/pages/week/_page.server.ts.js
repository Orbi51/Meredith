import { formatInTimeZone } from "date-fns-tz";
import { r as requireUser } from "../../../chunks/auth.js";
import { d as getSettings, e as getBlocksBetween, l as listTasks, f as listProjects, t as getFrozenBlocks } from "../../../chunks/queries.js";
import { b as buildSchedulerInput } from "../../../chunks/planner.js";
import { s as schedule } from "../../../chunks/index3.js";
import { a as addCivilDays, w as wallClockToInstant } from "../../../chunks/intervals.js";
const load = async (event) => {
  const user = await requireUser(event);
  const settings = await getSettings(user.id);
  const timezone = settings?.timezone ?? "Europe/Paris";
  const now = /* @__PURE__ */ new Date();
  const offset = Number(event.url.searchParams.get("offset") ?? "0") || 0;
  const todayCivil = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const isoDayOfWeek = Number(formatInTimeZone(now, timezone, "i"));
  const mondayCivil = addCivilDays(todayCivil, -(isoDayOfWeek - 1) + offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addCivilDays(mondayCivil, i));
  const weekStart = wallClockToInstant(mondayCivil, "00:00", timezone);
  const weekEnd = wallClockToInstant(addCivilDays(mondayCivil, 7), "00:00", timezone);
  const [blocks, tasks, projects, frozen] = await Promise.all([
    getBlocksBetween(user.id, weekStart, weekEnd),
    listTasks(user.id),
    listProjects(user.id),
    getFrozenBlocks(user.id, now)
  ]);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  let capacity = [];
  if (settings) {
    const input = await buildSchedulerInput(user.id, now, [], frozen, settings);
    capacity = schedule(input).capacityUsed;
  }
  const weekIso = formatInTimeZone(weekStart, timezone, "RRRR-'W'II");
  return {
    timezone,
    weekIso,
    offset,
    capacity: capacity.find((c) => c.weekIso === weekIso) ?? null,
    days: days.map((civil) => ({
      civil,
      label: formatInTimeZone(wallClockToInstant(civil, "12:00", timezone), timezone, "EEE d MMM"),
      isToday: civil === todayCivil,
      blocks: blocks.filter((b) => formatInTimeZone(b.start, timezone, "yyyy-MM-dd") === civil).map((block) => {
        const task = taskById.get(block.taskId);
        const project = task?.projectId ? projectById.get(task.projectId) : null;
        return {
          id: block.id,
          start: block.start,
          end: block.end,
          status: block.status,
          pool: block.pool,
          title: task?.title ?? "Unknown task",
          projectName: project?.name ?? null,
          color: project?.color ?? "#6366f1"
        };
      })
    }))
  };
};
export {
  load
};
