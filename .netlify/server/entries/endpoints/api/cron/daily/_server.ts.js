import { json } from "@sveltejs/kit";
import { formatInTimeZone } from "date-fns-tz";
import { b as private_env } from "../../../../../chunks/shared-server.js";
import { d as db, u as users } from "../../../../../chunks/index5.js";
import { d as getSettings, l as listTasks, e as getBlocksBetween } from "../../../../../chunks/queries.js";
import { r as replan } from "../../../../../chunks/planner.js";
import { n as notifyIfWorse, s as sendDailyBrief } from "../../../../../chunks/notify.js";
import { w as wallClockToInstant } from "../../../../../chunks/intervals.js";
const POST = async (event) => {
  const secret = event.request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!private_env.CRON_SECRET || secret !== private_env.CRON_SECRET) {
    return json({ error: "unauthorised" }, { status: 401 });
  }
  const users$1 = await db.select().from(users);
  const report = [];
  for (const user of users$1) {
    const settings = await getSettings(user.id);
    const timezone = settings?.timezone ?? "Europe/Paris";
    const now = /* @__PURE__ */ new Date();
    const result = await replan(user.id);
    const tasks = await listTasks(user.id);
    const titles = new Map(tasks.map((t) => [t.id, t.title]));
    const alert = await notifyIfWorse(user.id, result.output, titles);
    const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
    const dayStart = wallClockToInstant(today, "00:00", timezone);
    const blocks = (await getBlocksBetween(user.id, dayStart, new Date(dayStart.getTime() + 864e5))).filter((b) => b.pool === "human");
    const hours = Math.round(
      blocks.reduce((sum, b) => sum + (b.end.getTime() - b.start.getTime()) / 36e5, 0) * 10
    ) / 10;
    const brief = await sendDailyBrief(user.id, {
      today,
      blocksToday: blocks.length,
      hoursToday: hours,
      firstUp: blocks[0] ? titles.get(blocks[0].taskId) ?? null : null
    });
    report.push({
      user: user.email,
      blocks: result.blocksWritten,
      alerted: Boolean(alert),
      briefed: Boolean(brief),
      warnings: result.warnings
    });
  }
  return json({ ran: (/* @__PURE__ */ new Date()).toISOString(), report });
};
export {
  POST
};
