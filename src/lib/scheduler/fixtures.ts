/**
 * Test fixtures. Kept out of the *.test.ts files so every test starts from the
 * same, boringly ordinary week: Monday to Friday, 09:00–12:30 and 14:00–18:00
 * Paris time. 7.5 working hours a day, 37.5 a week.
 */

import { emptyCalibrationTable } from './calibration';
import { DEFAULT_MIN_BLOCK_MINUTES } from './types';
import type {
	Interval,
	SchedulableTask,
	SchedulerInput,
	TaskKind,
	WorkingHours
} from './types';

export const TIMEZONE = 'Europe/Paris';

/** Monday 7 September 2026, 08:00 Paris (06:00 UTC) — before the day starts. */
export const MONDAY_MORNING = new Date('2026-09-07T06:00:00.000Z');

export function standardWorkingHours(preferredKind: TaskKind | null = null): WorkingHours[] {
	return [1, 2, 3, 4, 5].map((dayOfWeek) => ({
		dayOfWeek,
		intervals: [
			{ start: '09:00', end: '12:30', preferredKind },
			{ start: '14:00', end: '18:00', preferredKind: null }
		]
	}));
}

export function task(overrides: Partial<SchedulableTask> & { id: string }): SchedulableTask {
	const kind: TaskKind = overrides.kind ?? 'creative';
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

export function interval(startIso: string, endIso: string): Interval {
	return { start: new Date(startIso), end: new Date(endIso) };
}

export function input(overrides: Partial<SchedulerInput> = {}): SchedulerInput {
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

/** "2026-09-07T09:00" Paris wall clock → the matching UTC instant. */
export function paris(wallClock: string): Date {
	// September and most of the horizon are CEST (+02:00); tests that care about
	// the transition build their instants explicitly instead of using this.
	return new Date(`${wallClock}:00.000+02:00`);
}

export function hoursOfBlocks(blocks: { start: Date; end: Date }[]): number {
	return blocks.reduce((sum, b) => sum + (b.end.getTime() - b.start.getTime()) / 3_600_000, 0);
}
