/**
 * Estimation calibration (§6 of the plan).
 *
 * Creative work is systematically underestimated. Rather than assume a
 * multiplier, learn the user's own from completed work. Pure functions only:
 * the caller loads CalibrationSample rows and passes them in.
 *
 * Trust rules baked in here on purpose:
 *   - fewer than MIN_SAMPLES samples -> multiplier 1.0 (say nothing you cannot support)
 *   - clamped to [0.5, 4.0] so one catastrophic task cannot poison the table
 *   - the caller must always be able to show raw and calibrated side by side,
 *     which is why `effectiveEstimate` returns both.
 */

import type { CalibrationEntry, CalibrationTable, SchedulableTask, TaskKind } from './types';

/** Below this many samples we do not believe our own multiplier. */
export const MIN_SAMPLES_FOR_MULTIPLIER = 5;
/** Below this many samples we do not infer a missing estimate from a project. */
export const MIN_SAMPLES_FOR_PROJECT_INFERENCE = 3;
export const MULTIPLIER_MIN = 0.5;
export const MULTIPLIER_MAX = 4.0;

export const ALL_KINDS: TaskKind[] = ['creative', 'admin', 'machine'];

export type CalibrationSample = {
	taskKind: TaskKind;
	projectId: string | null;
	estimateHours: number | null;
	actualHours: number;
};

export function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[mid] as number;
	return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function clampMultiplier(value: number): number {
	return Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, value));
}

function entryFromRatios(ratios: number[]): CalibrationEntry {
	const sampleCount = ratios.length;
	if (sampleCount < MIN_SAMPLES_FOR_MULTIPLIER) {
		return { multiplier: 1, sampleCount };
	}
	return { multiplier: clampMultiplier(median(ratios) as number), sampleCount };
}

/** Build the lookup table the scheduler consumes. */
export function buildCalibrationTable(samples: CalibrationSample[]): CalibrationTable {
	const ratiosByKind = new Map<TaskKind, number[]>();
	const ratiosByProject = new Map<string, number[]>();
	const actualsByKind = new Map<TaskKind, number[]>();
	const actualsByProjectKind = new Map<string, number[]>();

	const push = <K>(map: Map<K, number[]>, key: K, value: number) => {
		const list = map.get(key);
		if (list) list.push(value);
		else map.set(key, [value]);
	};

	for (const sample of samples) {
		push(actualsByKind, sample.taskKind, sample.actualHours);
		if (sample.projectId) {
			push(actualsByProjectKind, `${sample.projectId}:${sample.taskKind}`, sample.actualHours);
		}

		// A sample with no original estimate tells us nothing about our bias,
		// but it still tells us how long this kind of work takes.
		if (sample.estimateHours && sample.estimateHours > 0) {
			const ratio = sample.actualHours / sample.estimateHours;
			push(ratiosByKind, sample.taskKind, ratio);
			if (sample.projectId) push(ratiosByProject, sample.projectId, ratio);
		}
	}

	const byKind = {} as Record<TaskKind, CalibrationEntry>;
	for (const kind of ALL_KINDS) byKind[kind] = entryFromRatios(ratiosByKind.get(kind) ?? []);

	const byProject: Record<string, CalibrationEntry> = {};
	for (const [projectId, ratios] of ratiosByProject) byProject[projectId] = entryFromRatios(ratios);

	const medianActualHoursByKind = {} as Record<TaskKind, number | null>;
	for (const kind of ALL_KINDS) medianActualHoursByKind[kind] = median(actualsByKind.get(kind) ?? []);

	const medianActualHoursByProjectKind: Record<string, number | null> = {};
	for (const [key, actuals] of actualsByProjectKind) {
		medianActualHoursByProjectKind[key] =
			actuals.length >= MIN_SAMPLES_FOR_PROJECT_INFERENCE ? median(actuals) : null;
	}

	return { byKind, byProject, medianActualHoursByKind, medianActualHoursByProjectKind };
}

/** An empty table: every multiplier 1.0, nothing inferable. */
export function emptyCalibrationTable(): CalibrationTable {
	return buildCalibrationTable([]);
}

/** Which multiplier applies to a task, and where it came from. */
export function multiplierFor(
	task: Pick<SchedulableTask, 'kind' | 'projectId'>,
	table: CalibrationTable
): { multiplier: number; source: 'project' | 'kind' | 'none'; sampleCount: number } {
	// A project-specific multiplier beats the per-kind one once it has enough
	// samples of its own — one client's "quick fix" is another's two-day job.
	if (task.projectId) {
		const projectEntry = table.byProject[task.projectId];
		if (projectEntry && projectEntry.sampleCount >= MIN_SAMPLES_FOR_MULTIPLIER) {
			return {
				multiplier: projectEntry.multiplier,
				source: 'project',
				sampleCount: projectEntry.sampleCount
			};
		}
	}

	const kindEntry = table.byKind[task.kind];
	if (kindEntry && kindEntry.sampleCount >= MIN_SAMPLES_FOR_MULTIPLIER) {
		return { multiplier: kindEntry.multiplier, source: 'kind', sampleCount: kindEntry.sampleCount };
	}

	return { multiplier: 1, source: 'none', sampleCount: kindEntry?.sampleCount ?? 0 };
}

export type EffectiveEstimate = {
	/** What the user typed, or null if they never gave one. */
	rawHours: number | null;
	/** What the scheduler will actually reserve. */
	effectiveHours: number;
	multiplier: number;
	multiplierSource: 'project' | 'kind' | 'none';
	/** True when there was no estimate and we fell back to past actuals. */
	inferred: boolean;
};

/** Fallback when a task has no estimate and there is no history to lean on. */
export const FALLBACK_ESTIMATE_HOURS: Record<TaskKind, number> = {
	creative: 2,
	admin: 0.5,
	machine: 1
};

/**
 * The estimate the scheduler reserves time for, with everything needed to
 * explain it in the UI. Never collapse this to a single number in a view —
 * §6 requires raw and calibrated to be visible together.
 */
export function effectiveEstimate(
	task: Pick<SchedulableTask, 'kind' | 'projectId' | 'estimateHours'>,
	table: CalibrationTable
): EffectiveEstimate {
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

	// No estimate: fall back to what work like this has actually taken. Note we
	// do NOT then apply the multiplier — an actual is already an actual, and
	// multiplying it would inflate the same bias twice.
	const projectKey = task.projectId ? `${task.projectId}:${task.kind}` : null;
	const fromProject = projectKey ? table.medianActualHoursByProjectKind[projectKey] : null;
	const fromKind = table.medianActualHoursByKind[task.kind];
	const inferredHours = fromProject ?? fromKind ?? FALLBACK_ESTIMATE_HOURS[task.kind];

	return {
		rawHours: null,
		effectiveHours: inferredHours,
		multiplier: 1,
		multiplierSource: 'none',
		inferred: true
	};
}
