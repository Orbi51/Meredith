import { describe, expect, it } from 'vitest';
import {
	MIN_SAMPLES_FOR_MULTIPLIER,
	buildCalibrationTable,
	effectiveEstimate,
	emptyCalibrationTable,
	median
} from './calibration';
import type { CalibrationSample } from './calibration';

function samples(count: number, over: Partial<CalibrationSample> = {}): CalibrationSample[] {
	return Array.from({ length: count }, () => ({
		taskKind: 'creative' as const,
		projectId: null,
		estimateHours: 2,
		actualHours: 3,
		...over
	}));
}

describe('median', () => {
	it('returns null for an empty set', () => expect(median([])).toBeNull());
	it('handles odd counts', () => expect(median([3, 1, 2])).toBe(2));
	it('averages the middle two for even counts', () => expect(median([1, 2, 3, 4])).toBe(2.5));
});

describe('multipliers', () => {
	it('stays at 1.0 until there are enough samples', () => {
		const table = buildCalibrationTable(samples(MIN_SAMPLES_FOR_MULTIPLIER - 1));
		expect(table.byKind.creative.multiplier).toBe(1);
		expect(table.byKind.creative.sampleCount).toBe(4);
	});

	it('learns the median overrun once there are enough samples', () => {
		const table = buildCalibrationTable(samples(MIN_SAMPLES_FOR_MULTIPLIER));
		expect(table.byKind.creative.multiplier).toBe(1.5);
	});

	it('clamps a runaway sample', () => {
		const table = buildCalibrationTable(
			samples(5, { estimateHours: 1, actualHours: 100 })
		);
		expect(table.byKind.creative.multiplier).toBe(4);
	});

	it('keeps kinds independent', () => {
		const table = buildCalibrationTable([
			...samples(5),
			...samples(5, { taskKind: 'admin', estimateHours: 2, actualHours: 2 })
		]);
		expect(table.byKind.creative.multiplier).toBe(1.5);
		expect(table.byKind.admin.multiplier).toBe(1);
	});

	it('prefers a project multiplier over the kind multiplier', () => {
		const table = buildCalibrationTable([
			...samples(5), // creative overall: 1.5x
			...samples(5, { projectId: 'p1', estimateHours: 1, actualHours: 2 }) // p1: 2x
		]);
		const estimate = effectiveEstimate(
			{ kind: 'creative', projectId: 'p1', estimateHours: 3 },
			table
		);
		expect(estimate.multiplier).toBe(2);
		expect(estimate.multiplierSource).toBe('project');
		expect(estimate.effectiveHours).toBe(6);
	});
});

describe('effectiveEstimate', () => {
	it('always exposes the raw estimate alongside the calibrated one', () => {
		const table = buildCalibrationTable(samples(5));
		const estimate = effectiveEstimate(
			{ kind: 'creative', projectId: null, estimateHours: 6 },
			table
		);
		expect(estimate.rawHours).toBe(6);
		expect(estimate.effectiveHours).toBe(9);
	});

	it('infers a missing estimate from past actuals, without multiplying it again', () => {
		const table = buildCalibrationTable(samples(5)); // actuals are all 3h
		const estimate = effectiveEstimate(
			{ kind: 'creative', projectId: null, estimateHours: null },
			table
		);
		expect(estimate.inferred).toBe(true);
		expect(estimate.effectiveHours).toBe(3);
		expect(estimate.multiplier).toBe(1);
	});

	it('falls back to a default when there is no history at all', () => {
		const estimate = effectiveEstimate(
			{ kind: 'creative', projectId: null, estimateHours: null },
			emptyCalibrationTable()
		);
		expect(estimate.effectiveHours).toBe(2);
	});
});
