import { redirect } from "@sveltejs/kit";
import { b as private_env } from "../chunks/shared-server.js";
import { skipCSRFCheck, setEnvDefaults as setEnvDefaults$1, createActionURL, Auth, raw, isAuthAction } from "@auth/core";
import { D as DEV } from "../chunks/root.js";
import { b as base, g as building } from "../chunks/server.js";
import "../chunks/url.js";
import "@sveltejs/kit/internal/server";
import { parse } from "set-cookie-parser";
import "@auth/core/errors";
import Google from "@auth/core/providers/google";
import { eq } from "drizzle-orm";
import { A as AUTHORIZATION_PARAMS, f as encrypt } from "../chunks/write.js";
import { d as db, u as users, s as settings, w as workingHours } from "../chunks/index5.js";
import { formatInTimeZone } from "date-fns-tz";
import { d as getSettings, l as listTasks, e as getBlocksBetween } from "../chunks/queries.js";
import { r as replan } from "../chunks/planner.js";
import { n as notifyIfWorse, s as sendDailyBrief } from "../chunks/notify.js";
import { e as ensureRecurringAdmin } from "../chunks/freelance.js";
import { w as wallClockToInstant } from "../chunks/intervals.js";
function setEnvDefaults(envObject, config) {
  config.trustHost ??= DEV;
  config.basePath = `${base}/auth`;
  config.skipCSRFCheck = skipCSRFCheck;
  if (building)
    return;
  setEnvDefaults$1(envObject, config);
}
async function signIn$1(provider, options = {}, authorizationParams, config, event) {
  const { request, url: { protocol } } = event;
  const headers = new Headers(request.headers);
  const { redirect: shouldRedirect = true, redirectTo, ...rest } = options instanceof FormData ? Object.fromEntries(options) : options;
  const callbackUrl = redirectTo?.toString() ?? headers.get("Referer") ?? "/";
  const signInURL = createActionURL("signin", protocol, headers, private_env, config);
  if (!provider) {
    signInURL.searchParams.append("callbackUrl", callbackUrl);
    if (shouldRedirect)
      redirect(302, signInURL.toString());
    return signInURL.toString();
  }
  let url = `${signInURL}/${provider}?${new URLSearchParams(authorizationParams)}`;
  let foundProvider = {};
  for (const providerConfig of config.providers) {
    const { options: options2, ...defaults } = typeof providerConfig === "function" ? providerConfig() : providerConfig;
    const id = options2?.id ?? defaults.id;
    if (id === provider) {
      foundProvider = {
        id,
        type: options2?.type ?? defaults.type
      };
      break;
    }
  }
  if (!foundProvider.id) {
    const url2 = `${signInURL}?${new URLSearchParams({ callbackUrl })}`;
    if (shouldRedirect)
      redirect(302, url2);
    return url2;
  }
  if (foundProvider.type === "credentials") {
    url = url.replace("signin", "callback");
  }
  headers.set("Content-Type", "application/x-www-form-urlencoded");
  const body = new URLSearchParams({ ...rest, callbackUrl });
  const req = new Request(url, { method: "POST", headers, body });
  const res = await Auth(req, { ...config, raw });
  for (const c of res?.cookies ?? []) {
    event.cookies.set(c.name, c.value, { path: "/", ...c.options });
  }
  if (shouldRedirect) {
    return redirect(302, res.redirect);
  }
  return res.redirect;
}
async function signOut$1(options, config, event) {
  const { request, url: { protocol } } = event;
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/x-www-form-urlencoded");
  const url = createActionURL("signout", protocol, headers, private_env, config);
  const callbackUrl = options?.redirectTo ?? headers.get("Referer") ?? "/";
  const body = new URLSearchParams({ callbackUrl });
  const req = new Request(url, { method: "POST", headers, body });
  const res = await Auth(req, { ...config, raw });
  for (const c of res?.cookies ?? [])
    event.cookies.set(c.name, c.value, { path: "/", ...c.options });
  if (options?.redirect ?? true)
    return redirect(302, res.redirect);
  return res;
}
async function auth(event, config) {
  setEnvDefaults(private_env, config);
  config.trustHost ??= true;
  const { request: req, url: { protocol } } = event;
  const sessionUrl = createActionURL("session", protocol, req.headers, private_env, config);
  const request = new Request(sessionUrl, {
    headers: { cookie: req.headers.get("cookie") ?? "" }
  });
  const response = await Auth(request, config);
  const authCookies = parse(response.headers.getSetCookie());
  for (const cookie of authCookies) {
    const { name, value, ...options } = cookie;
    event.cookies.set(name, value, { path: "/", ...options });
  }
  const { status = 200 } = response;
  const data = await response.json();
  if (!data || !Object.keys(data).length)
    return null;
  if (status === 200)
    return data;
  throw new Error(data.message);
}
const authorizationParamsPrefix = "authorizationParams-";
function SvelteKitAuth(config) {
  return {
    signIn: async (event) => {
      if (building)
        return;
      const { request } = event;
      const _config = typeof config === "object" ? config : await config(event);
      setEnvDefaults(private_env, _config);
      const formData = await request.formData();
      const { providerId: provider, ...options } = Object.fromEntries(formData);
      const authorizationParams = {};
      const _options = {};
      for (const key in options) {
        if (key.startsWith(authorizationParamsPrefix)) {
          authorizationParams[key.slice(authorizationParamsPrefix.length)] = options[key];
        } else {
          _options[key] = options[key];
        }
      }
      await signIn$1(provider, _options, authorizationParams, _config, event);
    },
    signOut: async (event) => {
      if (building)
        return;
      const _config = typeof config === "object" ? config : await config(event);
      setEnvDefaults(private_env, _config);
      const options = Object.fromEntries(await event.request.formData());
      await signOut$1(options, _config, event);
    },
    async handle({ event, resolve }) {
      if (building) {
        event.locals.auth ??= async () => null;
        event.locals.getSession ??= event.locals.auth;
        return resolve(event);
      }
      const _config = typeof config === "object" ? config : await config(event);
      setEnvDefaults(private_env, _config);
      const { url, request } = event;
      event.locals.auth ??= () => auth(event, _config);
      event.locals.getSession ??= event.locals.auth;
      const action = url.pathname.slice(
        // @ts-expect-error - basePath is defined in setEnvDefaults
        _config.basePath.length + 1
      ).split("/")[0];
      if (isAuthAction(action) && url.pathname.startsWith(_config.basePath + "/")) {
        return Auth(request, _config);
      }
      return resolve(event);
    }
  };
}
const RUN_AT_HOUR = 7;
let timer = null;
let running = false;
async function runDailyJob() {
  const users$1 = await db.select().from(users);
  const report = [];
  for (const user of users$1) {
    try {
      const settings2 = await getSettings(user.id);
      const timezone = settings2?.timezone ?? "Europe/Paris";
      const now = /* @__PURE__ */ new Date();
      await ensureRecurringAdmin(user.id, now, timezone);
      const result = await replan(user.id);
      const tasks = await listTasks(user.id);
      const titles = new Map(tasks.map((t) => [t.id, t.title]));
      const alert = await notifyIfWorse(user.id, result.output, titles);
      const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
      const dayStart = wallClockToInstant(today, "00:00", timezone);
      const blocks = (await getBlocksBetween(user.id, dayStart, new Date(dayStart.getTime() + 864e5))).filter((block) => block.pool === "human");
      const hours = Math.round(
        blocks.reduce(
          (sum, block) => sum + (block.end.getTime() - block.start.getTime()) / 36e5,
          0
        ) * 10
      ) / 10;
      const brief = await sendDailyBrief(user.id, {
        today,
        blocksToday: blocks.length,
        hoursToday: hours,
        firstUp: blocks[0] ? titles.get(blocks[0].taskId) ?? null : null
      });
      report.push({
        user: user.email,
        alerted: Boolean(alert),
        briefed: Boolean(brief)
      });
    } catch (error) {
      console.error(`[daily] ${user.email} failed:`, error);
    }
  }
  return report;
}
function msUntilNextRun(timezone) {
  const now = /* @__PURE__ */ new Date();
  const hour = Number(formatInTimeZone(now, timezone, "H"));
  const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const target = hour < RUN_AT_HOUR ? wallClockToInstant(today, `${String(RUN_AT_HOUR).padStart(2, "0")}:00`, timezone) : wallClockToInstant(
    formatInTimeZone(new Date(now.getTime() + 864e5), timezone, "yyyy-MM-dd"),
    `${String(RUN_AT_HOUR).padStart(2, "0")}:00`,
    timezone
  );
  return Math.max(6e4, target.getTime() - now.getTime());
}
function startDailyJob(timezone = "Europe/Paris") {
  if (timer) return;
  const schedule = () => {
    const delay = msUntilNextRun(timezone);
    timer = setTimeout(async () => {
      if (!running) {
        running = true;
        try {
          const report = await runDailyJob();
          console.log(`[daily] ran for ${report.length} user(s)`, report);
        } catch (error) {
          console.error("[daily] failed:", error);
        } finally {
          running = false;
        }
      }
      schedule();
    }, delay);
    timer.unref?.();
    console.log(`[daily] next run in ${Math.round(delay / 6e4)} minutes`);
  };
  schedule();
}
if (private_env.ENABLE_DAILY_JOB === "true") {
  startDailyJob(private_env.DAILY_JOB_TIMEZONE ?? "Europe/Paris");
}
const { handle, signIn, signOut } = SvelteKitAuth({
  trustHost: true,
  secret: private_env.AUTH_SECRET,
  providers: [
    Google({
      clientId: private_env.GOOGLE_CLIENT_ID,
      clientSecret: private_env.GOOGLE_CLIENT_SECRET,
      authorization: { params: AUTHORIZATION_PARAMS }
    })
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email || account?.provider !== "google") return false;
      const [existing] = await db.select().from(users).where(eq(users.email, user.email));
      const refreshToken = account.refresh_token ? encrypt(account.refresh_token) : void 0;
      if (existing) {
        await db.update(users).set({
          name: user.name ?? existing.name,
          googleAccountId: account.providerAccountId,
          ...refreshToken ? { googleRefreshToken: refreshToken } : {}
        }).where(eq(users.id, existing.id));
        return true;
      }
      const [created] = await db.insert(users).values({
        email: user.email,
        name: user.name ?? null,
        googleAccountId: account.providerAccountId,
        googleRefreshToken: refreshToken ?? null
      }).returning();
      if (created) {
        await db.insert(settings).values({ userId: created.id });
        await db.insert(workingHours).values(
          [1, 2, 3, 4, 5].map((dayOfWeek) => ({
            userId: created.id,
            dayOfWeek,
            intervals: [
              { start: "09:00", end: "12:30", preferredKind: "creative" },
              { start: "14:00", end: "18:00", preferredKind: null }
            ]
          }))
        );
      }
      return true;
    }
  }
});
export {
  handle,
  signIn,
  signOut
};
