import { describe, expect, it } from 'vitest';
import { formatInTimeZone } from 'date-fns-tz';
import { looksStructured, parseStructured, splitSegments } from './structured';
import type { ProjectLike } from './structured';

const TZ = 'Europe/Paris';
/** Thursday 3 September 2026, 09:40 Paris. */
const NOW = new Date('2026-09-03T07:40:00.000Z');

const projects: ProjectLike[] = [
	{ id: 'p1', name: 'Studio X rebrand', clientName: 'Studio X' },
	{ id: 'p2', name: 'Aurora titles', clientName: 'Aurora Films' }
];

const parse = (text: string) => parseStructured(text, { projects, timezone: TZ, now: NOW });
const day = (date: Date | null) => (date ? formatInTimeZone(date, TZ, 'yyyy-MM-dd HH:mm') : null);

describe('looksStructured', () => {
	it('needs a spaced dash', () => {
		expect(looksStructured('Studio X - storyboard - 6h')).toBe(true);
		expect(looksStructured('storyboard rev2 ~6h friday')).toBe(false);
	});

	it('does not mistake hyphens inside words or dates for delimiters', () => {
		// This is the reason the delimiter is spaced.
		expect(looksStructured('storyboard rev-2')).toBe(false);
		expect(looksStructured('send e-mail to client')).toBe(false);
		expect(looksStructured('deadline 2026-09-12')).toBe(false);
	});

	it('accepts en and em dashes, which editors substitute silently', () => {
		expect(looksStructured('Studio X – storyboard')).toBe(true);
		expect(looksStructured('Studio X — storyboard')).toBe(true);
	});
});

describe('splitSegments', () => {
	it('trims and drops empties', () => {
		expect(splitSegments('a  -  b - ')).toEqual(['a', 'b']);
	});
});

describe('parseStructured', () => {
	it('reads the documented order', () => {
		const result = parse('Studio X - storyboard rev2 - 6h - friday');

		expect(result.projectId).toBe('p1');
		expect(result.title).toBe('storyboard rev2');
		expect(result.estimateHours).toBe(6);
		expect(day(result.deadline)).toBe('2026-09-04 18:00');
		expect(result.unmatchedProjectName).toBeNull();
	});

	it('does not care about the order', () => {
		// Fields are recognised by what they look like, so "roughly in that
		// order" is good enough.
		const result = parse('storyboard rev2 - friday - Studio X - 6h');

		expect(result.projectId).toBe('p1');
		expect(result.title).toBe('storyboard rev2');
		expect(result.estimateHours).toBe(6);
		expect(day(result.deadline)).toBe('2026-09-04 18:00');
	});

	it('accepts a partial capture', () => {
		const result = parse('storyboard rev2 - 6h');

		expect(result.title).toBe('storyboard rev2');
		expect(result.estimateHours).toBe(6);
		expect(result.deadline).toBeNull();
		expect(result.projectId).toBeNull();
	});

	it('offers an unknown leading project rather than creating it', () => {
		const result = parse('Nebula - cleanup shot 3 - 2h - demain');

		expect(result.projectId).toBeNull();
		expect(result.unmatchedProjectName).toBe('Nebula');
		expect(result.title).toBe('cleanup shot 3');
		expect(day(result.deadline)).toBe('2026-09-04 18:00');
	});

	it('keeps French wording exactly as typed', () => {
		const result = parse('Aurora Films - modélisation du décor principal - 2j - 12/09');

		expect(result.projectId).toBe('p2');
		expect(result.title).toBe('modélisation du décor principal');
		expect(result.estimateHours).toBe(14);
		expect(day(result.deadline)).toBe('2026-09-12 18:00');
	});

	it('detects unattended work from the whole capture', () => {
		const result = parse('Aurora titles - rendu final - 12h - lundi prochain');

		expect(result.kind).toBe('machine');
		expect(day(result.deadline)).toBe('2026-09-07 18:00');
	});

	it('does not treat a title that mentions a duration as the estimate', () => {
		// "render 6h of fog" is a title, not an estimate — only a segment that is
		// ENTIRELY a duration counts.
		const result = parse('Studio X - render 6h of fog');

		expect(result.title).toBe('render 6h of fog');
		expect(result.estimateHours).toBeNull();
	});

	it('keeps extra prose as notes rather than losing it', () => {
		const result = parse('Studio X - storyboard rev2 - 6h - friday - client wants 3 variants');

		expect(result.title).toBe('storyboard rev2');
		expect(result.notes).toBe('client wants 3 variants');
	});
});
