/**
 * The daily job, run inside the app process.
 *
 * The plan chose Railway specifically for "an always-on Node process so cron
 * works" — so the simplest correct thing is to schedule it here rather than
 * configure a second service whose only job is to call an HTTP endpoint.
 *
 * `/api/cron/daily` still exists and does the same work, for anyone who would
 * rather drive it from outside.
 *
 * What it does, once a morning:
 *   - replan (which also adopts new calendar work);
 *   - send the brief, if there is anything on today;
 *   - alert, but only if a deadline has newly broken;
 *   - and, as a side effect, keep the Google refresh token alive. Tokens
 *     expire after ~6 months of disuse, so a daily call means that never
 *     happens.
 */

import { formatInTimeZone } from 'date-fns-tz';
import { db, schema } from './db';
import { getBlocksBetween, getSettings, listTasks } from './db/queries';
import { replan } from './planner';
import { notifyIfWorse, sendDailyBrief } from './notify';
import { ensureRecurringAdmin } from './freelance';
import { wallClockToInstant } from '$lib/scheduler/intervals';

/** Local time the brief goes out. Early enough to shape the day. */
const RUN_AT_HOUR = 7;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

export async function runDailyJob(): Promise<{ user: string; alerted: boolean; briefed: boolean }[]> {
	const users = await db.select().from(schema.users);
	const report: { user: string; alerted: boolean; briefed: boolean }[] = [];

	for (const user of users) {
		try {
			const settings = await getSettings(user.id);
			const timezone = settings?.timezone ?? 'Europe/Paris';
			const now = new Date();

			// Invoicing and URSSAF appear on their own, ahead of time, rather than
			// being remembered on the day they are due.
			await ensureRecurringAdmin(user.id, now, timezone);

			const result = await replan(user.id);
			const tasks = await listTasks(user.id);
			const titles = new Map(tasks.map((t) => [t.id, t.title]));

			const alert = await notifyIfWorse(user.id, result.output, titles);

			const today = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
			const dayStart = wallClockToInstant(today, '00:00', timezone);
			const blocks = (
				await getBlocksBetween(user.id, dayStart, new Date(dayStart.getTime() + 86_400_000))
			).filter((block) => block.pool === 'human');

			const hours =
				Math.round(
					blocks.reduce(
						(sum, block) => sum + (block.end.getTime() - block.start.getTime()) / 3_600_000,
						0
					) * 10
				) / 10;

			const brief = await sendDailyBrief(user.id, {
				today,
				blocksToday: blocks.length,
				hoursToday: hours,
				firstUp: blocks[0] ? (titles.get(blocks[0].taskId) ?? null) : null
			});

			report.push({
				user: user.email,
				alerted: Boolean(alert),
				briefed: Boolean(brief)
			});
		} catch (error) {
			// One user's broken calendar must not stop the job for everyone else,
			// nor bring the web process down with it.
			console.error(`[daily] ${user.email} failed:`, error);
		}
	}

	return report;
}

/** Milliseconds until the next RUN_AT_HOUR in the given timezone. */
function msUntilNextRun(timezone: string): number {
	const now = new Date();
	const hour = Number(formatInTimeZone(now, timezone, 'H'));
	const today = formatInTimeZone(now, timezone, 'yyyy-MM-dd');

	// Computed from wall-clock time rather than by adding 24h, so the clocks
	// changing does not drift the job by an hour twice a year.
	const target =
		hour < RUN_AT_HOUR
			? wallClockToInstant(today, `${String(RUN_AT_HOUR).padStart(2, '0')}:00`, timezone)
			: wallClockToInstant(
					formatInTimeZone(new Date(now.getTime() + 86_400_000), timezone, 'yyyy-MM-dd'),
					`${String(RUN_AT_HOUR).padStart(2, '0')}:00`,
					timezone
				);

	return Math.max(60_000, target.getTime() - now.getTime());
}

/**
 * Start the loop. Safe to call more than once — a second call is ignored,
 * which matters because hooks can be re-evaluated on hot reload.
 */
export function startDailyJob(timezone = 'Europe/Paris') {
	if (timer) return;

	const schedule = () => {
		const delay = msUntilNextRun(timezone);
		timer = setTimeout(async () => {
			if (!running) {
				running = true;
				try {
					const report = await runDailyJob();
					console.log(`[daily] ran for ${report.length} user(s)`, report);
				} catch (error) {
					console.error('[daily] failed:', error);
				} finally {
					running = false;
				}
			}
			schedule();
		}, delay);

		// Do not hold the process open just for this.
		timer.unref?.();
		console.log(`[daily] next run in ${Math.round(delay / 60_000)} minutes`);
	};

	schedule();
}
