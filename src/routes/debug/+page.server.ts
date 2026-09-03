/**
 * Phase 1's only UI: run the scheduler over a fixture scenario and dump the
 * result. No database involved — this page exists so the scheduler can be
 * eyeballed as well as unit-tested.
 */

import { schedule } from '$lib/scheduler';
import { input, standardWorkingHours, task } from '$lib/scheduler/fixtures';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const scenario = input({
		workingHours: standardWorkingHours('creative'),
		tasks: [
			task({
				id: 'storyboard',
				title: 'Storyboard rev2',
				projectId: 'studio-x',
				estimateHours: 6,
				kind: 'creative',
				deadline: new Date('2026-09-09T16:00:00.000Z')
			}),
			task({
				id: 'lookdev',
				title: 'Lookdev pass',
				projectId: 'studio-x',
				estimateHours: 14,
				kind: 'creative',
				deadline: new Date('2026-09-11T16:00:00.000Z'),
				dependsOnTaskId: 'storyboard'
			}),
			task({
				id: 'invoices',
				title: 'August invoicing',
				estimateHours: 1,
				kind: 'admin',
				deadline: new Date('2026-09-15T16:00:00.000Z')
			}),
			task({
				id: 'final-render',
				title: 'Final render',
				projectId: 'studio-x',
				estimateHours: 18,
				kind: 'machine',
				dependsOnTaskId: 'lookdev'
			})
		],
		busyIntervals: [
			// A client call on Tuesday morning.
			{ start: new Date('2026-09-08T08:00:00.000Z'), end: new Date('2026-09-08T09:00:00.000Z') }
		]
	});

	return { scenario, output: schedule(scenario) };
};
