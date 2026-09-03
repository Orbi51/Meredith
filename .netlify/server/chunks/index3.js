import { t as totalHours, c as clipTo, M as MS_PER_HOUR, e as expandWorkingHours, s as subtractIntervals, d as dropShorterThan, m as machinePool, b as sortIntervals, f as minutesBetween, h as hoursBetween, i as isoWeekOf, g as MS_PER_MINUTE } from "./intervals.js";
const MIN_SAMPLES_FOR_MULTIPLIER = 5;
const MIN_SAMPLES_FOR_PROJECT_INFERENCE = 3;
const MULTIPLIER_MIN = 0.5;
const MULTIPLIER_MAX = 4;
const ALL_KINDS = ["creative", "admin", "machine"];
function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}
function clampMultiplier(value) {
  return Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, value));
}
function entryFromRatios(ratios) {
  const sampleCount = ratios.length;
  if (sampleCount < MIN_SAMPLES_FOR_MULTIPLIER) {
    return { multiplier: 1, sampleCount };
  }
  return { multiplier: clampMultiplier(median(ratios)), sampleCount };
}
function buildCalibrationTable(samples) {
  const ratiosByKind = /* @__PURE__ */ new Map();
  const ratiosByProject = /* @__PURE__ */ new Map();
  const actualsByKind = /* @__PURE__ */ new Map();
  const actualsByProjectKind = /* @__PURE__ */ new Map();
  const push = (map, key, value) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const sample of samples) {
    push(actualsByKind, sample.taskKind, sample.actualHours);
    if (sample.projectId) {
      push(actualsByProjectKind, `${sample.projectId}:${sample.taskKind}`, sample.actualHours);
    }
    if (sample.estimateHours && sample.estimateHours > 0) {
      const ratio = sample.actualHours / sample.estimateHours;
      push(ratiosByKind, sample.taskKind, ratio);
      if (sample.projectId) push(ratiosByProject, sample.projectId, ratio);
    }
  }
  const byKind = {};
  for (const kind of ALL_KINDS) byKind[kind] = entryFromRatios(ratiosByKind.get(kind) ?? []);
  const byProject = {};
  for (const [projectId, ratios] of ratiosByProject) byProject[projectId] = entryFromRatios(ratios);
  const medianActualHoursByKind = {};
  for (const kind of ALL_KINDS) medianActualHoursByKind[kind] = median(actualsByKind.get(kind) ?? []);
  const medianActualHoursByProjectKind = {};
  for (const [key, actuals] of actualsByProjectKind) {
    medianActualHoursByProjectKind[key] = actuals.length >= MIN_SAMPLES_FOR_PROJECT_INFERENCE ? median(actuals) : null;
  }
  return { byKind, byProject, medianActualHoursByKind, medianActualHoursByProjectKind };
}
function emptyCalibrationTable() {
  return buildCalibrationTable([]);
}
function multiplierFor(task, table) {
  if (task.projectId) {
    const projectEntry = table.byProject[task.projectId];
    if (projectEntry && projectEntry.sampleCount >= MIN_SAMPLES_FOR_MULTIPLIER) {
      return {
        multiplier: projectEntry.multiplier,
        source: "project",
        sampleCount: projectEntry.sampleCount
      };
    }
  }
  const kindEntry = table.byKind[task.kind];
  if (kindEntry && kindEntry.sampleCount >= MIN_SAMPLES_FOR_MULTIPLIER) {
    return { multiplier: kindEntry.multiplier, source: "kind", sampleCount: kindEntry.sampleCount };
  }
  return { multiplier: 1, source: "none", sampleCount: kindEntry?.sampleCount ?? 0 };
}
const FALLBACK_ESTIMATE_HOURS = {
  creative: 2,
  admin: 0.5,
  machine: 1
};
function effectiveEstimate(task, table) {
  const { multiplier, source } = multiplierFor(task, table);
  if (task.estimateHours !== null && task.estimateHours > 0) {
    return {
      rawHours: task.estimateHours,
      effectiveHours: task.estimateHours * multiplier,
      multiplier,
      multiplierSource: source,
      inferred: false
    };
  }
  const projectKey = task.projectId ? `${task.projectId}:${task.kind}` : null;
  const fromProject = projectKey ? table.medianActualHoursByProjectKind[projectKey] : null;
  const fromKind = table.medianActualHoursByKind[task.kind];
  const inferredHours = fromProject ?? fromKind ?? FALLBACK_ESTIMATE_HOURS[task.kind];
  return {
    rawHours: null,
    effectiveHours: inferredHours,
    multiplier: 1,
    multiplierSource: "none",
    inferred: true
  };
}
const AT_RISK_SLACK_FRACTION = 0.2;
function availableHoursBetween(freeIntervals, from, to) {
  if (to.getTime() <= from.getTime()) return 0;
  return totalHours(clipTo(freeIntervals, from, to));
}
function isAtRisk(slack, effectiveEstimateHours) {
  if (slack < 0) return true;
  return slack < effectiveEstimateHours * AT_RISK_SLACK_FRACTION;
}
function roundMinutes(minutes) {
  return Math.round(minutes * 1e6) / 1e6;
}
function roundHours(hours) {
  return Math.round(hours * 1e4) / 1e4;
}
function schedule(input) {
  const { now, tasks, busyIntervals, workingHours, calibration, timezone } = input;
  const horizonEnd = new Date(now.getTime() + input.horizonDays * 24 * MS_PER_HOUR);
  const humanBeforeBusy = expandWorkingHours(workingHours, now, horizonEnd, timezone);
  let humanFree = subtractIntervals(humanBeforeBusy, busyIntervals);
  const humanTasks = tasks.filter((t) => t.kind !== "machine");
  const smallestBlockInPlay = humanTasks.length ? Math.min(...humanTasks.map((t) => t.minBlockMinutes)) : 0;
  humanFree = dropShorterThan(humanFree, smallestBlockInPlay);
  const machineFree = machinePool(now, horizonEnd);
  const humanCapacity = sortIntervals(humanFree);
  const machineCapacity = sortIntervals(machineFree);
  const prepared = [];
  for (const task of tasks) {
    const estimate = effectiveEstimate(task, calibration);
    const remainingHours = Math.max(0, estimate.effectiveHours - task.hoursAlreadyDone);
    if (remainingHours <= 0) continue;
    const pool = task.kind === "machine" ? machineCapacity : humanCapacity;
    prepared.push({
      task,
      remainingMinutes: roundMinutes(remainingHours * 60),
      effectiveHours: roundHours(remainingHours),
      slackHours: task.deadline ? roundHours(availableHoursBetween(pool, now, task.deadline) - remainingHours) : null
    });
  }
  const ordered = orderTasks(prepared);
  const pools = {
    human: humanCapacity.map((i) => ({ ...i })),
    machine: machineCapacity.map((i) => ({ ...i }))
  };
  const blocks = [];
  const unplaced = [];
  const finishedAt = /* @__PURE__ */ new Map();
  const fullyPlaced = /* @__PURE__ */ new Set();
  const remainingMinutes = /* @__PURE__ */ new Map();
  for (const entry of ordered) remainingMinutes.set(entry.task.id, entry.remainingMinutes);
  for (const round of ["before-deadline", "completable", "hopeless"]) {
    for (const entry of ordered) {
      placeOne(entry, round);
    }
  }
  function placeOne(entry, round) {
    const { task } = entry;
    const remaining = remainingMinutes.get(task.id) ?? 0;
    if (remaining <= 0) return;
    if (round === "before-deadline" && !task.deadline) return;
    const poolName = task.kind === "machine" ? "machine" : "human";
    if (round !== "before-deadline") {
      const capacityLeft = pools[poolName].reduce(
        (sum, interval) => sum + minutesBetween(interval.start, interval.end),
        0
      );
      const completable = remaining <= capacityLeft;
      if (round === "completable" && !completable) return;
      if (round === "hopeless" && completable) return;
    }
    let dependencyEnd = null;
    if (task.dependsOnTaskId) {
      const dependencyIsPending = ordered.some((o) => o.task.id === task.dependsOnTaskId);
      if (dependencyIsPending) {
        if (!fullyPlaced.has(task.dependsOnTaskId)) return;
        dependencyEnd = finishedAt.get(task.dependsOnTaskId) ?? null;
      }
    }
    const earliestAllowed = latest([now, task.earliestStart, dependencyEnd]);
    if (earliestAllowed.getTime() >= horizonEnd.getTime()) return;
    const placement = placeTask(
      { ...entry, remainingMinutes: remaining },
      pools[poolName],
      earliestAllowed,
      horizonEnd,
      poolName,
      round === "before-deadline" ? task.deadline?.getTime() ?? Infinity : Infinity
    );
    blocks.push(...placement.blocks);
    pools[poolName] = placement.remainingCapacity;
    remainingMinutes.set(task.id, placement.leftoverMinutes);
    const allBlocks = blocks.filter((b) => b.taskId === task.id);
    if (allBlocks.length > 0) {
      finishedAt.set(task.id, new Date(Math.max(...allBlocks.map((b) => b.end.getTime()))));
    }
    if (placement.leftoverMinutes <= 0) fullyPlaced.add(task.id);
  }
  for (const entry of ordered) {
    const leftover = remainingMinutes.get(entry.task.id) ?? 0;
    if (leftover <= 0) continue;
    const { task } = entry;
    const dependencyPending = task.dependsOnTaskId !== null && ordered.some((o) => o.task.id === task.dependsOnTaskId) && !fullyPlaced.has(task.dependsOnTaskId);
    const startsTooLate = task.earliestStart !== null && task.earliestStart.getTime() >= horizonEnd.getTime();
    unplaced.push({
      taskId: task.id,
      hoursShort: roundHours(leftover / 60),
      reason: dependencyPending ? "dependency-unplaced" : startsTooLate ? "starts-after-horizon" : task.splittable ? "no-capacity" : "no-gap-large-enough"
    });
  }
  const atRisk = [];
  for (const entry of ordered) {
    const { deadline } = entry.task;
    if (entry.slackHours === null || !deadline) continue;
    const finished = finishedAt.get(entry.task.id);
    const scheduledPastDeadline = finished ? finished.getTime() > deadline.getTime() : false;
    if (scheduledPastDeadline || isAtRisk(entry.slackHours, entry.effectiveHours)) {
      atRisk.push({ taskId: entry.task.id, slackHours: entry.slackHours, scheduledPastDeadline });
    }
  }
  atRisk.sort((a, b) => a.slackHours - b.slackHours || a.taskId.localeCompare(b.taskId));
  return {
    blocks: blocks.sort(
      (a, b) => a.start.getTime() - b.start.getTime() || a.taskId.localeCompare(b.taskId)
    ),
    unplaced: unplaced.sort((a, b) => a.taskId.localeCompare(b.taskId)),
    atRisk,
    capacityUsed: summariseCapacity(humanCapacity, blocks, timezone)
  };
}
function latest(candidates) {
  let result = /* @__PURE__ */ new Date(0);
  for (const candidate of candidates) {
    if (candidate && candidate.getTime() > result.getTime()) result = candidate;
  }
  return result;
}
function orderTasks(prepared) {
  const bySlack = [...prepared].sort((a, b) => {
    const aHasDeadline = a.slackHours !== null;
    const bHasDeadline = b.slackHours !== null;
    if (aHasDeadline !== bHasDeadline) return aHasDeadline ? -1 : 1;
    if (aHasDeadline && bHasDeadline) {
      const diff = a.slackHours - b.slackHours;
      if (diff !== 0) return diff;
    }
    const created = a.task.createdAt.getTime() - b.task.createdAt.getTime();
    if (created !== 0) return created;
    return a.task.id.localeCompare(b.task.id);
  });
  const byId = new Map(bySlack.map((entry) => [entry.task.id, entry]));
  const result = [];
  const emitted = /* @__PURE__ */ new Set();
  const visiting = /* @__PURE__ */ new Set();
  const emit = (entry) => {
    if (emitted.has(entry.task.id)) return;
    if (visiting.has(entry.task.id)) return;
    visiting.add(entry.task.id);
    const dependencyId = entry.task.dependsOnTaskId;
    if (dependencyId) {
      const dependency = byId.get(dependencyId);
      if (dependency) emit(dependency);
    }
    visiting.delete(entry.task.id);
    if (!emitted.has(entry.task.id)) {
      emitted.add(entry.task.id);
      result.push(entry);
    }
  };
  for (const entry of bySlack) emit(entry);
  return result;
}
function placeTask(entry, capacity, earliestAllowed, horizonEnd, pool, roundLimit) {
  const { task } = entry;
  let remaining = entry.remainingMinutes;
  const blocks = [];
  let working = capacity;
  const kindPreferences = [
    (interval) => interval.preferredKind === task.kind,
    (interval) => interval.preferredKind === null,
    () => true
  ];
  const passes = kindPreferences.map((matches) => ({ limit: roundLimit, matches }));
  for (const { limit, matches } of passes) {
    if (remaining <= 0) break;
    let index = 0;
    while (index < working.length && remaining > 0) {
      const interval = working[index];
      if (!matches(interval)) {
        index++;
        continue;
      }
      const start = Math.max(interval.start.getTime(), earliestAllowed.getTime());
      const end = Math.min(interval.end.getTime(), horizonEnd.getTime(), limit);
      const usableMinutes = (end - start) / MS_PER_MINUTE;
      if (usableMinutes <= 0) {
        index++;
        continue;
      }
      const chunkMinutes = chunkFor(task, remaining, usableMinutes);
      if (chunkMinutes === null) {
        index++;
        continue;
      }
      const blockStart = new Date(start);
      const blockEnd = new Date(start + chunkMinutes * MS_PER_MINUTE);
      blocks.push({ taskId: task.id, start: blockStart, end: blockEnd, pool });
      remaining = roundMinutes(remaining - chunkMinutes);
      working = consume(working, index, blockStart, blockEnd);
    }
  }
  return { blocks, remainingCapacity: working, leftoverMinutes: Math.max(0, remaining) };
}
function chunkFor(task, remainingMinutes, usableMinutes) {
  if (!task.splittable) {
    return usableMinutes >= remainingMinutes ? remainingMinutes : null;
  }
  const chunk = Math.min(remainingMinutes, usableMinutes);
  if (chunk >= task.minBlockMinutes) return chunk;
  if (chunk === remainingMinutes) return chunk;
  return null;
}
function consume(intervals, index, start, end) {
  const interval = intervals[index];
  const replacements = [];
  if (interval.start.getTime() < start.getTime()) {
    replacements.push({ ...interval, end: start });
  }
  if (end.getTime() < interval.end.getTime()) {
    replacements.push({ ...interval, start: end });
  }
  return [...intervals.slice(0, index), ...replacements, ...intervals.slice(index + 1)];
}
function summariseCapacity(humanCapacity, blocks, timezone) {
  const available = /* @__PURE__ */ new Map();
  const committed = /* @__PURE__ */ new Map();
  const add = (map, week, hours) => {
    map.set(week, (map.get(week) ?? 0) + hours);
  };
  for (const interval of humanCapacity) {
    add(available, isoWeekOf(interval.start, timezone), hoursBetween(interval.start, interval.end));
  }
  for (const block of blocks) {
    if (block.pool !== "human") continue;
    add(committed, isoWeekOf(block.start, timezone), hoursBetween(block.start, block.end));
  }
  const weeks = [.../* @__PURE__ */ new Set([...available.keys(), ...committed.keys()])].sort();
  return weeks.map((weekIso) => ({
    weekIso,
    committedHours: roundHours(committed.get(weekIso) ?? 0),
    availableHours: roundHours(available.get(weekIso) ?? 0)
  }));
}
export {
  ALL_KINDS as A,
  emptyCalibrationTable as a,
  buildCalibrationTable as b,
  availableHoursBetween as c,
  effectiveEstimate as e,
  schedule as s
};
