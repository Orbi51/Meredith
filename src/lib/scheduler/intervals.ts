/**
 * Interval arithmetic and the expansion of working hours into concrete,
 * timezone-correct free intervals.
 *
 * Everything here is pure. Times are absolute instants; the only place a
 * timezone matters is when turning a wall-clock "09:00" into an instant.
 */

import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import type { FreeInterval, Interval, TaskKind, WorkingHours } from './types';

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;

export function minutesBetween(start: Date, end: Date): number {
	return (end.getTime() - start.getTime()) / MS_PER_MINUTE;
}

export function hoursBetween(start: Date, end: Date): number {
	return (end.getTime() - start.getTime()) / MS_PER_HOUR;
}

/** Sort by start, then end. Does not mutate the input. */
export function sortIntervals<T extends Interval>(intervals: T[]): T[] {
	return [...intervals].sort(
		(a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime()
	);
}

/**
 * Merge overlapping and touching intervals into a minimal, sorted set.
 * Zero-length intervals are dropped — they cannot make anything busy.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
	const sorted = sortIntervals(intervals).filter((i) => i.end.getTime() > i.start.getTime());
	const merged: Interval[] = [];

	for (const current of sorted) {
		const last = merged[merged.length - 1];
		if (last && current.start.getTime() <= last.end.getTime()) {
			// Overlaps or touches the previous one — extend it.
			if (current.end.getTime() > last.end.getTime()) {
				merged[merged.length - 1] = { start: last.start, end: current.end };
			}
		} else {
			merged.push({ start: current.start, end: current.end });
		}
	}

	return merged;
}

/**
 * Remove `busy` from `free`, preserving the metadata (pool, preferredKind) of
 * each free interval across any splits.
 */
export function subtractIntervals(free: FreeInterval[], busy: Interval[]): FreeInterval[] {
	const blockers = mergeIntervals(busy);
	const result: FreeInterval[] = [];

	for (const slot of sortIntervals(free)) {
		// `remaining` is the part of this slot we have not yet ruled out.
		let cursor = slot.start.getTime();
		const slotEnd = slot.end.getTime();

		for (const blocker of blockers) {
			const busyStart = blocker.start.getTime();
			const busyEnd = blocker.end.getTime();

			if (busyEnd <= cursor) continue; // entirely before what is left
			if (busyStart >= slotEnd) break; // blockers are sorted — the rest are later

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

/** Drop free intervals shorter than `minutes`. Used to remove unusable slivers. */
export function dropShorterThan(intervals: FreeInterval[], minutes: number): FreeInterval[] {
	return intervals.filter((i) => minutesBetween(i.start, i.end) >= minutes);
}

/** Clip intervals to [from, to), dropping anything that falls entirely outside. */
export function clipTo<T extends Interval>(intervals: T[], from: Date, to: Date): T[] {
	const result: T[] = [];
	for (const interval of intervals) {
		const start = Math.max(interval.start.getTime(), from.getTime());
		const end = Math.min(interval.end.getTime(), to.getTime());
		if (end > start) {
			result.push({ ...interval, start: new Date(start), end: new Date(end) });
		}
	}
	return result;
}

/** The civil (calendar) date in a timezone, as "YYYY-MM-DD". */
export function civilDateIn(instant: Date, timezone: string): string {
	return formatInTimeZone(instant, timezone, 'yyyy-MM-dd');
}

/**
 * Add `days` to a "YYYY-MM-DD" string using plain calendar arithmetic.
 * Deliberately not Date arithmetic: adding 24h across a DST boundary is how
 * you end up with a 23- or 25-hour "day".
 */
export function addCivilDays(civilDate: string, days: number): string {
	const [y, m, d] = civilDate.split('-').map(Number) as [number, number, number];
	const shifted = new Date(Date.UTC(y, m - 1, d + days));
	return shifted.toISOString().slice(0, 10);
}

/** Day of week (0 = Sunday) for a "YYYY-MM-DD" civil date. */
export function civilDayOfWeek(civilDate: string): number {
	const [y, m, d] = civilDate.split('-').map(Number) as [number, number, number];
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Turn a wall-clock time on a civil date, in a timezone, into an absolute
 * instant. `fromZonedTime` resolves DST ambiguity for us: in the autumn
 * transition the earlier of the two 02:30s wins; in spring the nonexistent
 * hour is pushed forward.
 */
export function wallClockToInstant(civilDate: string, hhmm: string, timezone: string): Date {
	return fromZonedTime(`${civilDate}T${hhmm}:00`, timezone);
}

/**
 * Expand the weekly working-hours pattern into concrete human free intervals
 * across the horizon, in the user's timezone.
 *
 * Because each day's start and end are converted from wall-clock time
 * independently, a DST day is simply the number of working hours the user
 * actually works — 09:00–17:00 stays 8 hours on the day the clocks change.
 */
export function expandWorkingHours(
	workingHours: WorkingHours[],
	from: Date,
	to: Date,
	timezone: string
): FreeInterval[] {
	const byDayOfWeek = new Map<number, WorkingHours>();
	for (const wh of workingHours) byDayOfWeek.set(wh.dayOfWeek, wh);

	const intervals: FreeInterval[] = [];
	// Start a day early: a working interval on the previous civil date can still
	// extend past `from` (late evening hours, or a timezone edge).
	let civil = addCivilDays(civilDateIn(from, timezone), -1);
	const lastCivil = addCivilDays(civilDateIn(to, timezone), 1);

	while (civil <= lastCivil) {
		const pattern = byDayOfWeek.get(civilDayOfWeek(civil));
		if (pattern) {
			for (const slot of pattern.intervals) {
				intervals.push({
					start: wallClockToInstant(civil, slot.start, timezone),
					end: wallClockToInstant(civil, slot.end, timezone),
					pool: 'human',
					preferredKind: slot.preferredKind
				});
			}
		}
		civil = addCivilDays(civil, 1);
	}

	return clipTo(sortIntervals(intervals), from, to);
}

/**
 * The machine pool: renders and bakes run unattended, so the whole horizon is
 * available to them, including overnight. Appointments do not block a render.
 */
export function machinePool(from: Date, to: Date): FreeInterval[] {
	if (to.getTime() <= from.getTime()) return [];
	return [{ start: from, end: to, pool: 'machine', preferredKind: 'machine' as TaskKind }];
}

/** Total hours contained in a set of intervals. */
export function totalHours(intervals: Interval[]): number {
	return intervals.reduce((sum, i) => sum + hoursBetween(i.start, i.end), 0);
}

/**
 * ISO-8601 week identifier ("2026-W36") for an instant, evaluated in the
 * user's timezone. ISO weeks start on Monday.
 */
export function isoWeekOf(instant: Date, timezone: string): string {
	return formatInTimeZone(instant, timezone, "RRRR-'W'II");
}
