/**
 * Types for the pure scheduler.
 *
 * Nothing in `src/lib/scheduler/` may import from the database, from Google,
 * or read the clock. Everything the scheduler needs arrives in SchedulerInput.
 * That is what makes the whole thing testable against fixtures.
 */

export type TaskKind = 'creative' | 'admin' | 'machine';

/** A half-open time span [start, end). All Dates are absolute instants (UTC). */
export type Interval = {
	start: Date;
	end: Date;
};

/** A free interval the scheduler may place work into. */
export type FreeInterval = Interval & {
	/** Which pool this capacity belongs to. Machine work never touches 'human'. */
	pool: 'human' | 'machine';
	/** If set, the user prefers this kind of work here. A soft preference only. */
	preferredKind: TaskKind | null;
};

/** Default minimum block length per kind, in minutes. See §5 of the plan. */
export const DEFAULT_MIN_BLOCK_MINUTES: Record<TaskKind, number> = {
	creative: 120,
	admin: 30,
	machine: 60
};

/**
 * The subset of a Task the scheduler cares about. The database row has more
 * fields (notes, status, waitingReason...); they are irrelevant here.
 */
export type SchedulableTask = {
	id: string;
	projectId: string | null;
	title: string;
	/** null means "infer from the median actual of similar completed tasks". */
	estimateHours: number | null;
	deadline: Date | null;
	earliestStart: Date | null;
	kind: TaskKind;
	splittable: boolean;
	minBlockMinutes: number;
	dependsOnTaskId: string | null;
	/** Hours already worked on this task. Subtracted from the effective estimate. */
	hoursAlreadyDone: number;
	/** Used only as a deterministic tie-break for tasks without a deadline. */
	createdAt: Date;
};

export type WorkingHoursInterval = {
	/** Local wall-clock time in the input timezone, "HH:MM". */
	start: string;
	end: string;
	preferredKind: TaskKind | null;
};

export type WorkingHours = {
	/** 0 = Sunday ... 6 = Saturday, matching Date#getDay(). */
	dayOfWeek: number;
	intervals: WorkingHoursInterval[];
};

/**
 * Calibration data, precomputed by `calibration.ts` from CalibrationSample rows.
 * The scheduler only reads it; it never derives it.
 */
export type CalibrationTable = {
	/** multiplier and sample count per kind. */
	byKind: Record<TaskKind, CalibrationEntry>;
	/** multiplier and sample count per projectId (keys are project ids). */
	byProject: Record<string, CalibrationEntry>;
	/** Median actual hours per kind, used when a task has no estimate at all. */
	medianActualHoursByKind: Record<TaskKind, number | null>;
	/** Median actual hours per `${projectId}:${kind}` — used once ≥3 samples exist. */
	medianActualHoursByProjectKind: Record<string, number | null>;
};

export type CalibrationEntry = {
	multiplier: number;
	sampleCount: number;
};

export type SchedulerInput = {
	/** The current instant. Never read the clock inside the scheduler. */
	now: Date;
	/** How far ahead to plan, in days. Default 21. */
	horizonDays: number;
	tasks: SchedulableTask[];
	/** Busy time from ALL calendars except the app's own target calendar. */
	busyIntervals: Interval[];
	workingHours: WorkingHours[];
	calibration: CalibrationTable;
	/** IANA timezone, e.g. "Europe/Paris". Working hours are wall-clock in it. */
	timezone: string;
};

export type PlannedBlock = {
	taskId: string;
	start: Date;
	end: Date;
	pool: 'human' | 'machine';
};

export type UnplacedTask = {
	taskId: string;
	/** Hours of effective estimate that found no home in the horizon. */
	hoursShort: number;
	reason: UnplacedReason;
};

export type UnplacedReason =
	| 'no-capacity'
	| 'no-gap-large-enough'
	| 'dependency-unplaced'
	| 'starts-after-horizon';

export type AtRiskTask = {
	taskId: string;
	slackHours: number;
	/**
	 * True when the scheduler could only fit this task by placing work after
	 * its own deadline. Slack alone misses this: a task can have plenty of
	 * working hours before its deadline and still land late because it is
	 * waiting on something else.
	 */
	scheduledPastDeadline: boolean;
};

export type CapacityUsage = {
	/** ISO week identifier, e.g. "2026-W36". */
	weekIso: string;
	committedHours: number;
	availableHours: number;
};

export type SchedulerOutput = {
	blocks: PlannedBlock[];
	unplaced: UnplacedTask[];
	/** slack < 0, or slack < 20% of the effective estimate. */
	atRisk: AtRiskTask[];
	capacityUsed: CapacityUsage[];
};
