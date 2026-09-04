/**
 * Settings: working hours, timezone, horizon, and the calibration multipliers
 * the scheduler is currently applying (§6 requires these to be visible, with
 * their sample counts).
 */

import { requireUser } from '$lib/server/auth';
import {
	getCalibrationSamples,
	getSettings,
	getWorkingHours,
	replaceWorkingHours,
	updateSettings
} from '$lib/server/db/queries';
import { ALL_KINDS, buildCalibrationTable } from '$lib/scheduler/calibration';
import { replan } from '$lib/server/planner';
import { ensureRecurringAdmin, upcomingAdmin } from '$lib/server/freelance';
import { pushConfigured } from '$lib/server/notify';
import type { TaskKind, WorkingHours } from '$lib/scheduler/types';
import type { Actions, PageServerLoad } from './$types';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const load: PageServerLoad = async (event) => {
	const user = await requireUser(event);
	const [settings, workingHours, samples] = await Promise.all([
		getSettings(user.id),
		getWorkingHours(user.id),
		getCalibrationSamples(user.id)
	]);

	const table = buildCalibrationTable(samples);
	const byDay = new Map(workingHours.map((h) => [h.dayOfWeek, h]));
	const timezone = settings?.timezone ?? 'Europe/Paris';

	return {
		settings: {
			timezone: settings?.timezone ?? 'Europe/Paris',
			horizonDays: settings?.horizonDays ?? 21,
			hoursPerDay: settings?.hoursPerDay ?? 7,
			targetCalendarId: settings?.targetCalendarId ?? null,
			calibrationEnabled: settings?.calibrationEnabled ?? true
		},
		// Monday first — the week the user actually works.
		days: [1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => ({
			dayOfWeek,
			name: DAY_NAMES[dayOfWeek] as string,
			intervals: byDay.get(dayOfWeek)?.intervals ?? []
		})),
		pushAvailable: pushConfigured(),
		upcomingAdmin: upcomingAdmin(new Date(), timezone).map((item) => ({
			title: item.title,
			deadline: item.deadline,
			estimateHours: item.estimateHours
		})),
		calibration: ALL_KINDS.map((kind: TaskKind) => ({
			kind,
			multiplier: table.byKind[kind].multiplier,
			sampleCount: table.byKind[kind].sampleCount,
			medianActualHours: table.medianActualHoursByKind[kind]
		}))
	};
};

export const actions: Actions = {
	saveHours: async (event) => {
		const user = await requireUser(event);
		const form = await event.request.formData();

		const hours: WorkingHours[] = [];
		for (const dayOfWeek of [0, 1, 2, 3, 4, 5, 6]) {
			const intervals: WorkingHours['intervals'] = [];
			// Two intervals per day is enough for a working pattern with a lunch
			// break; more than that belongs in the calendar as appointments.
			for (const slot of [0, 1]) {
				const start = String(form.get(`d${dayOfWeek}-s${slot}-start`) ?? '').trim();
				const end = String(form.get(`d${dayOfWeek}-s${slot}-end`) ?? '').trim();
				if (!start || !end || start >= end) continue;

				const preferred = String(form.get(`d${dayOfWeek}-s${slot}-kind`) ?? '');
				intervals.push({
					start,
					end,
					preferredKind:
						preferred === 'creative' || preferred === 'admin' ? (preferred as TaskKind) : null
				});
			}
			if (intervals.length > 0) hours.push({ dayOfWeek, intervals });
		}

		await replaceWorkingHours(user.id, hours);

		const horizon = Number(form.get('horizonDays') ?? 21);
		const perDay = Number(form.get('hoursPerDay') ?? 7);
		await updateSettings(user.id, {
			timezone: String(form.get('timezone') ?? 'Europe/Paris'),
			horizonDays: Number.isFinite(horizon) ? Math.min(90, Math.max(1, horizon)) : 21,
			// Clamped: a zero would divide by zero in every rate on the projects
			// page, and a 24-hour day is not a day.
			hoursPerDay: Number.isFinite(perDay) ? Math.min(16, Math.max(1, perDay)) : 7
		});

		try {
			await replan(user.id);
		} catch {
			/* saved; the next replan will apply it */
		}

		return { ok: true, message: 'Working hours saved and the plan rebuilt.' };
	},

	/** Create the invoicing and URSSAF tasks that do not exist yet. */
	generateAdmin: async (event) => {
		const user = await requireUser(event);
		const settings = await getSettings(user.id);
		const created = await ensureRecurringAdmin(
			user.id,
			new Date(),
			settings?.timezone ?? 'Europe/Paris'
		);

		try {
			await replan(user.id);
		} catch {
			/* the tasks exist; the plan will catch up */
		}

		return {
			ok: true,
			message:
				created === 0
					? 'Nothing to add — the upcoming admin is already on the list.'
					: `${created} recurring admin task${created === 1 ? '' : 's'} added.`
		};
	}
};
