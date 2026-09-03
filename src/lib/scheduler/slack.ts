/**
 * Slack: how much room a task has left before its deadline.
 *
 *   slack = (working hours available between now and the deadline)
 *           − (remaining effective estimate)
 *
 * Measured in *working* hours, not wall-clock hours. That is the whole point:
 * a deadline three weeks out with only four working days in between is not
 * comfortable, and only this measure says so.
 *
 * Negative slack means the task is already impossible. Small positive slack
 * means it is urgent no matter how distant the date looks.
 */

import { clipTo, totalHours } from './intervals';
import type { FreeInterval } from './types';

/** Below this fraction of the estimate, a task is flagged at risk. */
export const AT_RISK_SLACK_FRACTION = 0.2;

export function availableHoursBetween(
	freeIntervals: FreeInterval[],
	from: Date,
	to: Date
): number {
	if (to.getTime() <= from.getTime()) return 0;
	return totalHours(clipTo(freeIntervals, from, to));
}

export function slackHours(
	freeIntervals: FreeInterval[],
	now: Date,
	deadline: Date,
	remainingEstimateHours: number
): number {
	return availableHoursBetween(freeIntervals, now, deadline) - remainingEstimateHours;
}

/**
 * At risk when the task cannot fit at all, or fits with so little margin that
 * one bad day breaks it.
 */
export function isAtRisk(slack: number, effectiveEstimateHours: number): boolean {
	if (slack < 0) return true;
	return slack < effectiveEstimateHours * AT_RISK_SLACK_FRACTION;
}
