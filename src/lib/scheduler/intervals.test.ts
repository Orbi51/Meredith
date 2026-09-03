import { describe, expect, it } from 'vitest';
import {
	addCivilDays,
	civilDayOfWeek,
	expandWorkingHours,
	isoWeekOf,
	mergeIntervals,
	subtractIntervals,
	totalHours,
	wallClockToInstant
} from './intervals';
import { TIMEZONE, standardWorkingHours } from './fixtures';
import type { FreeInterval } from './types';

function free(startIso: string, endIso: string): FreeInterval {
	return {
		start: new Date(startIso),
		end: new Date(endIso),
		pool: 'human',
		preferredKind: null
	};
}

describe('mergeIntervals', () => {
	it('merges overlapping and touching intervals and drops empty ones', () => {
		const merged = mergeIntervals([
			{ start: new Date('2026-09-07T09:00Z'), end: new Date('2026-09-07T10:00Z') },
			{ start: new Date('2026-09-07T09:30Z'), end: new Date('2026-09-07T11:00Z') },
			{ start: new Date('2026-09-07T11:00Z'), end: new Date('2026-09-07T12:00Z') },
			{ start: new Date('2026-09-07T15:00Z'), end: new Date('2026-09-07T15:00Z') },
			{ start: new Date('2026-09-07T16:00Z'), end: new Date('2026-09-07T17:00Z') }
		]);

		expect(merged.map((i) => [i.start.toISOString(), i.end.toISOString()])).toEqual([
			['2026-09-07T09:00:00.000Z', '2026-09-07T12:00:00.000Z'],
			['2026-09-07T16:00:00.000Z', '2026-09-07T17:00:00.000Z']
		]);
	});
});

describe('subtractIntervals', () => {
	it('splits a free interval around a busy one and keeps its metadata', () => {
		const result = subtractIntervals(
			[{ ...free('2026-09-07T09:00Z', '2026-09-07T17:00Z'), preferredKind: 'creative' }],
			[{ start: new Date('2026-09-07T12:00Z'), end: new Date('2026-09-07T13:00Z') }]
		);

		expect(result).toHaveLength(2);
		expect(totalHours(result)).toBe(7);
		expect(result.every((i) => i.preferredKind === 'creative')).toBe(true);
	});

	it('removes a free interval swallowed whole', () => {
		const result = subtractIntervals(
			[free('2026-09-07T09:00Z', '2026-09-07T10:00Z')],
			[{ start: new Date('2026-09-07T08:00Z'), end: new Date('2026-09-07T18:00Z') }]
		);
		expect(result).toEqual([]);
	});
});

describe('civil date arithmetic', () => {
	it('adds days across a month boundary', () => {
		expect(addCivilDays('2026-09-30', 1)).toBe('2026-10-01');
		expect(addCivilDays('2026-01-01', -1)).toBe('2025-12-31');
	});

	it('knows the day of week', () => {
		expect(civilDayOfWeek('2026-09-07')).toBe(1); // a Monday
	});
});

describe('timezone handling', () => {
	it('converts wall-clock time to the right instant either side of the DST change', () => {
		// 25 October 2026 is the autumn transition in Europe/Paris.
		expect(wallClockToInstant('2026-10-23', '09:00', TIMEZONE).toISOString()).toBe(
			'2026-10-23T07:00:00.000Z' // CEST, +02:00
		);
		expect(wallClockToInstant('2026-10-26', '09:00', TIMEZONE).toISOString()).toBe(
			'2026-10-26T08:00:00.000Z' // CET, +01:00
		);
	});

	it('gives every working day the same length across a DST transition', () => {
		const intervals = expandWorkingHours(
			standardWorkingHours(),
			new Date('2026-10-19T00:00:00Z'),
			new Date('2026-11-02T00:00:00Z'),
			TIMEZONE
		);

		const byDay = new Map<string, number>();
		for (const i of intervals) {
			const day = i.start.toISOString().slice(0, 10);
			byDay.set(day, (byDay.get(day) ?? 0) + totalHours([i]));
		}

		expect([...new Set(byDay.values())]).toEqual([7.5]);
		expect(byDay.size).toBe(10); // two working weeks
	});

	it('labels weeks with ISO week numbers', () => {
		expect(isoWeekOf(new Date('2026-09-07T08:00:00Z'), TIMEZONE)).toBe('2026-W37');
		// A Sunday belongs to the week that started on the previous Monday.
		expect(isoWeekOf(new Date('2026-09-13T08:00:00Z'), TIMEZONE)).toBe('2026-W37');
		expect(isoWeekOf(new Date('2026-09-14T08:00:00Z'), TIMEZONE)).toBe('2026-W38');
	});
});
