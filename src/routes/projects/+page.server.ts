/**
 * Projects: the commercial side of the app.
 *
 * A project is where the fee, the agreed hours and the deadline live, so this
 * is also where the question "was that job worth taking?" gets answered.
 */

import { fail } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { requireUser } from '$lib/server/auth';
import { createProject, getSettings, updateProject } from '$lib/server/db/queries';
import { projectEconomics } from '$lib/server/freelance';
import { CURRENCIES, isSupportedCurrency, rateToEur } from '$lib/server/fx';
import { replan } from '$lib/server/planner';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = await requireUser(event);
	const [settings, economics, rows] = await Promise.all([
		getSettings(user.id),
		projectEconomics(user.id),
		db.select().from(schema.projects).where(eq(schema.projects.userId, user.id))
	]);

	const byId = new Map(rows.map((row) => [row.id, row]));

	return {
		currencies: CURRENCIES,
		timezone: settings?.timezone ?? 'Europe/Paris',
		// Everything money-related comes from projectEconomics, which is the one
		// place currency conversion happens. Only presentation fields are added.
		projects: economics.map((project) => {
			const row = byId.get(project.projectId);
			return {
				...project,
				status: row?.status ?? 'active',
				deadline: row?.deadline ?? null,
				color: row?.color ?? '#6366f1'
			};
		})
	};
};

export const actions: Actions = {
	create: async (event) => {
		const user = await requireUser(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'A project needs a name.' });

		await createProject(user.id, {
			name,
			clientName: String(form.get('clientName') ?? '').trim() || null
		});
		return { ok: true, message: `Created ${name}.` };
	},

	update: async (event) => {
		const user = await requireUser(event);
		const form = await event.request.formData();
		const projectId = String(form.get('projectId') ?? '');

		const currency = String(form.get('currency') ?? 'EUR');
		if (!isSupportedCurrency(currency)) {
			return fail(400, { message: `${currency} is not a currency I have rates for.` });
		}

		const number = (key: string): number | null => {
			const raw = String(form.get(key) ?? '').trim();
			if (!raw) return null;
			const value = Number(raw);
			return Number.isFinite(value) ? value : null;
		};

		const deadlineRaw = String(form.get('deadline') ?? '').trim();
		const deadline = deadlineRaw ? new Date(deadlineRaw) : null;

		const status = String(form.get('status') ?? 'active');
		const values: Partial<typeof schema.projects.$inferInsert> = {
			name: String(form.get('name') ?? '').trim() || undefined,
			clientName: String(form.get('clientName') ?? '').trim() || null,
			agreedFee: number('agreedFee'),
			agreedHours: number('agreedHours'),
			currency,
			deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
			color: String(form.get('color') ?? '') || undefined,
			status: ['active', 'waiting', 'done', 'archived'].includes(status)
				? (status as 'active' | 'waiting' | 'done' | 'archived')
				: undefined
		};

		// A manual rate always wins: the user may be pinning the rate their bank
		// actually gave them, which no reference table will match.
		const manualRate = number('fxRateToEur');
		if (manualRate !== null && manualRate > 0) {
			values.fxRateToEur = manualRate;
			values.fxRateAt = 'entered by hand';
		} else if (currency === 'EUR') {
			values.fxRateToEur = 1;
			values.fxRateAt = null;
		}

		await updateProject(user.id, projectId, values);

		try {
			await replan(user.id);
		} catch {
			/* project saved; the plan will catch up */
		}
		return { ok: true, message: 'Saved.' };
	},

	/**
	 * Fetch the ECB rate — today's, or the one from a date the user gives.
	 * Invoicing in JPY means the rate on the invoice date is the one that
	 * belongs in the books.
	 */
	refreshRate: async (event) => {
		const user = await requireUser(event);
		const form = await event.request.formData();
		const projectId = String(form.get('projectId') ?? '');
		const onDate = String(form.get('onDate') ?? '').trim() || null;

		const [project] = await db
			.select()
			.from(schema.projects)
			.where(and(eq(schema.projects.userId, user.id), eq(schema.projects.id, projectId)));

		if (!project) return fail(404, { message: 'No such project.' });
		if (project.currency === 'EUR') {
			return { ok: true, message: 'Already in euros — nothing to convert.' };
		}

		const rate = await rateToEur(project.currency, onDate);
		if (!rate) {
			return fail(502, {
				message: `Could not fetch a ${project.currency} rate. The fee is kept as it is.`
			});
		}

		await updateProject(user.id, projectId, {
			fxRateToEur: rate.rate,
			fxRateAt: rate.date
		});

		return {
			ok: true,
			message: `1 ${project.currency} = ${rate.rate} EUR (ECB, ${rate.date}).`
		};
	}
};
