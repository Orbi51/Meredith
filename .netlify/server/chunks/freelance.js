import { and, eq, gte } from "drizzle-orm";
import { d as db, t as tasks, a as projects, b as blocks } from "./index5.js";
import { w as wallClockToInstant, a as addCivilDays } from "./intervals.js";
import { formatInTimeZone } from "date-fns-tz";
const ENDPOINT = "https://api.frankfurter.dev/v1";
const CURRENCIES = [
  "EUR",
  "JPY",
  "USD",
  "GBP",
  "CHF",
  "CAD",
  "AUD",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "KRW",
  "CNY",
  "SGD",
  "HKD",
  "NZD",
  "BRL",
  "MXN",
  "ZAR",
  "INR"
];
const ZERO_DECIMAL = /* @__PURE__ */ new Set(["JPY", "KRW"]);
function isSupportedCurrency(code) {
  return CURRENCIES.includes(code);
}
async function rateToEur(currency, onDate) {
  if (currency === "EUR") return { rate: 1, date: "always" };
  if (!isSupportedCurrency(currency)) return null;
  const path = onDate ? `/${onDate}` : "/latest";
  try {
    const response = await fetch(`${ENDPOINT}${path}?base=${currency}&symbols=EUR`, {
      signal: AbortSignal.timeout(8e3)
    });
    if (!response.ok) return null;
    const body = await response.json();
    const rate = body.rates?.EUR;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
    return { rate, date: body.date ?? (onDate ?? "unknown") };
  } catch {
    return null;
  }
}
function formatMoney(amount, currency) {
  const decimals = ZERO_DECIMAL.has(currency) ? 0 : 2;
  return `${amount.toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })} ${currency}`;
}
function toEur(amount, rate, currency) {
  if (amount === null) return null;
  if (currency === "EUR") return amount;
  if (rate === null) return null;
  return Math.round(amount * rate * 100) / 100;
}
async function projectEconomics(userId) {
  const projects$1 = await db.select().from(projects).where(eq(projects.userId, userId));
  const blocks$1 = await db.select({
    projectId: tasks.projectId,
    start: blocks.start,
    end: blocks.end,
    status: blocks.status,
    actualMinutes: blocks.actualMinutes
  }).from(blocks).innerJoin(tasks, eq(tasks.id, blocks.taskId)).where(eq(blocks.userId, userId));
  const actual = /* @__PURE__ */ new Map();
  const planned = /* @__PURE__ */ new Map();
  for (const row of blocks$1) {
    if (!row.projectId) continue;
    const plannedHours = (row.end.getTime() - row.start.getTime()) / 36e5;
    if (row.status === "confirmed") {
      const hours = row.actualMinutes !== null ? row.actualMinutes / 60 : plannedHours;
      actual.set(row.projectId, (actual.get(row.projectId) ?? 0) + hours);
    } else if (row.status === "planned") {
      planned.set(row.projectId, (planned.get(row.projectId) ?? 0) + plannedHours);
    }
  }
  const round = (n) => Math.round(n * 100) / 100;
  return projects$1.map((project) => {
    const actualHours = round(actual.get(project.id) ?? 0);
    const plannedHours = round(planned.get(project.id) ?? 0);
    const fee = project.agreedFee;
    const feeEur = toEur(fee, project.fxRateToEur, project.currency);
    return {
      projectId: project.id,
      name: project.name,
      clientName: project.clientName,
      agreedFee: fee,
      currency: project.currency,
      feeFormatted: fee !== null ? formatMoney(fee, project.currency) : null,
      fxRateToEur: project.fxRateToEur,
      fxRateAt: project.fxRateAt,
      feeEur,
      agreedHours: project.agreedHours,
      actualHours,
      plannedHours,
      // Dividing by zero hours would report an infinite rate on a project
      // nobody has worked yet, which is worse than saying nothing.
      effectiveRateEur: feeEur !== null && actualHours > 0 ? round(feeEur / actualHours) : null,
      projectedRateEur: feeEur !== null && actualHours + plannedHours > 0 ? round(feeEur / (actualHours + plannedHours)) : null,
      overrunHours: project.agreedHours !== null ? round(actualHours - project.agreedHours) : null
    };
  }).sort((a, b) => (a.effectiveRateEur ?? Infinity) - (b.effectiveRateEur ?? Infinity));
}
function upcomingAdmin(now, timezone, monthsAhead = 3) {
  const items = [];
  const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const [year, month] = today.split("-").map(Number);
  for (let offset = 0; offset < monthsAhead; offset++) {
    const m = (month - 1 + offset) % 12 + 1;
    const y = year + Math.floor((month - 1 + offset) / 12);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const invoiceCivil = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    if (invoiceCivil >= today) {
      items.push({
        key: `invoice-${y}-${String(m).padStart(2, "0")}`,
        title: `Invoicing — ${formatInTimeZone(wallClockToInstant(invoiceCivil, "12:00", timezone), timezone, "MMMM yyyy")}`,
        deadline: wallClockToInstant(invoiceCivil, "18:00", timezone),
        estimateHours: 1
      });
    }
    if ([1, 4, 7, 10].includes(m)) {
      const declarationCivil = `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
      if (declarationCivil >= today) {
        items.push({
          key: `urssaf-${y}-Q${Math.floor((m - 1) / 3) || 4}`,
          title: `URSSAF declaration — due ${formatInTimeZone(wallClockToInstant(declarationCivil, "12:00", timezone), timezone, "d MMMM")}`,
          deadline: wallClockToInstant(declarationCivil, "18:00", timezone),
          estimateHours: 1
        });
      }
    }
  }
  return items.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
}
async function ensureRecurringAdmin(userId, now, timezone) {
  const wanted = upcomingAdmin(now, timezone);
  if (wanted.length === 0) return 0;
  const horizonStart = wallClockToInstant(
    addCivilDays(formatInTimeZone(now, timezone, "yyyy-MM-dd"), -1),
    "00:00",
    timezone
  );
  await db.select({ title: tasks.title }).from(tasks).where(and(eq(tasks.userId, userId), gte(tasks.createdAt, horizonStart)));
  const allTitles = new Set(
    (await db.select({ title: tasks.title }).from(tasks).where(eq(tasks.userId, userId))).map(
      (t) => t.title
    )
  );
  let created = 0;
  for (const item of wanted) {
    if (allTitles.has(item.title)) continue;
    await db.insert(tasks).values({
      userId,
      title: item.title,
      kind: "admin",
      estimateHours: item.estimateHours,
      deadline: item.deadline,
      minBlockMinutes: 30,
      status: "active",
      notes: "Recurring admin, generated automatically."
    });
    created++;
  }
  return created;
}
export {
  CURRENCIES as C,
  ensureRecurringAdmin as e,
  isSupportedCurrency as i,
  projectEconomics as p,
  rateToEur as r,
  upcomingAdmin as u
};
