import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
const MS_PER_MINUTE = 6e4;
const MS_PER_HOUR = 36e5;
function minutesBetween(start, end) {
  return (end.getTime() - start.getTime()) / MS_PER_MINUTE;
}
function hoursBetween(start, end) {
  return (end.getTime() - start.getTime()) / MS_PER_HOUR;
}
function sortIntervals(intervals) {
  return [...intervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime()
  );
}
function mergeIntervals(intervals) {
  const sorted = sortIntervals(intervals).filter((i) => i.end.getTime() > i.start.getTime());
  const merged = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last && current.start.getTime() <= last.end.getTime()) {
      if (current.end.getTime() > last.end.getTime()) {
        merged[merged.length - 1] = { start: last.start, end: current.end };
      }
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }
  return merged;
}
function subtractIntervals(free, busy) {
  const blockers = mergeIntervals(busy);
  const result = [];
  for (const slot of sortIntervals(free)) {
    let cursor = slot.start.getTime();
    const slotEnd = slot.end.getTime();
    for (const blocker of blockers) {
      const busyStart = blocker.start.getTime();
      const busyEnd = blocker.end.getTime();
      if (busyEnd <= cursor) continue;
      if (busyStart >= slotEnd) break;
      if (busyStart > cursor) {
        result.push({ ...slot, start: new Date(cursor), end: new Date(busyStart) });
      }
      cursor = Math.max(cursor, busyEnd);
      if (cursor >= slotEnd) break;
    }
    if (cursor < slotEnd) {
      result.push({ ...slot, start: new Date(cursor), end: new Date(slotEnd) });
    }
  }
  return result;
}
function dropShorterThan(intervals, minutes) {
  return intervals.filter((i) => minutesBetween(i.start, i.end) >= minutes);
}
function clipTo(intervals, from, to) {
  const result = [];
  for (const interval of intervals) {
    const start = Math.max(interval.start.getTime(), from.getTime());
    const end = Math.min(interval.end.getTime(), to.getTime());
    if (end > start) {
      result.push({ ...interval, start: new Date(start), end: new Date(end) });
    }
  }
  return result;
}
function civilDateIn(instant, timezone) {
  return formatInTimeZone(instant, timezone, "yyyy-MM-dd");
}
function addCivilDays(civilDate, days) {
  const [y, m, d] = civilDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}
function civilDayOfWeek(civilDate) {
  const [y, m, d] = civilDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function wallClockToInstant(civilDate, hhmm, timezone) {
  return fromZonedTime(`${civilDate}T${hhmm}:00`, timezone);
}
function expandWorkingHours(workingHours, from, to, timezone) {
  const byDayOfWeek = /* @__PURE__ */ new Map();
  for (const wh of workingHours) byDayOfWeek.set(wh.dayOfWeek, wh);
  const intervals = [];
  let civil = addCivilDays(civilDateIn(from, timezone), -1);
  const lastCivil = addCivilDays(civilDateIn(to, timezone), 1);
  while (civil <= lastCivil) {
    const pattern = byDayOfWeek.get(civilDayOfWeek(civil));
    if (pattern) {
      for (const slot of pattern.intervals) {
        intervals.push({
          start: wallClockToInstant(civil, slot.start, timezone),
          end: wallClockToInstant(civil, slot.end, timezone),
          pool: "human",
          preferredKind: slot.preferredKind
        });
      }
    }
    civil = addCivilDays(civil, 1);
  }
  return clipTo(sortIntervals(intervals), from, to);
}
function machinePool(from, to) {
  if (to.getTime() <= from.getTime()) return [];
  return [{ start: from, end: to, pool: "machine", preferredKind: "machine" }];
}
function totalHours(intervals) {
  return intervals.reduce((sum, i) => sum + hoursBetween(i.start, i.end), 0);
}
function isoWeekOf(instant, timezone) {
  return formatInTimeZone(instant, timezone, "RRRR-'W'II");
}
export {
  MS_PER_HOUR as M,
  addCivilDays as a,
  sortIntervals as b,
  clipTo as c,
  dropShorterThan as d,
  expandWorkingHours as e,
  minutesBetween as f,
  MS_PER_MINUTE as g,
  hoursBetween as h,
  isoWeekOf as i,
  civilDayOfWeek as j,
  machinePool as m,
  subtractIntervals as s,
  totalHours as t,
  wallClockToInstant as w
};
