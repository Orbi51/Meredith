import { a as emptyCalibrationTable, s as schedule } from "../../../chunks/index3.js";
import { D as DEFAULT_MIN_BLOCK_MINUTES } from "../../../chunks/types.js";
const TIMEZONE = "Europe/Paris";
const MONDAY_MORNING = /* @__PURE__ */ new Date("2026-09-07T06:00:00.000Z");
function standardWorkingHours(preferredKind = null) {
  return [1, 2, 3, 4, 5].map((dayOfWeek) => ({
    dayOfWeek,
    intervals: [
      { start: "09:00", end: "12:30", preferredKind },
      { start: "14:00", end: "18:00", preferredKind: null }
    ]
  }));
}
function task(overrides) {
  const kind = overrides.kind ?? "creative";
  return {
    projectId: null,
    title: overrides.id,
    estimateHours: 2,
    deadline: null,
    earliestStart: null,
    kind,
    splittable: true,
    minBlockMinutes: DEFAULT_MIN_BLOCK_MINUTES[kind],
    dependsOnTaskId: null,
    hoursAlreadyDone: 0,
    createdAt: MONDAY_MORNING,
    ...overrides
  };
}
function input(overrides = {}) {
  return {
    now: MONDAY_MORNING,
    horizonDays: 21,
    tasks: [],
    busyIntervals: [],
    workingHours: standardWorkingHours(),
    calibration: emptyCalibrationTable(),
    timezone: TIMEZONE,
    ...overrides
  };
}
const load = () => {
  const scenario = input({
    workingHours: standardWorkingHours("creative"),
    tasks: [
      task({
        id: "storyboard",
        title: "Storyboard rev2",
        projectId: "studio-x",
        estimateHours: 6,
        kind: "creative",
        deadline: /* @__PURE__ */ new Date("2026-09-09T16:00:00.000Z")
      }),
      task({
        id: "lookdev",
        title: "Lookdev pass",
        projectId: "studio-x",
        estimateHours: 14,
        kind: "creative",
        deadline: /* @__PURE__ */ new Date("2026-09-11T16:00:00.000Z"),
        dependsOnTaskId: "storyboard"
      }),
      task({
        id: "invoices",
        title: "August invoicing",
        estimateHours: 1,
        kind: "admin",
        deadline: /* @__PURE__ */ new Date("2026-09-15T16:00:00.000Z")
      }),
      task({
        id: "final-render",
        title: "Final render",
        projectId: "studio-x",
        estimateHours: 18,
        kind: "machine",
        dependsOnTaskId: "lookdev"
      })
    ],
    busyIntervals: [
      // A client call on Tuesday morning.
      { start: /* @__PURE__ */ new Date("2026-09-08T08:00:00.000Z"), end: /* @__PURE__ */ new Date("2026-09-08T09:00:00.000Z") }
    ]
  });
  return { scenario, output: schedule(scenario) };
};
export {
  load
};
