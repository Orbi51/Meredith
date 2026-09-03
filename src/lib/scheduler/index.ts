/**
 * The scheduler.
 *
 * A pure function: `schedule(input) -> output`. No database, no network, no
 * clock. Every hard bug in this app will live in this file, so it is written
 * to be read — long names, small steps, and comments that explain *why*.
 *
 * The shape of the algorithm (§5 of the plan):
 *
 *   1. build free intervals   (working hours − appointments)
 *   2. apply calibration      (raw estimate → effective estimate)
 *   3. compute slack          (working hours before deadline − work remaining)
 *   4. order by slack         (least room first; dependencies before dependents)
 *   5. place blocks           (walk tasks, walk gaps, respect the rules)
 *   6. report                 (what did not fit, and what is about to break)
 *
 * Step 6 is not an error path. Telling the user that the work does not fit is
 * the feature.
 */

import { effectiveEstimate } from './calibration';
import {
	MS_PER_HOUR,
	MS_PER_MINUTE,
	dropShorterThan,
	expandWorkingHours,
	hoursBetween,
	isoWeekOf,
	machinePool,
	minutesBetween,
	sortIntervals,
	subtractIntervals
} from './intervals';
import { availableHoursBetween, isAtRisk } from './slack';
import type {
	AtRiskTask,
	CapacityUsage,
	FreeInterval,
	PlannedBlock,
	SchedulableTask,
	SchedulerInput,
	SchedulerOutput,
	UnplacedTask
} from './types';

export * from './types';
export { buildCalibrationTable, emptyCalibrationTable, effectiveEstimate } from './calibration';

/** Round away float noise so two runs on identical input cannot differ. */
function roundMinutes(minutes: number): number {
	return Math.round(minutes * 1e6) / 1e6;
}

function roundHours(hours: number): number {
	return Math.round(hours * 1e4) / 1e4;
}

/** A task plus everything the scheduler derived about it. */
type PreparedTask = {
	task: SchedulableTask;
	/** Calibrated estimate, minus work already done, in minutes. */
	remainingMinutes: number;
	/** The same figure in hours, for reporting. */
	effectiveHours: number;
	/** null when the task has no deadline. */
	slackHours: number | null;
};

export function schedule(input: SchedulerInput): SchedulerOutput {
	const { now, tasks, busyIntervals, workingHours, calibration, timezone } = input;
	const horizonEnd = new Date(now.getTime() + input.horizonDays * 24 * MS_PER_HOUR);

	// ---------------------------------------------------------------- step 1
	// Human capacity: the working-hours pattern, minus every appointment.
	const humanBeforeBusy = expandWorkingHours(workingHours, now, horizonEnd, timezone);
	let humanFree = subtractIntervals(humanBeforeBusy, busyIntervals);

	// Gaps shorter than the shortest block anyone could use are not capacity,
	// they are noise. Drop them before anything downstream counts them.
	const humanTasks = tasks.filter((t) => t.kind !== 'machine');
	const smallestBlockInPlay = humanTasks.length
		? Math.min(...humanTasks.map((t) => t.minBlockMinutes))
		: 0;
	humanFree = dropShorterThan(humanFree, smallestBlockInPlay);

	// Machine work (renders, bakes) runs unattended: the whole horizon is
	// available to it, overnight included, and it never eats human capacity.
	const machineFree = machinePool(now, horizonEnd);

	// These two stay untouched — they are the denominator for slack and for the
	// capacity report. The copies inside `pools` below get consumed as blocks
	// are placed.
	const humanCapacity = sortIntervals(humanFree);
	const machineCapacity = sortIntervals(machineFree);

	// ------------------------------------------------------------ steps 2 & 3
	const prepared: PreparedTask[] = [];
	for (const task of tasks) {
		const estimate = effectiveEstimate(task, calibration);
		const remainingHours = Math.max(0, estimate.effectiveHours - task.hoursAlreadyDone);
		if (remainingHours <= 0) continue; // nothing left to schedule

		const pool = task.kind === 'machine' ? machineCapacity : humanCapacity;
		prepared.push({
			task,
			remainingMinutes: roundMinutes(remainingHours * 60),
			effectiveHours: roundHours(remainingHours),
			slackHours: task.deadline
				? roundHours(availableHoursBetween(pool, now, task.deadline) - remainingHours)
				: null
		});
	}

	// ---------------------------------------------------------------- step 4
	const ordered = orderTasks(prepared);

	// ---------------------------------------------------------------- step 5
	const pools: Record<'human' | 'machine', FreeInterval[]> = {
		human: humanCapacity.map((i) => ({ ...i })),
		machine: machineCapacity.map((i) => ({ ...i }))
	};

	const blocks: PlannedBlock[] = [];
	const unplaced: UnplacedTask[] = [];
	/** When each task's work finishes, so dependents can start after it. */
	const finishedAt = new Map<string, Date>();
	const fullyPlaced = new Set<string>();
	/** How much of each task is still to place, carried across the two rounds. */
	const remainingMinutes = new Map<string, number>();
	for (const entry of ordered) remainingMinutes.set(entry.task.id, entry.remainingMinutes);

	/**
	 * Placement happens in three rounds, and the ordering between them is what
	 * stops one overcommitted task from swallowing the whole calendar.
	 *
	 *   1. `before-deadline`  — every task gets a chance to fit before its OWN
	 *      deadline, in slack order. On-time work outranks everything.
	 *   2. `completable`      — leftovers that can still be finished somewhere in
	 *      the horizon.
	 *   3. `hopeless`         — leftovers too large to finish in the horizon at
	 *      all. These fill whatever is left.
	 *
	 * The distinction between 2 and 3 is the one that matters in practice. A
	 * 400-hour task due on Friday is not going to be finished whatever we do:
	 * its deadline is blown either way, and the user has to renegotiate. Letting
	 * it take three weeks of calendar buys nothing and costs the 9-hour job that
	 * would have fitted easily. Being honest about an impossible deadline is the
	 * point of this app; making every other plan useless is not.
	 *
	 * The hopeless work is still scheduled, still reported, and still shown as
	 * over its deadline — it simply yields to work that can actually be done.
	 */
	for (const round of ['before-deadline', 'completable', 'hopeless'] as const) {
		for (const entry of ordered) {
			placeOne(entry, round);
		}
	}

	function placeOne(entry: PreparedTask, round: 'before-deadline' | 'completable' | 'hopeless') {
		const { task } = entry;
		const remaining = remainingMinutes.get(task.id) ?? 0;
		if (remaining <= 0) return;
		// A task with no deadline has nothing to be early for; it waits for later.
		if (round === 'before-deadline' && !task.deadline) return;

		const poolName: 'human' | 'machine' = task.kind === 'machine' ? 'machine' : 'human';

		if (round !== 'before-deadline') {
			// Can what is left of this task still be finished inside the horizon?
			const capacityLeft = pools[poolName].reduce(
				(sum, interval) => sum + minutesBetween(interval.start, interval.end),
				0
			);
			const completable = remaining <= capacityLeft;
			if (round === 'completable' && !completable) return;
			if (round === 'hopeless' && completable) return;
		}

		// A dependency still in the task list must be placed, and must finish,
		// before this task may start. A dependency that is absent from the list
		// is assumed already done and constrains nothing.
		let dependencyEnd: Date | null = null;
		if (task.dependsOnTaskId) {
			const dependencyIsPending = ordered.some((o) => o.task.id === task.dependsOnTaskId);
			if (dependencyIsPending) {
				// Not placed yet: it may still be, later in this round or the next,
				// so wait rather than declaring failure. Anything still unplaced at
				// the end is reported below.
				if (!fullyPlaced.has(task.dependsOnTaskId)) return;
				dependencyEnd = finishedAt.get(task.dependsOnTaskId) ?? null;
			}
		}

		const earliestAllowed = latest([now, task.earliestStart, dependencyEnd]);
		if (earliestAllowed.getTime() >= horizonEnd.getTime()) return;

		const placement = placeTask(
			{ ...entry, remainingMinutes: remaining },
			pools[poolName],
			earliestAllowed,
			horizonEnd,
			poolName,
					round === 'before-deadline' ? (task.deadline?.getTime() ?? Infinity) : Infinity
		);

		blocks.push(...placement.blocks);
		pools[poolName] = placement.remainingCapacity;
		remainingMinutes.set(task.id, placement.leftoverMinutes);

		// The MAX end, not the last block in the array: the placement passes fill
		// preferred slots first, so a block placed later in the array can sit
		// earlier in the week. A dependent must wait for the last work to finish,
		// whichever pass produced it.
		const allBlocks = blocks.filter((b) => b.taskId === task.id);
		if (allBlocks.length > 0) {
			finishedAt.set(task.id, new Date(Math.max(...allBlocks.map((b) => b.end.getTime()))));
		}

		if (placement.leftoverMinutes <= 0) fullyPlaced.add(task.id);
	}

	// Whatever is still unplaced after both rounds, with the reason that fits.
	for (const entry of ordered) {
		const leftover = remainingMinutes.get(entry.task.id) ?? 0;
		if (leftover <= 0) continue;

		const { task } = entry;
		const dependencyPending =
			task.dependsOnTaskId !== null &&
			ordered.some((o) => o.task.id === task.dependsOnTaskId) &&
			!fullyPlaced.has(task.dependsOnTaskId);

		const startsTooLate =
			task.earliestStart !== null && task.earliestStart.getTime() >= horizonEnd.getTime();

		unplaced.push({
			taskId: task.id,
			hoursShort: roundHours(leftover / 60),
			reason: dependencyPending
				? 'dependency-unplaced'
				: startsTooLate
					? 'starts-after-horizon'
					: task.splittable
						? 'no-capacity'
						: 'no-gap-large-enough'
		});
	}

	// ---------------------------------------------------------------- step 6
	const atRisk: AtRiskTask[] = [];
	for (const entry of ordered) {
		const { deadline } = entry.task;
		if (entry.slackHours === null || !deadline) continue;

		// Work that had to be placed after its own deadline is at risk however
		// comfortable the slack figure looks — this is what catches a task stuck
		// behind a long dependency.
		const finished = finishedAt.get(entry.task.id);
		const scheduledPastDeadline = finished ? finished.getTime() > deadline.getTime() : false;

		if (scheduledPastDeadline || isAtRisk(entry.slackHours, entry.effectiveHours)) {
			atRisk.push({ taskId: entry.task.id, slackHours: entry.slackHours, scheduledPastDeadline });
		}
	}
	atRisk.sort((a, b) => a.slackHours - b.slackHours || a.taskId.localeCompare(b.taskId));

	return {
		blocks: blocks.sort(
			(a, b) => a.start.getTime() - b.start.getTime() || a.taskId.localeCompare(b.taskId)
		),
		unplaced: unplaced.sort((a, b) => a.taskId.localeCompare(b.taskId)),
		atRisk,
		capacityUsed: summariseCapacity(humanCapacity, blocks, timezone)
	};
}

/** The latest of a set of possibly-null instants. */
function latest(candidates: (Date | null)[]): Date {
	let result = new Date(0);
	for (const candidate of candidates) {
		if (candidate && candidate.getTime() > result.getTime()) result = candidate;
	}
	return result;
}

/**
 * Order tasks by ascending slack — least room to manoeuvre goes first — then
 * reorder so that every dependency precedes its dependent.
 *
 * Tasks with no deadline have infinite slack and sort last, oldest first, so
 * that something sitting in the inbox for a month eventually gets a turn.
 */
function orderTasks(prepared: PreparedTask[]): PreparedTask[] {
	const bySlack = [...prepared].sort((a, b) => {
		const aHasDeadline = a.slackHours !== null;
		const bHasDeadline = b.slackHours !== null;
		if (aHasDeadline !== bHasDeadline) return aHasDeadline ? -1 : 1;
		if (aHasDeadline && bHasDeadline) {
			const diff = (a.slackHours as number) - (b.slackHours as number);
			if (diff !== 0) return diff;
		}
		const created = a.task.createdAt.getTime() - b.task.createdAt.getTime();
		if (created !== 0) return created;
		// Final tie-break on id: without it two otherwise identical tasks could
		// swap places between runs and the output would stop being deterministic.
		return a.task.id.localeCompare(b.task.id);
	});

	const byId = new Map(bySlack.map((entry) => [entry.task.id, entry]));
	const result: PreparedTask[] = [];
	const emitted = new Set<string>();
	const visiting = new Set<string>();

	const emit = (entry: PreparedTask) => {
		if (emitted.has(entry.task.id)) return;
		if (visiting.has(entry.task.id)) return; // dependency cycle — bail, do not hang
		visiting.add(entry.task.id);

		const dependencyId = entry.task.dependsOnTaskId;
		if (dependencyId) {
			const dependency = byId.get(dependencyId);
			if (dependency) emit(dependency);
		}

		visiting.delete(entry.task.id);
		if (!emitted.has(entry.task.id)) {
			emitted.add(entry.task.id);
			result.push(entry);
		}
	};

	for (const entry of bySlack) emit(entry);
	return result;
}

type Placement = {
	blocks: PlannedBlock[];
	remainingCapacity: FreeInterval[];
	leftoverMinutes: number;
};

/**
 * Walk the free intervals and carve blocks out of them for one task.
 *
 * Two passes: intervals whose `preferredKind` matches the task come first
 * (mornings for modelling, Friday afternoon for admin), then everything else.
 * The preference is soft — unplaced work is a worse outcome than work in a
 * less-preferred slot.
 */
function placeTask(
	entry: PreparedTask,
	capacity: FreeInterval[],
	earliestAllowed: Date,
	horizonEnd: Date,
	pool: 'human' | 'machine',
	/** Hard ceiling for this round — the task's deadline, or Infinity. */
	roundLimit: number
): Placement {
	const { task } = entry;
	let remaining = entry.remainingMinutes;
	const blocks: PlannedBlock[] = [];
	let working = capacity;

	// Within a round, passes run in descending order of how happy the user
	// would be: slots reserved for this kind of work, then slots reserved for
	// nothing, then anything at all. The last pass exists only so that a soft
	// preference never leaves real work unscheduled — a deadline beats working
	// at the preferred time of day, every time.
	const kindPreferences: ((interval: FreeInterval) => boolean)[] = [
		(interval) => interval.preferredKind === task.kind,
		(interval) => interval.preferredKind === null,
		() => true
	];
	const passes = kindPreferences.map((matches) => ({ limit: roundLimit, matches }));

	for (const { limit, matches } of passes) {
		if (remaining <= 0) break;

		// The list is walked fresh each pass: earlier passes have already
		// consumed the slots they could use.
		let index = 0;
		while (index < working.length && remaining > 0) {
			const interval = working[index]!;
			if (!matches(interval)) {
				index++;
				continue;
			}

			const start = Math.max(interval.start.getTime(), earliestAllowed.getTime());
			// `limit` keeps a block from straddling the deadline on the passes
			// that are still trying to finish the task on time.
			const end = Math.min(interval.end.getTime(), horizonEnd.getTime(), limit);
			const usableMinutes = (end - start) / MS_PER_MINUTE;

			if (usableMinutes <= 0) {
				index++;
				continue;
			}

			const chunkMinutes = chunkFor(task, remaining, usableMinutes);
			if (chunkMinutes === null) {
				index++;
				continue;
			}

			const blockStart = new Date(start);
			const blockEnd = new Date(start + chunkMinutes * MS_PER_MINUTE);
			blocks.push({ taskId: task.id, start: blockStart, end: blockEnd, pool });
			remaining = roundMinutes(remaining - chunkMinutes);

			// Replace the interval with whatever is left of it either side of the
			// block. `index` deliberately does not advance past a leading
			// remainder — another task may still be able to use that piece.
			working = consume(working, index, blockStart, blockEnd);
		}
	}

	return { blocks, remainingCapacity: working, leftoverMinutes: Math.max(0, remaining) };
}

/**
 * How many minutes of this task may go into a gap of `usableMinutes`, or null
 * if the gap is unusable for it.
 *
 * The two rules that keep the calendar honest:
 *   - a non-splittable task needs one gap big enough for all of it;
 *   - a block is never shorter than the task's minBlockMinutes, unless it is
 *     the final remainder of that task (a 2.5h creative task may end in a
 *     30-minute block rather than never finishing).
 */
function chunkFor(
	task: SchedulableTask,
	remainingMinutes: number,
	usableMinutes: number
): number | null {
	if (!task.splittable) {
		return usableMinutes >= remainingMinutes ? remainingMinutes : null;
	}

	const chunk = Math.min(remainingMinutes, usableMinutes);
	if (chunk >= task.minBlockMinutes) return chunk;
	// Shorter than the minimum block — acceptable only as the task's tail.
	if (chunk === remainingMinutes) return chunk;
	return null;
}

/** Remove [start, end) from the interval at `index`, keeping any remainders. */
function consume(intervals: FreeInterval[], index: number, start: Date, end: Date): FreeInterval[] {
	const interval = intervals[index]!;
	const replacements: FreeInterval[] = [];

	if (interval.start.getTime() < start.getTime()) {
		replacements.push({ ...interval, end: start });
	}
	if (end.getTime() < interval.end.getTime()) {
		replacements.push({ ...interval, start: end });
	}

	return [...intervals.slice(0, index), ...replacements, ...intervals.slice(index + 1)];
}

/**
 * Committed versus available hours per ISO week — the number the Monday ritual
 * turns red. Machine blocks are excluded: a render going overnight is not a
 * claim on the user's time.
 */
function summariseCapacity(
	humanCapacity: FreeInterval[],
	blocks: PlannedBlock[],
	timezone: string
): CapacityUsage[] {
	const available = new Map<string, number>();
	const committed = new Map<string, number>();

	const add = (map: Map<string, number>, week: string, hours: number) => {
		map.set(week, (map.get(week) ?? 0) + hours);
	};

	// Working intervals and the blocks inside them never cross midnight, let
	// alone a Monday, so attributing each to the week of its start is exact.
	for (const interval of humanCapacity) {
		add(available, isoWeekOf(interval.start, timezone), hoursBetween(interval.start, interval.end));
	}
	for (const block of blocks) {
		if (block.pool !== 'human') continue;
		add(committed, isoWeekOf(block.start, timezone), hoursBetween(block.start, block.end));
	}

	const weeks = [...new Set([...available.keys(), ...committed.keys()])].sort();
	return weeks.map((weekIso) => ({
		weekIso,
		committedHours: roundHours(committed.get(weekIso) ?? 0),
		availableHours: roundHours(available.get(weekIso) ?? 0)
	}));
}
