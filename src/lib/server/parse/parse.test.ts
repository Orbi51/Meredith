import { describe, expect, it, vi } from 'vitest';
import { matchProject, parseQuickAdd } from './index';
import type { ProjectChoice } from './index';

const projects: ProjectChoice[] = [
	{ id: 'p1', name: 'Studio X rebrand', clientName: 'Studio X' },
	{ id: 'p2', name: 'Aurora titles', clientName: 'Aurora Films' },
	{ id: 'p3', name: 'Aurora shorts', clientName: 'Aurora Films' }
];

const TZ = 'Europe/Paris';
/** Thursday 3 September 2026, 09:40 Paris. */
const NOW = new Date('2026-09-03T07:40:00.000Z');

// No model configured: the deterministic path must stand on its own.
vi.mock('./providers', () => ({
	activeProvider: () => 'none',
	callModel: async () => null
}));

describe('matchProject', () => {
	it('matches an exact name', () => {
		expect(matchProject('Studio X rebrand', projects)?.id).toBe('p1');
	});

	it('ignores case', () => {
		expect(matchProject('studio x rebrand', projects)?.id).toBe('p1');
	});

	it('matches on client name', () => {
		expect(matchProject('Studio X', projects)?.id).toBe('p1');
	});

	it('refuses an ambiguous match rather than guessing', () => {
		// "Aurora" fits two projects. A wrong project is worse than none, because
		// the user will not notice it.
		expect(matchProject('Aurora', projects)).toBeNull();
	});

	it('returns null for nothing recognisable', () => {
		expect(matchProject('Nonexistent', projects)).toBeNull();
		expect(matchProject('   ', projects)).toBeNull();
	});
});

describe('parseQuickAdd without any model', () => {
	const parse = (text: string) => parseQuickAdd(text, { projects, timezone: TZ, now: NOW });

	it('handles the canonical example from the plan', async () => {
		const result = await parse('storyboard rev2 Studio X ~6h friday');

		expect(result.title).toBe('storyboard rev2');
		expect(result.estimateHours).toBe(6);
		expect(result.projectId).toBe('p1');
		// Friday is tomorrow, not next week.
		expect(result.deadline?.toISOString()).toBe('2026-09-04T16:00:00.000Z');
		expect(result.source).toBe('deterministic');
	});

	it('classifies unattended work and reads French', async () => {
		const result = await parse('rendu final 12h lundi prochain');

		expect(result.kind).toBe('machine');
		expect(result.estimateHours).toBe(12);
		expect(result.deadline?.toISOString()).toBe('2026-09-07T16:00:00.000Z');
	});

	it('invents no deadline when none was given', async () => {
		const result = await parse('facturation août 30min');

		expect(result.kind).toBe('admin');
		expect(result.estimateHours).toBe(0.5);
		expect(result.deadline).toBeNull();
		expect(result.projectId).toBeNull();
	});

	it('keeps a bare title as a valid task', async () => {
		const result = await parse('fix the thing');

		expect(result.title).toBe('fix the thing');
		expect(result.estimateHours).toBeNull();
		expect(result.deadline).toBeNull();
		expect(result.projectId).toBeNull();
	});

	it('never rejects input', async () => {
		const result = await parse('   ');
		expect(result.title).toBe('Untitled task');
	});
});
