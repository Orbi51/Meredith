import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { fail, error } from "@sveltejs/kit";
import { d as db, s as settings, u as users } from "../../../../chunks/index5.js";
import { c as clientForUser, e as ensureTargetCalendar, a as applySync, p as planSync, b as calendarApi, F as ForbiddenCalendarError, r as readBusyIntervals, l as listCalendars } from "../../../../chunks/write.js";
async function currentUser(email) {
  if (!email) error(401, "Sign in with Google first.");
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) error(401, "No user row — sign in again.");
  if (!user.googleRefreshToken) {
    error(
      400,
      "No Google refresh token stored. Sign out, then sign in again to force a fresh consent."
    );
  }
  return user;
}
async function fingerprintOtherCalendars(auth, ownCalendarId) {
  const api = calendarApi(auth);
  const calendars = await listCalendars(auth);
  const lines = [];
  let calendarCount = 0;
  const timeMin = /* @__PURE__ */ new Date();
  const timeMax = new Date(timeMin.getTime() + 60 * 24 * 36e5);
  for (const calendar of calendars.sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""))) {
    if (!calendar.id || calendar.id === ownCalendarId) continue;
    calendarCount++;
    const response = await api.events.list({
      calendarId: calendar.id,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 2500
    });
    for (const event of response.data.items ?? []) {
      lines.push(
        [
          calendar.id,
          event.id,
          event.summary,
          event.status,
          event.start?.dateTime ?? event.start?.date,
          event.end?.dateTime ?? event.end?.date
        ].join("|")
      );
    }
  }
  lines.sort();
  return {
    hash: createHash("sha256").update(lines.join("\n")).digest("hex"),
    eventCount: lines.length,
    calendarCount
  };
}
const load = async (event) => {
  const session = await event.locals.auth();
  return { email: session?.user?.email ?? null };
};
const actions = {
  verify: async (event) => {
    const session = await event.locals.auth();
    const user = await currentUser(session?.user?.email);
    const [settingsRow] = await db.select().from(settings).where(eq(settings.userId, user.id));
    const timezone = settingsRow?.timezone ?? "Europe/Paris";
    const auth = clientForUser(user.googleRefreshToken);
    const steps = [];
    try {
      const targetCalendarId = await ensureTargetCalendar(
        auth,
        timezone,
        settingsRow?.targetCalendarId ?? null
      );
      if (settingsRow) {
        await db.update(settings).set({ targetCalendarId }).where(eq(settings.userId, user.id));
      }
      steps.push({
        name: 'Secondary calendar "Planned work" exists',
        ok: true,
        detail: targetCalendarId
      });
      const before = await fingerprintOtherCalendars(auth, targetCalendarId);
      steps.push({
        name: "Fingerprinted the calendars we must not touch",
        ok: true,
        detail: `${before.eventCount} events across ${before.calendarCount} calendars`
      });
      const start = new Date(Math.round((Date.now() + 24 * 36e5) / 6e4) * 6e4);
      const end = new Date(start.getTime() + 2 * 36e5);
      const inserted = await applySync(
        auth,
        targetCalendarId,
        targetCalendarId,
        planSync(
          [
            {
              blockId: "phase-0-check",
              googleEventId: null,
              start,
              end,
              summary: "[Phase 0] Acceptance check",
              description: "Created by the Phase 0 verification. It deletes itself."
            }
          ],
          []
        ),
        timezone
      );
      const eventId = inserted[0]?.googleEventId;
      if (!eventId) throw new Error("Google returned no event id on insert.");
      steps.push({ name: "Created a block", ok: true, detail: eventId });
      const movedStart = new Date(start.getTime() + 36e5);
      const movedEnd = new Date(end.getTime() + 36e5);
      await applySync(
        auth,
        targetCalendarId,
        targetCalendarId,
        planSync(
          [
            {
              blockId: "phase-0-check",
              googleEventId: eventId,
              start: movedStart,
              end: movedEnd,
              summary: "[Phase 0] Acceptance check (moved)",
              description: "Moved in place."
            }
          ],
          [eventId]
        ),
        timezone
      );
      const afterMove = await calendarApi(auth).events.get({
        calendarId: targetCalendarId,
        eventId
      });
      const keptItsId = afterMove.data.id === eventId;
      const landedTime = new Date(afterMove.data.start?.dateTime ?? 0);
      const movedToTheRightTime = landedTime.getTime() === movedStart.getTime();
      steps.push({
        name: "Moved the block by updating the same event id",
        ok: keptItsId,
        detail: keptItsId ? `${eventId} kept its id — updated in place, not recreated` : `id changed: ${eventId} became ${afterMove.data.id}`
      });
      steps.push({
        name: "The new time stuck",
        ok: movedToTheRightTime,
        detail: movedToTheRightTime ? landedTime.toISOString() : `asked for ${movedStart.toISOString()}, got ${landedTime.toISOString()}`
      });
      let guarded = false;
      try {
        await applySync(
          auth,
          "primary",
          targetCalendarId,
          planSync([], ["some-event-id"]),
          timezone
        );
      } catch (guardError) {
        guarded = guardError instanceof ForbiddenCalendarError;
      }
      steps.push({
        name: "Refuses to write to any other calendar",
        ok: guarded,
        detail: guarded ? "ForbiddenCalendarError thrown as designed" : "THE GUARD DID NOT FIRE — do not use this app"
      });
      await applySync(auth, targetCalendarId, targetCalendarId, planSync([], [eventId]), timezone);
      const remaining = await calendarApi(auth).events.list({
        calendarId: targetCalendarId,
        timeMin: new Date(Date.now() - 36e5).toISOString(),
        singleEvents: true
      });
      const gone = !(remaining.data.items ?? []).some(
        (e) => e.id === eventId && e.status !== "cancelled"
      );
      steps.push({
        name: "Deleted the block",
        ok: gone,
        detail: gone ? "no longer on the calendar" : "still present"
      });
      const after = await fingerprintOtherCalendars(auth, targetCalendarId);
      const untouched = after.hash === before.hash;
      steps.push({
        name: "Every other calendar is untouched",
        ok: untouched,
        detail: untouched ? `fingerprint unchanged (${after.hash.slice(0, 16)}…)` : "FINGERPRINT CHANGED — something was modified outside our calendar"
      });
      const busy = await readBusyIntervals(auth, {
        timeMin: /* @__PURE__ */ new Date(),
        timeMax: new Date(Date.now() + 21 * 24 * 36e5),
        excludeCalendarId: targetCalendarId,
        timezone
      });
      steps.push({
        name: "Read busy intervals for the 21-day horizon",
        ok: true,
        detail: `${busy.length} busy intervals found`
      });
      return { steps, passed: steps.every((s) => s.ok) };
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      steps.push({ name: "Unexpected failure", ok: false, detail: message });
      return fail(500, { steps, passed: false });
    }
  }
};
export {
  actions,
  load
};
