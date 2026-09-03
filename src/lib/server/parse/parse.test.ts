import { describe, expect, it } from 'vitest';
import { matchProject } from './index';
import type { ProjectChoice } from './index';

const projects: ProjectChoice[] = [
	{ id: 'p1', name: 'Studio X rebrand', clientName: 'Studio X' },
	{ id: 'p2', name: 'Aurora titles', clientName: 'Aurora Films' },
	{ id: 'p3', name: 'Aurora shorts', clientName: 'Aurora Films' }
];

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

	it('matches a unique substring', () => {
		expect(matchProject('rebrand', projects)?.id).toBe('p1');
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
