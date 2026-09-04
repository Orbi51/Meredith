import { describe, expect, it } from 'vitest';
import { ForbiddenCalendarError, eventDescription, eventSummary, planSync, reconcileOwnCalendar } from './write';
import type { DesiredEvent } from './write';

function event(over: Partial<DesiredEvent> & { blockId: string }): DesiredEvent {
	return {
		googleEventId: null,
		start: new Date('2026-09-07T07:00:00Z'),
		end: new Date('2026-09-07T09:00:00Z'),
		summary: 'x',
		description: '',
		...over
	};
}

describe('planSync', () => {
	it('inserts new blocks, updates known ones, and removes orphans', () => {
		const plan = planSync(
			[event({ blockId: 'b1' }), event({ blockId: 'b2', googleEventId: 'g2' })],
			['g2', 'g3']
		);

		expect(plan.insert.map((e) => e.blockId)).toEqual(['b1']);
		expect(plan.update.map((e) => e.blockId)).toEqual(['b2']);
		expect(plan.remove).toEqual(['g3']);
	});

	it('never recreates an event that is merely moving', () => {
		// A block whose time changed keeps its googleEventId, so it must land in
		// `update` — recreating it would reset the reminder the user already saw.
		const plan = planSync([event({ blockId: 'b1', googleEventId: 'g1' })], ['g1']);

		expect(plan.insert).toEqual([]);
		expect(plan.remove).toEqual([]);
		expect(plan.update).toHaveLength(1);
	});
});

describe('event text', () => {
	it('prefixes the project name', () => {
		expect(eventSummary('Studio X', 'Storyboard rev2')).toBe('[Studio X] Storyboard rev2');
		expect(eventSummary(null, 'Invoices')).toBe('Invoices');
	});

	it('shows the raw estimate next to the calibrated one', () => {
		const description = eventDescription({
			rawEstimateHours: 6,
			effectiveEstimateHours: 9,
			deadline: null,
			taskUrl: 'https://example.test/tasks/1',
			timezone: 'Europe/Paris'
		});

		expect(description).toContain('Estimate: 6h (scheduled as 9h after calibration)');
	});

	it('says so when the estimate was inferred', () => {
		const description = eventDescription({
			rawEstimateHours: null,
			effectiveEstimateHours: 3,
			deadline: null,
			taskUrl: 'https://example.test/tasks/1',
			timezone: 'Europe/Paris'
		});

		expect(description).toContain('inferred from past work');
	});
});

describe('reconcileOwnCalendar', () => {
	// The guard matters more here than anywhere else: this function deletes
	// events, and its whole premise is "anything not accounted for is garbage".
	// Pointed at a calendar we do not own, that premise is catastrophic.
	it('refuses any calendar but our own', async () => {
		await expect(
			reconcileOwnCalendar(
				{} as never,
				'primary',
				'our-calendar-id',
				new Set(),
				{ from: new Date(), to: new Date() }
			)
		).rejects.toThrow(ForbiddenCalendarError);
	});

	it('refuses when we do not know which calendar is ours', async () => {
		// A different message, but still a refusal: an unset own-calendar means
		// "not configured", never "anything goes".
		await expect(
			reconcileOwnCalendar({} as never, 'anything', null, new Set(), {
				from: new Date(),
				to: new Date()
			})
		).rejects.toThrow(/No target calendar configured/);
	});
});
