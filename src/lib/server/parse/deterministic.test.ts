import { describe, expect, it } from 'vitest';
import { detectKind, extractDeadline, extractEstimate, stripMatches } from './deterministic';
import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'Europe/Paris';
/** Thursday 3 September 2026, 09:40 Paris. */
const NOW = new Date('2026-09-03T07:40:00.000Z');

const civilOf = (date: Date) => formatInTimeZone(date, TZ, 'yyyy-MM-dd HH:mm');

describe('extractEstimate', () => {
	it.each([
		['storyboard ~6h friday', 6],
		['lookdev 6 h', 6],
		['pass 1.5h', 1.5],
		['pass 1,5h', 1.5],
		['fix 1h30', 1.5],
		['facturation 30min', 0.5],
		['call 45 minutes', 0.75],
		['modelling 2 days', 14],
		['modelling 3 jours', 21],
		['modélisation 2j', 14],
		['modelling 2d', 14],
		['retouches demi-journée', 3.5]
	])('reads %s as %s hours', (text, expected) => {
		expect(extractEstimate(text)?.value).toBe(expected);
	});

	it('does not treat a bare number as a duration', () => {
		// "rev2" and "shot 3" are not estimates. Guessing here would silently
		// reserve the wrong amount of the week.
		expect(extractEstimate('storyboard rev2')).toBeNull();
		expect(extractEstimate('shot 3 cleanup')).toBeNull();
	});
});

describe('extractDeadline', () => {
	it('reads a weekday as the next one, not a week later', () => {
		// The failure that makes a planner untrustworthy: "friday" said on a
		// Thursday must be tomorrow.
		expect(civilOf(extractDeadline('storyboard friday', NOW, TZ)!.value)).toBe('2026-09-04 18:00');
		expect(civilOf(extractDeadline('storyboard vendredi', NOW, TZ)!.value)).toBe('2026-09-04 18:00');
	});

	it('reads "lundi prochain" as the coming Monday', () => {
		expect(civilOf(extractDeadline('rendu lundi prochain', NOW, TZ)!.value)).toBe(
			'2026-09-07 18:00'
		);
	});

	it('reads "prochain" as next week, not tomorrow', () => {
		// NOW is a Thursday. "vendredi" is tomorrow, the 4th; "vendredi prochain"
		// is the Friday of next week, the 11th. Anyone meaning tomorrow says
		// "demain". Getting this wrong by a week is the failure that makes a
		// planner untrustworthy.
		expect(civilOf(extractDeadline('storyboard vendredi', NOW, TZ)!.value)).toBe(
			'2026-09-04 18:00'
		);
		expect(civilOf(extractDeadline('storyboard vendredi prochain', NOW, TZ)!.value)).toBe(
			'2026-09-11 18:00'
		);
		expect(civilOf(extractDeadline('storyboard next friday', NOW, TZ)!.value)).toBe(
			'2026-09-11 18:00'
		);
	});

	it('reads "next sunday" as the end of next week', () => {
		// Sunday closes the week rather than opening it, so "next sunday" on a
		// Thursday is ten days out, not three.
		expect(civilOf(extractDeadline('x next sunday', NOW, TZ)!.value)).toBe('2026-09-13 18:00');
		expect(civilOf(extractDeadline('x sunday', NOW, TZ)!.value)).toBe('2026-09-06 18:00');
	});

	it('reads "next thursday" as a week away when today is Thursday', () => {
		expect(civilOf(extractDeadline('x next thursday', NOW, TZ)!.value)).toBe('2026-09-10 18:00');
		expect(civilOf(extractDeadline('x thursday', NOW, TZ)!.value)).toBe('2026-09-03 18:00');
	});

	it('handles today and tomorrow in both languages', () => {
		expect(civilOf(extractDeadline('x today', NOW, TZ)!.value)).toBe('2026-09-03 18:00');
		expect(civilOf(extractDeadline('x demain', NOW, TZ)!.value)).toBe('2026-09-04 18:00');
	});

	it('handles explicit dates, day first', () => {
		expect(civilOf(extractDeadline('x 12/09', NOW, TZ)!.value)).toBe('2026-09-12 18:00');
		expect(civilOf(extractDeadline('x 2026-10-01', NOW, TZ)!.value)).toBe('2026-10-01 18:00');
		expect(civilOf(extractDeadline('x 12 septembre', NOW, TZ)!.value)).toBe('2026-09-12 18:00');
	});

	it('rolls a past date forward to next year', () => {
		expect(civilOf(extractDeadline('x 12 janvier', NOW, TZ)!.value)).toBe('2027-01-12 18:00');
	});

	it('handles "in 3 days"', () => {
		expect(civilOf(extractDeadline('x dans 3 jours', NOW, TZ)!.value)).toBe('2026-09-06 18:00');
	});

	it('invents nothing when no date is mentioned', () => {
		// A task with no deadline is a perfectly good task. Guessing one would
		// make the overcommitment report lie.
		expect(extractDeadline('facturation août 30min', NOW, TZ)).toBeNull();
		expect(extractDeadline('fix the thing', NOW, TZ)).toBeNull();
	});

	it('survives the October DST change', () => {
		const october = new Date('2026-10-23T06:00:00.000Z'); // Friday 08:00 Paris
		// Monday 26 October is CET, so 18:00 local is 17:00Z — still 18:00 local.
		expect(civilOf(extractDeadline('x monday', october, TZ)!.value)).toBe('2026-10-26 18:00');
	});
});

describe('detectKind', () => {
	it('spots unattended work', () => {
		expect(detectKind('rendu final aurora')?.value).toBe('machine');
		expect(detectKind('bake the lighting')?.value).toBe('machine');
	});

	it('spots admin', () => {
		expect(detectKind('facturation août')?.value).toBe('admin');
		expect(detectKind('URSSAF declaration')?.value).toBe('admin');
	});

	it('says nothing when nothing decides it', () => {
		expect(detectKind('storyboard rev2')).toBeNull();
	});
});

describe('stripMatches', () => {
	it('leaves a readable title', () => {
		expect(stripMatches('storyboard rev2 ~6h friday', ['~6h', 'friday'])).toBe('storyboard rev2');
	});

	it('collapses the whitespace it leaves behind', () => {
		expect(stripMatches('a   b', [])).toBe('a b');
	});
});
