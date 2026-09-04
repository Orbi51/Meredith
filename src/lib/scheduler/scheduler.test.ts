/**
 * The test suite from §5 of the plan. These tests define what "correct" means
 * for the scheduler; they were written before the placement code and every
 * change to the scheduler must come with an addition here.
 */

import { describe, expect, it } from 'vitest';
import { formatInTimeZone } from 'date-fns-tz';
import { minutesBetween } from './intervals';
import { schedule } from './index';
import { hoursOfBlocks, input, interval, paris, standardWorkingHours, task } from './fixtures';
import { hoursBetween } from './intervals';

describe('placement', () => {
	it('places a single task in an empty week', () => {
		const output = schedule(
			input({ tasks: [task({ id: 'a', estimateHours: 3, kind: 'creative' })] })
		);

		expect(output.unplaced).toEqual([]);
		expect(hoursOfBlocks(output.blocks)).toBe(3);
		// The first working interval of the horizon is Monday 09:00 Paris.
		expect(output.blocks[0]!.start.toISOString()).toBe('2026-09-07T07:00:00.000Z');
	});

	it('reports the shortfall when a task is larger than the remaining capacity', () => {
		// One working day in the horizon (7.5h) against a 12h task.
		const output = schedule(
			input({
				horizonDays: 1,
				tasks: [task({ id: 'big', estimateHours: 12, kind: 'admin' })]
			})
		);

		expect(hoursOfBlocks(output.blocks)).toBe(7.5);
		expect(output.unplaced).toEqual([{ taskId: 'big', hoursShort: 4.5, reason: 'no-capacity' }]);
	});

	it('does not spread a non-splittable 3h task across three 1h gaps', () => {
		const workingHours = [
			{
				dayOfWeek: 1,
				intervals: [
					{ start: '09:00', end: '10:00', preferredKind: null },
					{ start: '11:00', end: '12:00', preferredKind: null },
					{ start: '14:00', end: '15:00', preferredKind: null }
				]
			}
		];

		const output = schedule(
			input({
				horizonDays: 1,
				workingHours,
				tasks: [
					task({ id: 'atomic', estimateHours: 3, splittable: false, minBlockMinutes: 30 })
				]
			})
		);

		expect(output.blocks).toEqual([]);
		expect(output.unplaced).toEqual([
			{ taskId: 'atomic', hoursShort: 3, reason: 'no-gap-large-enough' }
		]);
	});

	it('never gives a task with minBlockMinutes 120 a 90-minute block', () => {
		const workingHours = [
			{
				dayOfWeek: 1,
				intervals: [
					{ start: '09:00', end: '10:30', preferredKind: null },
					{ start: '14:00', end: '15:30', preferredKind: null }
				]
			}
		];

		const output = schedule(
			input({
				horizonDays: 1,
				workingHours,
				tasks: [task({ id: 'deep', estimateHours: 4, minBlockMinutes: 120 })]
			})
		);

		expect(output.blocks).toEqual([]);
		expect(output.unplaced[0]).toMatchObject({ taskId: 'deep', hoursShort: 4 });
	});

	it('takes less now rather than stranding a remainder too small to use', () => {
		// 2.5h of creative work with a 2h minimum, and a morning only 2h long.
		//
		// This used to place 2h and then a 30-minute crumb. Half an hour of
		// modelling achieves nothing, so the scheduler now prefers a slot that
		// can hold the work properly — or splits so that BOTH halves are usable.
		const workingHours = [
			{
				dayOfWeek: 1,
				intervals: [
					{ start: '09:00', end: '11:00', preferredKind: null },
					{ start: '14:00', end: '18:00', preferredKind: null }
				]
			}
		];

		const output = schedule(
			input({
				horizonDays: 1,
				workingHours,
				tasks: [task({ id: 'tail', estimateHours: 2.5, minBlockMinutes: 120 })]
			})
		);

		expect(output.unplaced).toEqual([]);
		// One 2.5h block in the afternoon, not 2h plus a crumb in the morning.
		expect(output.blocks.map((b) => hoursBetween(b.start, b.end))).toEqual([2.5]);
		for (const block of output.blocks) {
			expect(hoursBetween(block.start, block.end)).toBeGreaterThanOrEqual(2);
		}
	});
});

describe('ordering', () => {
	it('places the lower-slack task first even though its deadline is later', () => {
		// `urgent` is due Friday but needs nearly every working hour until then.
		// `roomy` is due Wednesday but is tiny, so it has more slack.
		const output = schedule(
			input({
				tasks: [
					task({
						id: 'roomy',
						estimateHours: 1,
						kind: 'admin',
						deadline: paris('2026-09-09T18:00')
					}),
					task({
						id: 'urgent',
						estimateHours: 34,
						kind: 'admin',
						deadline: paris('2026-09-11T18:00')
					})
				]
			})
		);

		expect(output.blocks[0]!.taskId).toBe('urgent');
		const slackById = Object.fromEntries(output.atRisk.map((r) => [r.taskId, r.slackHours]));
		expect(slackById['urgent']).toBeLessThan(5); // 37.5h available, 34h of work
		// And the consequence is reported rather than hidden: giving `urgent` the
		// week is what pushes `roomy` past its own Wednesday deadline.
		expect(output.atRisk.find((r) => r.taskId === 'roomy')?.scheduledPastDeadline).toBe(true);
	});

	it('never places a dependent task before its dependency ends', () => {
		const output = schedule(
			input({
				tasks: [
					// The dependent has the tighter deadline, so slack alone would
					// put it first. The dependency must still win.
					task({
						id: 'render',
						estimateHours: 2,
						kind: 'admin',
						dependsOnTaskId: 'model',
						deadline: paris('2026-09-08T12:00')
					}),
					task({ id: 'model', estimateHours: 4, kind: 'admin' })
				]
			})
		);

		const modelEnd = Math.max(
			...output.blocks.filter((b) => b.taskId === 'model').map((b) => b.end.getTime())
		);
		const renderStart = Math.min(
			...output.blocks.filter((b) => b.taskId === 'render').map((b) => b.start.getTime())
		);

		expect(renderStart).toBeGreaterThanOrEqual(modelEnd);
	});

	it('waits for the dependency block that finishes last, not the one placed last', () => {
		// The dependency's blocks come out of the placement passes in preferred-
		// first order, so its chronologically last block is not the last element
		// of the array. Taking the wrong one lets the dependent start too early.
		const output = schedule(
			input({
				workingHours: standardWorkingHours('creative'),
				tasks: [
					task({
						id: 'lookdev',
						estimateHours: 14,
						kind: 'creative',
						deadline: paris('2026-09-11T18:00')
					}),
					task({ id: 'render', estimateHours: 6, kind: 'machine', dependsOnTaskId: 'lookdev' })
				]
			})
		);

		const lookdevEnd = Math.max(
			...output.blocks.filter((b) => b.taskId === 'lookdev').map((b) => b.end.getTime())
		);
		const renderStart = Math.min(
			...output.blocks.filter((b) => b.taskId === 'render').map((b) => b.start.getTime())
		);

		expect(renderStart).toBeGreaterThanOrEqual(lookdevEnd);
	});

	it('flags a task pushed past its own deadline by a dependency', () => {
		const output = schedule(
			input({
				tasks: [
					task({ id: 'model', estimateHours: 36, kind: 'admin' }),
					task({
						id: 'render',
						estimateHours: 4,
						kind: 'admin',
						dependsOnTaskId: 'model',
						// Comfortable on paper — 37.5 working hours before it — but
						// unreachable behind 36h of prerequisite work.
						deadline: paris('2026-09-11T18:00')
					})
				]
			})
		);

		const risk = output.atRisk.find((r) => r.taskId === 'render');
		expect(risk?.scheduledPastDeadline).toBe(true);
		expect(risk!.slackHours).toBeGreaterThan(0);
	});

	it('meets a deadline rather than waiting for the preferred time of day', () => {
		// Mornings are reserved for creative work, but a 12h creative task due
		// Wednesday cannot wait for four mornings — it takes the afternoons.
		const output = schedule(
			input({
				workingHours: standardWorkingHours('creative'),
				tasks: [
					task({
						id: 'model',
						estimateHours: 12,
						kind: 'creative',
						deadline: paris('2026-09-09T18:00')
					})
				]
			})
		);

		expect(output.unplaced).toEqual([]);
		const lastEnd = Math.max(...output.blocks.map((b) => b.end.getTime()));
		expect(lastEnd).toBeLessThanOrEqual(paris('2026-09-09T18:00').getTime());
		expect(output.atRisk).toEqual([]);
	});

	it('leaves a dependent unplaced when its dependency does not fit', () => {
		const output = schedule(
			input({
				horizonDays: 1,
				tasks: [
					task({ id: 'blocked', estimateHours: 1, kind: 'admin', dependsOnTaskId: 'huge' }),
					task({ id: 'huge', estimateHours: 40, kind: 'admin' })
				]
			})
		);

		expect(output.unplaced).toContainEqual({
			taskId: 'blocked',
			hoursShort: 1,
			reason: 'dependency-unplaced'
		});
		expect(output.blocks.some((b) => b.taskId === 'blocked')).toBe(false);
	});

	it('does not let one impossible task starve work that would have fitted', () => {
		// 400h due in two days cannot be done. Left unchecked it takes the whole
		// three-week horizon and everything else gets nothing — which makes the
		// plan useless precisely when the user most needs it to be honest.
		const output = schedule(
			input({
				tasks: [
					task({
						id: 'impossible',
						estimateHours: 400,
						kind: 'admin',
						deadline: paris('2026-09-09T18:00')
					}),
					task({
						id: 'doable',
						estimateHours: 9,
						kind: 'creative',
						deadline: paris('2026-09-18T18:00')
					})
				]
			})
		);

		const doableHours = output.blocks
			.filter((b) => b.taskId === 'doable')
			.reduce((sum, b) => sum + hoursBetween(b.start, b.end), 0);

		expect(doableHours).toBe(9);
		expect(output.unplaced.map((u) => u.taskId)).toEqual(['impossible']);
		// The impossible task is still reported as impossible, loudly.
		expect(output.atRisk.find((r) => r.taskId === 'impossible')?.slackHours).toBeLessThan(0);
	});

	it('still lets an urgent task take the week when it genuinely fits', () => {
		// The guard above must not become "everything gets a fair share": a task
		// that can be finished on time still gets priority over a slacker one.
		const output = schedule(
			input({
				tasks: [
					task({
						id: 'urgent',
						estimateHours: 30,
						kind: 'admin',
						deadline: paris('2026-09-11T18:00')
					}),
					task({ id: 'whenever', estimateHours: 20, kind: 'admin' })
				]
			})
		);

		expect(output.blocks[0]!.taskId).toBe('urgent');
		const urgentEnd = Math.max(
			...output.blocks.filter((b) => b.taskId === 'urgent').map((b) => b.end.getTime())
		);
		expect(urgentEnd).toBeLessThanOrEqual(paris('2026-09-11T18:00').getTime());
	});

	it('fills the afternoon before moving to the next morning', () => {
		// The real pattern: mornings reserved for creative work, afternoons open.
		// Preference used to be applied across the whole horizon, so a creative
		// task took every morning for three weeks and never touched an
		// afternoon — a plan nobody would choose.
		const workingHours = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
			dayOfWeek,
			intervals: [
				{ start: '09:00', end: '12:30', preferredKind: 'creative' as const },
				{ start: '14:00', end: '19:00', preferredKind: null }
			]
		}));

		const output = schedule(
			input({
				workingHours,
				tasks: [task({ id: 'big', estimateHours: 16, kind: 'creative' })]
			})
		);

		const days = new Set(
			output.blocks.map((b) => formatInTimeZone(b.start, 'Europe/Paris', 'yyyy-MM-dd'))
		);
		// 16h of work against 8.5h a day: two days, not five mornings.
		expect(days.size).toBeLessThanOrEqual(3);

		const usesAfternoon = output.blocks.some(
			(b) => Number(formatInTimeZone(b.start, 'Europe/Paris', 'H')) >= 14
		);
		expect(usesAfternoon).toBe(true);
	});

	it('still prefers the morning within a day', () => {
		// The preference is not abandoned — it simply competes inside one day
		// rather than across the horizon.
		const output = schedule(
			input({
				workingHours: [
					{
						dayOfWeek: 1,
						intervals: [
							{ start: '09:00', end: '12:30', preferredKind: 'creative' as const },
							{ start: '14:00', end: '19:00', preferredKind: null }
						]
					}
				],
				tasks: [task({ id: 'small', estimateHours: 2, kind: 'creative' })]
			})
		);

		const first = output.blocks[0]!;
		expect(Number(formatInTimeZone(first.start, 'Europe/Paris', 'H'))).toBeLessThan(12);
	});

	it('never strands a crumb of creative work', () => {
		// A 4h task meeting a 3h30 morning used to place 3h30 and then a
		// 30-minute fragment. Half an hour of modelling achieves nothing — §5
		// exists precisely to prevent a calendar that looks full and is not.
		const output = schedule(
			input({
				workingHours: [
					{
						dayOfWeek: 1,
						intervals: [
							{ start: '09:00', end: '12:30', preferredKind: 'creative' as const },
							{ start: '14:00', end: '19:00', preferredKind: null }
						]
					}
				],
				tasks: [task({ id: 'four-hours', estimateHours: 4, kind: 'creative' })]
			})
		);

		for (const block of output.blocks) {
			expect(minutesBetween(block.start, block.end)).toBeGreaterThanOrEqual(120);
		}
	});

	it('still schedules a task smaller than its own minimum block', () => {
		// The rule must not make a one-hour creative task unschedulable.
		const output = schedule(
			input({ tasks: [task({ id: 'short', estimateHours: 1, kind: 'creative' })] })
		);
		expect(output.blocks).toHaveLength(1);
		expect(minutesBetween(output.blocks[0]!.start, output.blocks[0]!.end)).toBe(60);
	});

	it('respects earliestStart', () => {
		const output = schedule(
			input({
				tasks: [
					task({
						id: 'later',
						estimateHours: 2,
						kind: 'admin',
						earliestStart: paris('2026-09-09T00:00')
					})
				]
			})
		);

		expect(output.blocks[0]!.start.getTime()).toBeGreaterThanOrEqual(
			paris('2026-09-09T00:00').getTime()
		);
	});
});

describe('busy intervals', () => {
	it('excludes busy time and merges overlapping busy intervals', () => {
		const busyIntervals = [
			interval('2026-09-07T07:00:00Z', '2026-09-07T09:00:00Z'), // 09:00–11:00 Paris
			interval('2026-09-07T08:00:00Z', '2026-09-07T10:30:00Z') // 10:00–12:30 Paris, overlaps
		];

		const output = schedule(
			input({
				horizonDays: 1,
				busyIntervals,
				tasks: [task({ id: 'a', estimateHours: 10, kind: 'admin' })]
			})
		);

		// Monday's morning interval is entirely consumed by the two appointments;
		// only the 14:00–18:00 block survives.
		expect(hoursOfBlocks(output.blocks)).toBe(4);
		expect(output.blocks[0]!.start.toISOString()).toBe('2026-09-07T12:00:00.000Z');
		expect(output.capacityUsed[0]).toEqual({
			weekIso: '2026-W37',
			committedHours: 4,
			availableHours: 4
		});
	});

	it('treats a task that has already been partly worked as smaller', () => {
		const output = schedule(
			input({
				tasks: [task({ id: 'a', estimateHours: 6, kind: 'admin', hoursAlreadyDone: 4 })]
			})
		);

		expect(hoursOfBlocks(output.blocks)).toBe(2);
	});
});

describe('the machine pool', () => {
	it('overlaps a human block without reducing human capacity', () => {
		const withoutRender = schedule(
			input({ horizonDays: 1, tasks: [task({ id: 'human', estimateHours: 7.5, kind: 'admin' })] })
		);

		const withRender = schedule(
			input({
				horizonDays: 1,
				tasks: [
					task({ id: 'human', estimateHours: 7.5, kind: 'admin' }),
					task({ id: 'bake', estimateHours: 10, kind: 'machine' })
				]
			})
		);

		const humanBlocks = withRender.blocks.filter((b) => b.pool === 'human');
		const machineBlocks = withRender.blocks.filter((b) => b.pool === 'machine');

		// The human's day is untouched by the render.
		expect(humanBlocks).toEqual(withoutRender.blocks);
		expect(withRender.unplaced).toEqual([]);
		expect(hoursOfBlocks(machineBlocks)).toBe(10);
		expect(withRender.capacityUsed).toEqual(withoutRender.capacityUsed);

		// And the render genuinely overlaps the human work rather than queueing.
		const humanStart = humanBlocks[0]!.start.getTime();
		expect(machineBlocks[0]!.start.getTime()).toBeLessThanOrEqual(humanStart);
	});

	it('lets machine work run overnight', () => {
		const output = schedule(
			input({ horizonDays: 2, tasks: [task({ id: 'bake', estimateHours: 20, kind: 'machine' })] })
		);

		expect(output.unplaced).toEqual([]);
		expect(output.blocks).toHaveLength(1);
		expect(hoursOfBlocks(output.blocks)).toBe(20);
	});
});

describe('preferred kind', () => {
	it('prefers matching intervals but falls back rather than leaving work unplaced', () => {
		// Mornings are marked for creative work; afternoons are unmarked.
		const output = schedule(
			input({
				horizonDays: 1,
				workingHours: standardWorkingHours('creative'),
				tasks: [task({ id: 'model', estimateHours: 6, kind: 'creative' })]
			})
		);

		expect(output.unplaced).toEqual([]);
		// 3.5h in the preferred morning, the remaining 2.5h in the afternoon.
		expect(output.blocks.map((b) => hoursBetween(b.start, b.end))).toEqual([3.5, 2.5]);
	});

	it('sends admin work to the afternoon when the morning is reserved for creative', () => {
		const output = schedule(
			input({
				horizonDays: 1,
				workingHours: standardWorkingHours('creative'),
				tasks: [task({ id: 'invoices', estimateHours: 1, kind: 'admin' })]
			})
		);

		// 14:00 Paris = 12:00 UTC.
		expect(output.blocks[0]!.start.toISOString()).toBe('2026-09-07T12:00:00.000Z');
	});
});

describe('determinism', () => {
	it('produces identical output for identical input', () => {
		const build = () =>
			input({
				tasks: [
					task({ id: 'b', estimateHours: 4, kind: 'admin', deadline: paris('2026-09-10T18:00') }),
					task({ id: 'a', estimateHours: 4, kind: 'admin', deadline: paris('2026-09-10T18:00') }),
					task({ id: 'c', estimateHours: 3, kind: 'creative' }),
					task({ id: 'd', estimateHours: 5, kind: 'machine' })
				]
			});

		const first = schedule(build());
		const second = schedule(build());

		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
	});
});

describe('daylight saving', () => {
	it('does not produce a 23- or 25-hour day across the October transition', () => {
		// Sunday 25 October 2026 is the autumn transition in Europe/Paris.
		const output = schedule(
			input({
				now: new Date('2026-10-23T04:00:00.000Z'), // Friday 06:00 Paris
				horizonDays: 5,
				workingHours: standardWorkingHours(),
				tasks: [task({ id: 'a', estimateHours: 100, kind: 'admin' })]
			})
		);

		const byDay = new Map<string, number>();
		for (const block of output.blocks) {
			const day = block.start.toISOString().slice(0, 10);
			byDay.set(day, (byDay.get(day) ?? 0) + hoursBetween(block.start, block.end));
		}

		// Friday, Monday and Tuesday: 7.5 working hours each, transition or not.
		expect([...byDay.values()]).toEqual([7.5, 7.5, 7.5]);

		// Monday 26 October is CET (+01:00), so 09:00 Paris is 08:00 UTC — the
		// instant shifts, the working day does not get longer.
		const monday = output.blocks.find((b) => b.start.toISOString().startsWith('2026-10-26'));
		expect(monday!.start.toISOString()).toBe('2026-10-26T08:00:00.000Z');
	});
});

describe('capacity reporting', () => {
	it('reports committed against available hours per ISO week', () => {
		const output = schedule(
			input({ horizonDays: 14, tasks: [task({ id: 'a', estimateHours: 10, kind: 'admin' })] })
		);

		expect(output.capacityUsed.map((c) => c.weekIso)).toEqual(['2026-W37', '2026-W38']);
		expect(output.capacityUsed[0]!.availableHours).toBe(37.5);
		expect(output.capacityUsed[0]!.committedHours).toBe(10);
		expect(output.capacityUsed[1]!.committedHours).toBe(0);
	});
});
