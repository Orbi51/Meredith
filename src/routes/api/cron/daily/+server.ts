/**
 * The daily job (§10): replan, then say something only if it is worth saying.
 *
 * Called by Railway's scheduler. Protected by a shared secret rather than a
 * session, because there is no user present.
 *
 * It also keeps the Google refresh token alive: tokens expire after about six
 * months of disuse, and a daily call means that never happens.
 */

import { json } from '@sveltejs/kit';
import { formatInTimeZone } from 'date-fns-tz';
import { env } from '$env/dynamic/private';
import { db, schema } from '$lib/server/db';
import { getBlocksBetween, getSettings, listTasks } from '$lib/server/db/queries';
import { replan } from '$lib/server/planner';
import { notifyIfWorse, sendDailyBrief } from '$lib/server/notify';
import { wallClockToInstant } from '$lib/scheduler/intervals';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const secret = event.request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
	if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
		return json({ error: 'unauthorised' }, { status: 401 });
	}

	const users = await db.select().from(schema.users);
	const report: unknown[] = [];

	for (const user of users) {
		const settings = await getSettings(user.id);
		const timezone = settings?.timezone ?? 'Europe/Paris';
		const now = new Date();

		const result = await replan(user.id);
		const tasks = await listTasks(user.id);
		const titles = new Map(tasks.map((t) => [t.id, t.title]));

		const alert = await notifyIfWorse(user.id, result.output, titles);

		const today = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
		const dayStart = wallClockToInstant(today, '00:00', timezone);
		const blocks = (await getBlocksBetween(user.id, dayStart, new Date(dayStart.getTime() + 86_400_000)))
			.filter((b) => b.pool === 'human');

		const hours =
			Math.round(
				blocks.reduce((sum, b) => sum + (b.end.getTime() - b.start.getTime()) / 3_600_000, 0) * 10
			) / 10;

		const brief = await sendDailyBrief(user.id, {
			today,
			blocksToday: blocks.length,
			hoursToday: hours,
			firstUp: blocks[0] ? (titles.get(blocks[0].taskId) ?? null) : null
		});

		report.push({
			user: user.email,
			blocks: result.blocksWritten,
			alerted: Boolean(alert),
			briefed: Boolean(brief),
			warnings: result.warnings
		});
	}

	return json({ ran: new Date().toISOString(), report });
};
