/**
 * The freelance layer (§12, phase 4).
 *
 * Two things a French auto-entrepreneur needs that a generic planner does not
 * provide: what an hour of a given project is actually worth, and the recurring
 * admin that has legal deadlines attached.
 */

import { and, eq, gte, lt } from 'drizzle-orm';
import { db, schema } from './db';
import { addCivilDays, wallClockToInstant } from '$lib/scheduler/intervals';
import { formatInTimeZone } from 'date-fns-tz';
import type { ProjectRow } from './db/queries';
import { formatMoney, toEur } from './fx';

export type ProjectEconomics = {
	projectId: string;
	name: string;
	clientName: string | null;
	/** The fee as agreed, in the project's own currency. */
	agreedFee: number | null;
	currency: string;
	/** "500 000 JPY" — the fee written the way that currency is written. */
	feeFormatted: string | null;
	fxRateToEur: number | null;
	fxRateAt: string | null;
	/** The fee in euros. Null when a rate has not been set for a foreign fee. */
	feeEur: number | null;
	agreedHours: number | null;
	/** Days sold, when the job was quoted as a day rate. */
	agreedDays: number | null;
	/** The rate that was quoted: fee ÷ days sold. What you told the client. */
	quotedDayRateEur: number | null;
	/** Hours actually worked: confirmed blocks, using their recorded actuals. */
	actualHours: number;
	/** Hours still planned but not yet worked. */
	plannedHours: number;
	/**
	 * Fee ÷ actual hours, IN EUROS. Always euros: comparing 5 000 JPY/h against
	 * 60 EUR/h would be worse than showing nothing, and euros are the money the
	 * work is actually banked in.
	 */
	effectiveRateEur: number | null;
	/**
	 * The same number expressed per day, which is how a freelance rate is
	 * actually quoted and compared. Hours are the unit the scheduler thinks in;
	 * days are the unit the invoice thinks in.
	 */
	effectiveDayRateEur: number | null;
	/**
	 * The rate if every remaining planned hour is also spent. Lower than
	 * `effectiveRateEur` while work is outstanding — this is the honest one to
	 * quote yourself when deciding whether to take similar work again.
	 */
	projectedRateEur: number | null;
	projectedDayRateEur: number | null;
	/** Days actually worked, at this user's definition of a day. */
	actualDays: number;
	/** Actual hours over agreed hours, when both are known. */
	overrunHours: number | null;
};

export async function projectEconomics(
	userId: string,
	hoursPerDay = 7
): Promise<ProjectEconomics[]> {
	const projects = await db
		.select()
		.from(schema.projects)
		.where(eq(schema.projects.userId, userId));

	const blocks = await db
		.select({
			projectId: schema.tasks.projectId,
			start: schema.blocks.start,
			end: schema.blocks.end,
			status: schema.blocks.status,
			actualMinutes: schema.blocks.actualMinutes
		})
		.from(schema.blocks)
		.innerJoin(schema.tasks, eq(schema.tasks.id, schema.blocks.taskId))
		.where(eq(schema.blocks.userId, userId));

	const actual = new Map<string, number>();
	const planned = new Map<string, number>();

	for (const row of blocks) {
		if (!row.projectId) continue;
		const plannedHours = (row.end.getTime() - row.start.getTime()) / 3_600_000;

		if (row.status === 'confirmed') {
			const hours = row.actualMinutes !== null ? row.actualMinutes / 60 : plannedHours;
			actual.set(row.projectId, (actual.get(row.projectId) ?? 0) + hours);
		} else if (row.status === 'planned') {
			planned.set(row.projectId, (planned.get(row.projectId) ?? 0) + plannedHours);
		}
		// 'skipped' counts for neither: it did not happen and is not planned.
	}

	const round = (n: number) => Math.round(n * 100) / 100;

	return projects
		.map((project: ProjectRow): ProjectEconomics => {
			const actualHours = round(actual.get(project.id) ?? 0);
			const plannedHours = round(planned.get(project.id) ?? 0);
			const fee = project.agreedFee;

			// Convert ONCE, here, and let every screen read the result. Doing this
			// per page is how the settings table came to show a JPY fee with a
			// euro sign on it.
			const feeEur = toEur(fee, project.fxRateToEur, project.currency);

			// One definition of a day, taken from settings, used for the estimate
			// parser and for this. Guard against a nonsensical setting rather than
			// dividing by zero.
			const perDay = hoursPerDay > 0 ? hoursPerDay : 7;
			const asDayRate = (hourly: number | null) =>
				hourly === null ? null : round(hourly * perDay);

			const effectiveRateEur =
				feeEur !== null && actualHours > 0 ? round(feeEur / actualHours) : null;
			const projectedRateEur =
				feeEur !== null && actualHours + plannedHours > 0
					? round(feeEur / (actualHours + plannedHours))
					: null;

			return {
				projectId: project.id,
				name: project.name,
				clientName: project.clientName,
				agreedFee: fee,
				currency: project.currency,
				feeFormatted: fee !== null ? formatMoney(fee, project.currency) : null,
				fxRateToEur: project.fxRateToEur,
				fxRateAt: project.fxRateAt,
				feeEur,
				agreedHours: project.agreedHours,
				agreedDays: project.agreedDays,
				// What was quoted, as opposed to what it is turning out to be.
				quotedDayRateEur:
					feeEur !== null && project.agreedDays && project.agreedDays > 0
						? round(feeEur / project.agreedDays)
						: null,
				actualHours,
				plannedHours,
				actualDays: round(actualHours / perDay),
				// Dividing by zero hours would report an infinite rate on a project
				// nobody has worked yet, which is worse than saying nothing.
				effectiveRateEur,
				effectiveDayRateEur: asDayRate(effectiveRateEur),
				projectedRateEur,
				projectedDayRateEur: asDayRate(projectedRateEur),
				overrunHours:
					project.agreedHours !== null ? round(actualHours - project.agreedHours) : null
			};
		})
		.sort((a, b) => (a.effectiveRateEur ?? Infinity) - (b.effectiveRateEur ?? Infinity));
}

/**
 * Recurring admin an auto-entrepreneur cannot skip.
 *
 * Deadlines are the real ones: URSSAF declarations fall on the last day of the
 * month following each quarter, and invoicing is worth doing on the last
 * working day of the month while the month is fresh.
 *
 * These are generated as ordinary tasks, so they compete for capacity like
 * everything else — which is the point. Admin that lives outside the plan is
 * admin that happens at 23:00 on the deadline.
 */
export type RecurringAdmin = {
	key: string;
	title: string;
	deadline: Date;
	estimateHours: number;
};

export function upcomingAdmin(now: Date, timezone: string, monthsAhead = 3): RecurringAdmin[] {
	const items: RecurringAdmin[] = [];
	const today = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
	const [year, month] = today.split('-').map(Number) as [number, number, number];

	for (let offset = 0; offset < monthsAhead; offset++) {
		const m = ((month - 1 + offset) % 12) + 1;
		const y = year + Math.floor((month - 1 + offset) / 12);

		// Invoicing: the last day of each month.
		const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
		const invoiceCivil = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
		if (invoiceCivil >= today) {
			items.push({
				key: `invoice-${y}-${String(m).padStart(2, '0')}`,
				title: `Invoicing — ${formatInTimeZone(wallClockToInstant(invoiceCivil, '12:00', timezone), timezone, 'MMMM yyyy')}`,
				deadline: wallClockToInstant(invoiceCivil, '18:00', timezone),
				estimateHours: 1
			});
		}

		// URSSAF: quarterly, due the last day of the month AFTER the quarter ends.
		// Quarters end in March, June, September and December, so declarations
		// fall due at the end of April, July, October and January.
		if ([1, 4, 7, 10].includes(m)) {
			const declarationCivil = `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
			if (declarationCivil >= today) {
				items.push({
					key: `urssaf-${y}-Q${Math.floor((m - 1) / 3) || 4}`,
					title: `URSSAF declaration — due ${formatInTimeZone(wallClockToInstant(declarationCivil, '12:00', timezone), timezone, 'd MMMM')}`,
					deadline: wallClockToInstant(declarationCivil, '18:00', timezone),
					estimateHours: 1
				});
			}
		}
	}

	return items.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
}

/**
 * Create any recurring admin task that does not exist yet.
 *
 * Keyed on the title so that running it repeatedly is harmless — the same
 * month's invoicing is never created twice.
 */
export async function ensureRecurringAdmin(
	userId: string,
	now: Date,
	timezone: string
): Promise<number> {
	const wanted = upcomingAdmin(now, timezone);
	if (wanted.length === 0) return 0;

	const horizonStart = wallClockToInstant(
		addCivilDays(formatInTimeZone(now, timezone, 'yyyy-MM-dd'), -1),
		'00:00',
		timezone
	);

	const existing = await db
		.select({ title: schema.tasks.title })
		.from(schema.tasks)
		.where(and(eq(schema.tasks.userId, userId), gte(schema.tasks.createdAt, horizonStart)));

	// Match on title rather than a key column: these are ordinary tasks, and the
	// user is free to rename or delete them without the app recreating them
	// under a different name every night.
	const allTitles = new Set(
		(await db.select({ title: schema.tasks.title }).from(schema.tasks).where(eq(schema.tasks.userId, userId))).map(
			(t) => t.title
		)
	);
	void existing;

	let created = 0;
	for (const item of wanted) {
		if (allTitles.has(item.title)) continue;
		await db.insert(schema.tasks).values({
			userId,
			title: item.title,
			kind: 'admin',
			estimateHours: item.estimateHours,
			deadline: item.deadline,
			minBlockMinutes: 30,
			status: 'active',
			notes: 'Recurring admin, generated automatically.'
		});
		created++;
	}
	return created;
}

/** Blocks worked in a calendar month, for an invoice or a sanity check. */
export async function hoursInMonth(
	userId: string,
	civilMonth: string,
	timezone: string
): Promise<number> {
	const start = wallClockToInstant(`${civilMonth}-01`, '00:00', timezone);
	const [y, m] = civilMonth.split('-').map(Number) as [number, number];
	const end = wallClockToInstant(
		`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`,
		'00:00',
		timezone
	);

	const rows = await db
		.select()
		.from(schema.blocks)
		.where(
			and(
				eq(schema.blocks.userId, userId),
				eq(schema.blocks.status, 'confirmed'),
				gte(schema.blocks.start, start),
				lt(schema.blocks.start, end)
			)
		);

	const hours = rows.reduce((sum, row) => {
		const planned = (row.end.getTime() - row.start.getTime()) / 3_600_000;
		return sum + (row.actualMinutes !== null ? row.actualMinutes / 60 : planned);
	}, 0);

	return Math.round(hours * 100) / 100;
}
