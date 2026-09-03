import { w as wallClockToInstant, a as addCivilDays } from "./intervals.js";
import { google } from "googleapis";
import { b as private_env } from "./shared-server.js";
import { createDecipheriv, randomBytes, createCipheriv } from "node:crypto";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
function key() {
  if (!private_env.TOKEN_ENCRYPTION_KEY) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not set.");
  }
  const decoded = Buffer.from(private_env.TOKEN_ENCRYPTION_KEY, "base64");
  if (decoded.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return decoded;
}
function encrypt(plaintext) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, ciphertext, cipher.getAuthTag()].map((b) => b.toString("base64")).join(".");
}
function decrypt(payload) {
  const [ivPart, ciphertextPart, tagPart] = payload.split(".");
  if (!ivPart || !ciphertextPart || !tagPart) {
    throw new Error("Malformed encrypted payload.");
  }
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64")),
    decipher.final()
  ]).toString("utf8");
}
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const AUTHORIZATION_PARAMS = {
  scope: ["openid", "email", "profile", CALENDAR_SCOPE].join(" "),
  // Both are required to be handed a refresh token. Without `prompt: consent`
  // Google returns one only on the very first authorisation, and if that one
  // is ever lost there is no way to get another without revoking access.
  access_type: "offline",
  prompt: "consent"
};
function oauthClient(redirectUri) {
  if (!private_env.GOOGLE_CLIENT_ID || !private_env.GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.");
  }
  return new google.auth.OAuth2(private_env.GOOGLE_CLIENT_ID, private_env.GOOGLE_CLIENT_SECRET, redirectUri);
}
function clientForUser(encryptedRefreshToken) {
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(encryptedRefreshToken) });
  return client;
}
function calendarApi(auth) {
  return google.calendar({ version: "v3", auth });
}
async function listCalendars(auth) {
  const response = await calendarApi(auth).calendarList.list({ maxResults: 250 });
  return response.data.items ?? [];
}
async function readBusyIntervals(auth, options) {
  const api = calendarApi(auth);
  const calendars = await listCalendars(auth);
  const busy = [];
  for (const calendar of calendars) {
    if (!calendar.id) continue;
    if (calendar.id === options.excludeCalendarId) continue;
    if (calendar.selected === false) continue;
    let pageToken;
    do {
      const response = await api.events.list({
        calendarId: calendar.id,
        timeMin: options.timeMin.toISOString(),
        timeMax: options.timeMax.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 2500,
        pageToken
      });
      for (const event of response.data.items ?? []) {
        const interval = eventToBusyInterval(event, options);
        if (interval) busy.push(interval);
      }
      pageToken = response.data.nextPageToken ?? void 0;
    } while (pageToken);
  }
  return busy;
}
const DEFAULT_ALL_DAY_WINDOW = { start: "09:00", end: "18:00" };
function eventToBusyInterval(event, options) {
  if (event.status === "cancelled") return null;
  if (event.transparency === "transparent") return null;
  const self = event.attendees?.find((a) => a.self);
  if (self?.responseStatus === "declined") return null;
  if (event.start?.dateTime && event.end?.dateTime) {
    return { start: new Date(event.start.dateTime), end: new Date(event.end.dateTime) };
  }
  if (event.start?.date && event.end?.date) {
    const window = options.allDayWindow ?? DEFAULT_ALL_DAY_WINDOW;
    const busy = [];
    let civil = event.start.date;
    while (civil < event.end.date) {
      busy.push({
        start: wallClockToInstant(civil, window.start, options.timezone),
        end: wallClockToInstant(civil, window.end, options.timezone)
      });
      civil = addCivilDays(civil, 1);
    }
    if (busy.length === 0) return null;
    return { start: busy[0].start, end: busy[busy.length - 1].end };
  }
  return null;
}
async function readAppointments(auth, options) {
  const api = calendarApi(auth);
  const calendars = await listCalendars(auth);
  const appointments = [];
  const wanted = calendars.filter(
    (calendar) => calendar.id && calendar.id !== options.excludeCalendarId
  );
  const responses = await Promise.all(
    wanted.map(
      (calendar) => api.events.list({
        calendarId: calendar.id,
        timeMin: options.timeMin.toISOString(),
        timeMax: options.timeMax.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 2500
      })
    )
  );
  for (const [index, response] of responses.entries()) {
    const calendar = wanted[index];
    for (const event of response.data.items ?? []) {
      if (event.transparency === "transparent") continue;
      if (event.status === "cancelled") continue;
      const interval = eventToBusyInterval(event, options);
      if (!interval) continue;
      if (!event.id) continue;
      appointments.push({
        start: interval.start,
        end: interval.end,
        summary: event.summary ?? "(no title)",
        allDay: Boolean(event.start?.date),
        eventId: event.id,
        calendarId: calendar.id,
        primary: Boolean(calendar.primary)
      });
    }
  }
  return appointments.sort((a, b) => a.start.getTime() - b.start.getTime());
}
const TARGET_CALENDAR_NAME = "Planned work";
class ForbiddenCalendarError extends Error {
  constructor(attemptedCalendarId, ownCalendarId) {
    super(
      `Refusing to write to calendar "${attemptedCalendarId}". This app only ever writes to its own calendar ("${ownCalendarId}").`
    );
    this.name = "ForbiddenCalendarError";
  }
}
function assertOwnCalendar(calendarId, ownCalendarId) {
  if (!ownCalendarId) {
    throw new Error("No target calendar configured. Run ensureTargetCalendar first.");
  }
  if (calendarId !== ownCalendarId) {
    throw new ForbiddenCalendarError(calendarId, ownCalendarId);
  }
}
async function ensureTargetCalendar(auth, timezone, existingId) {
  const api = calendarApi(auth);
  if (existingId) {
    try {
      const existing = await api.calendars.get({ calendarId: existingId });
      if (existing.data.id) return existing.data.id;
    } catch {
    }
  }
  const list = await api.calendarList.list({ maxResults: 250 });
  const found = list.data.items?.find((c) => c.summary === TARGET_CALENDAR_NAME);
  if (found?.id) return found.id;
  const created = await api.calendars.insert({
    requestBody: {
      summary: TARGET_CALENDAR_NAME,
      description: "Work blocks planned automatically. Edits here are overwritten on replan.",
      timeZone: timezone
    }
  });
  if (!created.data.id) throw new Error("Google did not return an id for the new calendar.");
  return created.data.id;
}
function planSync(desired, existingEventIds) {
  const desiredIds = new Set(
    desired.map((event) => event.googleEventId).filter((id) => id !== null)
  );
  return {
    insert: desired.filter((event) => event.googleEventId === null),
    update: desired.filter((event) => event.googleEventId !== null),
    remove: existingEventIds.filter((id) => !desiredIds.has(id))
  };
}
async function applySync(auth, calendarId, ownCalendarId, plan, timezone) {
  assertOwnCalendar(calendarId, ownCalendarId);
  const api = calendarApi(auth);
  const inserted = await inBatches(
    plan.insert,
    (event) => api.events.insert({ calendarId, requestBody: toRequestBody(event, timezone) }).then(
      (created) => created.data.id ? { blockId: event.blockId, googleEventId: created.data.id } : null
    )
  );
  const updated = await inBatches(
    plan.update,
    (event) => api.events.patch({
      calendarId,
      eventId: event.googleEventId,
      requestBody: toRequestBody(event, timezone)
    }).then(
      () => ({
        blockId: event.blockId,
        googleEventId: event.googleEventId
      })
    )
  );
  await inBatches(plan.remove, async (eventId) => {
    try {
      await api.events.delete({ calendarId, eventId });
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    return null;
  });
  return [...inserted, ...updated].filter((entry) => entry !== null);
}
async function inBatches(items, work, size = 8) {
  const results = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...await Promise.all(items.slice(index, index + size).map(work)));
  }
  return results;
}
function toRequestBody(event, timezone) {
  return {
    summary: event.summary,
    description: event.description,
    start: { dateTime: event.start.toISOString(), timeZone: timezone },
    end: { dateTime: event.end.toISOString(), timeZone: timezone },
    ...event.colorId ? { colorId: event.colorId } : {}
  };
}
function isMissing(error) {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = error.code;
  return code === 404 || code === 410;
}
function eventSummary(projectName, taskTitle) {
  return projectName ? `[${projectName}] ${taskTitle}` : taskTitle;
}
function eventDescription(options) {
  const lines = [];
  if (options.rawEstimateHours !== null) {
    const raw = `Estimate: ${options.rawEstimateHours}h`;
    lines.push(
      options.effectiveEstimateHours !== options.rawEstimateHours ? `${raw} (scheduled as ${round(options.effectiveEstimateHours)}h after calibration)` : raw
    );
  } else {
    lines.push(`Estimate: ${round(options.effectiveEstimateHours)}h (inferred from past work)`);
  }
  if (options.deadline) {
    lines.push(
      `Deadline: ${options.deadline.toLocaleString("fr-FR", { timeZone: options.timezone })}`
    );
  }
  lines.push("", options.taskUrl);
  return lines.join("\n");
}
function round(hours) {
  return Math.round(hours * 100) / 100;
}
export {
  AUTHORIZATION_PARAMS as A,
  ForbiddenCalendarError as F,
  applySync as a,
  calendarApi as b,
  clientForUser as c,
  readAppointments as d,
  ensureTargetCalendar as e,
  encrypt as f,
  eventDescription as g,
  eventSummary as h,
  listCalendars as l,
  planSync as p,
  readBusyIntervals as r
};
