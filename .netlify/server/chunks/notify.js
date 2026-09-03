import webpush from "web-push";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { b as private_env } from "./shared-server.js";
import { d as db, p as pushSubscriptions } from "./index5.js";
import { d as getSettings, m as updateSettings } from "./queries.js";
function pushConfigured() {
  return Boolean(private_env.VAPID_PUBLIC_KEY && private_env.VAPID_PRIVATE_KEY);
}
function configure() {
  webpush.setVapidDetails(
    private_env.VAPID_SUBJECT ?? "mailto:nobody@example.com",
    private_env.VAPID_PUBLIC_KEY,
    private_env.VAPID_PRIVATE_KEY
  );
}
async function sendToUser(userId, payload) {
  if (!pushConfigured()) return 0;
  configure();
  const subscriptions = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  let delivered = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth }
        },
        JSON.stringify(payload)
      );
      delivered++;
    } catch (error) {
      const status = error.statusCode;
      if (status === 404 || status === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
      }
    }
  }
  return delivered;
}
function riskDigest(output) {
  const parts = [
    ...output.atRisk.map((r) => `${r.taskId}:${r.slackHours < 0 ? "impossible" : "tight"}`),
    ...output.unplaced.map((u) => `${u.taskId}:unplaced`)
  ].sort();
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}
function hasWorsened(previous, current, output) {
  if (output.atRisk.length === 0 && output.unplaced.length === 0) return false;
  return previous !== current;
}
async function notifyIfWorse(userId, output, titles) {
  const settings = await getSettings(userId);
  if (!settings) return null;
  const digest = riskDigest(output);
  if (!hasWorsened(settings.lastRiskDigest, digest, output)) return null;
  const impossible = output.atRisk.filter((r) => r.slackHours < 0);
  const unplaced = output.unplaced;
  if (impossible.length === 0 && unplaced.length === 0) {
    await updateSettings(userId, { lastRiskDigest: digest });
    return null;
  }
  const name = (id) => titles.get(id) ?? "a task";
  const body = impossible.length > 0 ? impossible.length === 1 ? `${name(impossible[0].taskId)} can no longer be finished in time.` : `${impossible.length} deadlines can no longer be met.` : unplaced.length === 1 ? `${name(unplaced[0].taskId)} does not fit in the next three weeks.` : `${unplaced.length} tasks do not fit in the next three weeks.`;
  const payload = { title: "A deadline just broke", body, url: "/plan" };
  await sendToUser(userId, payload);
  await updateSettings(userId, { lastRiskDigest: digest });
  return payload;
}
async function sendDailyBrief(userId, options) {
  const settings = await getSettings(userId);
  if (!settings) return null;
  if (settings.lastBriefSentOn === options.today) return null;
  if (options.blocksToday === 0) return null;
  const payload = {
    title: `${options.hoursToday}h planned today`,
    body: options.firstUp ? `First up: ${options.firstUp}` : `${options.blocksToday} blocks.`,
    url: "/"
  };
  await sendToUser(userId, payload);
  await updateSettings(userId, { lastBriefSentOn: options.today });
  return payload;
}
export {
  notifyIfWorse as n,
  pushConfigured as p,
  sendDailyBrief as s
};
