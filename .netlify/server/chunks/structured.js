import { a as addCivilDays, w as wallClockToInstant, j as civilDayOfWeek } from "./intervals.js";
import { formatInTimeZone } from "date-fns-tz";
const DEFAULT_DEADLINE_TIME = "18:00";
const HOURS_PER_WORKING_DAY = 7;
const WEEKDAYS = {
  sunday: 0,
  dimanche: 0,
  monday: 1,
  lundi: 1,
  tuesday: 2,
  mardi: 2,
  wednesday: 3,
  mercredi: 3,
  thursday: 4,
  jeudi: 4,
  friday: 5,
  vendredi: 5,
  saturday: 6,
  samedi: 6
};
const MONTHS = {
  jan: 1,
  janvier: 1,
  january: 1,
  feb: 2,
  fev: 2,
  février: 2,
  fevrier: 2,
  february: 2,
  mar: 3,
  mars: 3,
  march: 3,
  apr: 4,
  avr: 4,
  avril: 4,
  april: 4,
  may: 5,
  mai: 5,
  jun: 6,
  juin: 6,
  june: 6,
  jul: 7,
  juil: 7,
  juillet: 7,
  july: 7,
  aug: 8,
  aout: 8,
  août: 8,
  august: 8,
  sep: 9,
  sept: 9,
  septembre: 9,
  september: 9,
  oct: 10,
  octobre: 10,
  october: 10,
  nov: 11,
  novembre: 11,
  november: 11,
  dec: 12,
  déc: 12,
  decembre: 12,
  décembre: 12,
  december: 12
};
function extractEstimate(text) {
  const hm = text.match(/(?<![\w.])~?\s*(\d{1,2})\s*h\s*(\d{1,2})(?![\w.])/i);
  if (hm) {
    return { value: Number(hm[1]) + Number(hm[2]) / 60, matched: hm[0] };
  }
  const hours = text.match(/(?<![\w.])~?\s*(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hours?|heures?)(?![\w])/i);
  if (hours) {
    return { value: Number(hours[1].replace(",", ".")), matched: hours[0] };
  }
  const minutes = text.match(/(?<![\w.])~?\s*(\d{1,3})\s*(?:m|min|mins|minutes?)(?![\w])/i);
  if (minutes) {
    return { value: Number(minutes[1]) / 60, matched: minutes[0] };
  }
  const days = text.match(/(?<![\w.])~?\s*(\d+(?:[.,]\d+)?)\s*(?:d|j|days?|jours?|journées?|journees?)(?![\w])/i);
  if (days) {
    const value = Number(days[1].replace(",", ".")) * HOURS_PER_WORKING_DAY;
    return { value, matched: days[0] };
  }
  const half = text.match(/\b(?:half a day|demi[- ]?journée|demi[- ]?journee)\b/i);
  if (half) return { value: HOURS_PER_WORKING_DAY / 2, matched: half[0] };
  return null;
}
function extractDeadline(text, now, timezone) {
  const todayCivil = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const at = (civil2, matched) => ({
    value: wallClockToInstant(civil2, DEFAULT_DEADLINE_TIME, timezone),
    matched
  });
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return at(iso[0], iso[0]);
  const slashed = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slashed) {
    const day = Number(slashed[1]);
    const month = Number(slashed[2]);
    const year = slashed[3] ? Number(slashed[3].length === 2 ? `20${slashed[3]}` : slashed[3]) : inferYear(todayCivil, month, day);
    return at(civil(year, month, day), slashed[0]);
  }
  const dayMonth = text.match(
    new RegExp(`\\b(\\d{1,2})\\s+(${Object.keys(MONTHS).join("|")})\\b`, "i")
  );
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = MONTHS[dayMonth[2].toLowerCase()];
    return at(civil(inferYear(todayCivil, month, day), month, day), dayMonth[0]);
  }
  const monthDay = text.match(
    new RegExp(`\\b(${Object.keys(MONTHS).join("|")})\\s+(\\d{1,2})\\b`, "i")
  );
  if (monthDay) {
    const month = MONTHS[monthDay[1].toLowerCase()];
    const day = Number(monthDay[2]);
    return at(civil(inferYear(todayCivil, month, day), month, day), monthDay[0]);
  }
  const today = text.match(/\b(?:today|aujourd'?hui)\b/i);
  if (today) return at(todayCivil, today[0]);
  const tomorrow = text.match(/\b(?:tomorrow|demain)\b/i);
  if (tomorrow) return at(addCivilDays(todayCivil, 1), tomorrow[0]);
  const inDays = text.match(/\b(?:in|dans)\s+(\d{1,3})\s*(?:days?|jours?)\b/i);
  if (inDays) return at(addCivilDays(todayCivil, Number(inDays[1])), inDays[0]);
  const weekdayNames = Object.keys(WEEKDAYS).join("|");
  const weekday = text.match(
    new RegExp(`\\b(next\\s+|prochain\\s+)?(${weekdayNames})(\\s+prochain)?\\b`, "i")
  );
  if (weekday) {
    const target = WEEKDAYS[weekday[2].toLowerCase()];
    const explicitlyNext = Boolean(weekday[1] || weekday[3]);
    return at(nextWeekday(todayCivil, target, explicitlyNext), weekday[0]);
  }
  return null;
}
function nextWeekday(todayCivil, target, explicitlyNext) {
  const todayDow = civilDayOfWeek(todayCivil);
  if (!explicitlyNext) {
    return addCivilDays(todayCivil, (target - todayDow + 7) % 7);
  }
  const daysToNextMonday = (1 - todayDow + 7) % 7 || 7;
  const offsetWithinWeek = (target - 1 + 7) % 7;
  return addCivilDays(todayCivil, daysToNextMonday + offsetWithinWeek);
}
function detectKind(text) {
  const machine = text.match(
    /\b(?:render|rendu|rendus|bake|baking|simulation|sim|cache|caching|export|transcode)\b/i
  );
  if (machine) return { value: "machine", matched: "" };
  const admin = text.match(
    /\b(?:invoice|invoicing|facture|facturation|urssaf|tax|impôts|impots|email|mail|admin|devis|quote|call|réunion|reunion|meeting|planning)\b/i
  );
  if (admin) return { value: "admin", matched: "" };
  return null;
}
function stripMatches(text, matches) {
  let result = text;
  for (const match of matches) {
    if (!match) continue;
    result = result.replace(match, " ");
  }
  return result.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
}
function civil(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function inferYear(todayCivil, month, day) {
  const [y] = todayCivil.split("-").map(Number);
  const candidate = civil(y, month, day);
  return candidate >= todayCivil ? y : y + 1;
}
const DELIMITER = /\s+[-–—]\s+/;
function looksStructured(text) {
  return DELIMITER.test(text);
}
function splitSegments(text) {
  return text.split(DELIMITER).map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}
function wholeSegmentEstimate(segment) {
  const found = extractEstimate(segment);
  if (!found) return null;
  return found.matched.trim().length === segment.length ? found.value : null;
}
function wholeSegmentDeadline(segment, now, timezone) {
  const found = extractDeadline(segment, now, timezone);
  if (!found) return null;
  return found.matched.trim().length === segment.length ? found.value : null;
}
function matchKnownProject(segment, projects) {
  const needle = segment.trim().toLowerCase();
  const exact = projects.find(
    (p) => p.name.toLowerCase() === needle || p.clientName?.toLowerCase() === needle
  );
  if (exact) return exact;
  const contains = projects.filter(
    (p) => p.name.toLowerCase().includes(needle) || needle.includes(p.name.toLowerCase())
  );
  return contains.length === 1 ? contains[0] : null;
}
function parseStructured(text, options) {
  const segments = splitSegments(text);
  let estimateHours = null;
  let deadline = null;
  let projectId = null;
  let unmatchedProjectName = null;
  const prose = [];
  segments.forEach((segment, index) => {
    const asEstimate = wholeSegmentEstimate(segment);
    if (asEstimate !== null && estimateHours === null) {
      estimateHours = asEstimate;
      return;
    }
    const asDeadline = wholeSegmentDeadline(segment, options.now, options.timezone);
    if (asDeadline !== null && deadline === null) {
      deadline = asDeadline;
      return;
    }
    const known = matchKnownProject(segment, options.projects);
    if (known && projectId === null) {
      projectId = known.id;
      return;
    }
    prose.push({ index, value: segment });
  });
  let title;
  let notes = null;
  const values = prose.map((p) => p.value);
  const leadsWithUnknownProject = values.length > 1 && projectId === null && prose[0]?.index === 0;
  if (values.length === 0) {
    title = "Untitled task";
  } else if (leadsWithUnknownProject) {
    unmatchedProjectName = values[0];
    title = values[1];
    notes = values.slice(2).join(" — ") || null;
  } else {
    title = values[0];
    notes = values.slice(1).join(" — ") || null;
  }
  const kind = detectKind(text)?.value ?? "creative";
  return { title, projectId, unmatchedProjectName, estimateHours, deadline, kind, notes };
}
export {
  extractDeadline as a,
  detectKind as d,
  extractEstimate as e,
  looksStructured as l,
  parseStructured as p,
  stripMatches as s
};
