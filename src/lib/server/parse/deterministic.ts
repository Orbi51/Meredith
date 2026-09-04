/**
 * Deterministic extraction of estimates, deadlines and kind from captured text.
 *
 * Why this exists rather than being left to the model: dates and durations are
 * regex work with exactly one right answer, and every language model tested —
 * local 7B and hosted alike — gets them wrong often enough to matter. A wrong
 * deadline is worse than no deadline, because the whole app is built on
 * deadlines being true.
 *
 * The model's remaining job is the part code is bad at: tidying the title and
 * spotting a project name. See `index.ts`.
 *
 * Everything here is pure — `now` is passed in — so it is all testable.
 */

import { wallClockToInstant, addCivilDays, civilDayOfWeek } from '$lib/scheduler/intervals';
import { formatInTimeZone } from 'date-fns-tz';
import type { TaskKind } from '$lib/scheduler/types';

export type Extraction<T> = {
	value: T;
	/** The exact text that produced it, so it can be stripped from the title. */
	matched: string;
} | null;

/** When only a day is given, work is due by the end of the working day. */
const DEFAULT_DEADLINE_TIME = '18:00';
/**
 * A "day" of work, for estimates written as "2 days" or "2j".
 *
 * The default only applies when no setting is passed. The real value lives in
 * settings.hoursPerDay and is threaded in, because the SAME number has to turn
 * a day rate into an hourly one — two definitions of a day would drift.
 */
export const DEFAULT_HOURS_PER_WORKING_DAY = 7;

const WEEKDAYS: Record<string, number> = {
	sunday: 0, dimanche: 0,
	monday: 1, lundi: 1,
	tuesday: 2, mardi: 2,
	wednesday: 3, mercredi: 3,
	thursday: 4, jeudi: 4,
	friday: 5, vendredi: 5,
	saturday: 6, samedi: 6
};

const MONTHS: Record<string, number> = {
	jan: 1, janvier: 1, january: 1,
	feb: 2, fev: 2, février: 2, fevrier: 2, february: 2,
	mar: 3, mars: 3, march: 3,
	apr: 4, avr: 4, avril: 4, april: 4,
	may: 5, mai: 5,
	jun: 6, juin: 6, june: 6,
	jul: 7, juil: 7, juillet: 7, july: 7,
	aug: 8, aout: 8, août: 8, august: 8,
	sep: 9, sept: 9, septembre: 9, september: 9,
	oct: 10, octobre: 10, october: 10,
	nov: 11, novembre: 11, november: 11,
	dec: 12, déc: 12, decembre: 12, décembre: 12, december: 12
};

/**
 * Duration in hours. Understands "6h", "~6h", "1h30", "90min", "half a day",
 * "2 jours". Deliberately conservative: a bare number is NOT an estimate,
 * because "rev2" and "shot 3" are not durations.
 */
export function extractEstimate(
	text: string,
	hoursPerDay: number = DEFAULT_HOURS_PER_WORKING_DAY
): Extraction<number> {
	// "1h30" / "1 h 30" — hours and minutes together, checked first so the
	// simpler hour pattern cannot swallow the "1h" and leave "30" behind.
	const hm = text.match(/(?<![\w.])~?\s*(\d{1,2})\s*h\s*(\d{1,2})(?![\w.])/i);
	if (hm) {
		return { value: Number(hm[1]) + Number(hm[2]) / 60, matched: hm[0] };
	}

	// "6h", "6 h", "~6h", "6hrs", "6 hours", "6 heures", "1.5h"
	const hours = text.match(/(?<![\w.])~?\s*(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hours?|heures?)(?![\w])/i);
	if (hours) {
		return { value: Number((hours[1] as string).replace(',', '.')), matched: hours[0] };
	}

	// "30min", "45 minutes"
	const minutes = text.match(/(?<![\w.])~?\s*(\d{1,3})\s*(?:m|min|mins|minutes?)(?![\w])/i);
	if (minutes) {
		return { value: Number(minutes[1]) / 60, matched: minutes[0] };
	}

	// "2 days", "3 jours", "1 journée", "2j" — the French shorthand is common
	// enough in a freelancer's own notes to be worth supporting.
	const days = text.match(/(?<![\w.])~?\s*(\d+(?:[.,]\d+)?)\s*(?:d|j|days?|jours?|journées?|journees?)(?![\w])/i);
	if (days) {
		const value = Number((days[1] as string).replace(',', '.')) * hoursPerDay;
		return { value, matched: days[0] };
	}

	const half = text.match(/\b(?:half a day|demi[- ]?journée|demi[- ]?journee)\b/i);
	if (half) return { value: hoursPerDay / 2, matched: half[0] };

	return null;
}

/**
 * A deadline, resolved against `now` in the user's timezone.
 *
 * Returns null when the text names no date. Never guesses: a task with no
 * deadline is a perfectly good task, and inventing one would make the
 * overcommitment report lie.
 */
export function extractDeadline(text: string, now: Date, timezone: string): Extraction<Date> {
	const todayCivil = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
	const at = (civil: string, matched: string): Extraction<Date> => ({
		value: wallClockToInstant(civil, DEFAULT_DEADLINE_TIME, timezone),
		matched
	});

	// ISO date: 2026-09-12
	const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
	if (iso) return at(iso[0], iso[0]);

	// 12/09 or 12/09/2026 — day first, as everywhere outside the United States.
	const slashed = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
	if (slashed) {
		const day = Number(slashed[1]);
		const month = Number(slashed[2]);
		const year = slashed[3]
			? Number(slashed[3].length === 2 ? `20${slashed[3]}` : slashed[3])
			: inferYear(todayCivil, month, day);
		return at(civil(year, month, day), slashed[0]);
	}

	// "12 septembre", "sept 12"
	const dayMonth = text.match(
		new RegExp(`\\b(\\d{1,2})\\s+(${Object.keys(MONTHS).join('|')})\\b`, 'i')
	);
	if (dayMonth) {
		const day = Number(dayMonth[1]);
		const month = MONTHS[(dayMonth[2] as string).toLowerCase()] as number;
		return at(civil(inferYear(todayCivil, month, day), month, day), dayMonth[0]);
	}

	const monthDay = text.match(
		new RegExp(`\\b(${Object.keys(MONTHS).join('|')})\\s+(\\d{1,2})\\b`, 'i')
	);
	if (monthDay) {
		const month = MONTHS[(monthDay[1] as string).toLowerCase()] as number;
		const day = Number(monthDay[2]);
		return at(civil(inferYear(todayCivil, month, day), month, day), monthDay[0]);
	}

	const today = text.match(/\b(?:today|aujourd'?hui)\b/i);
	if (today) return at(todayCivil, today[0]);

	const tomorrow = text.match(/\b(?:tomorrow|demain)\b/i);
	if (tomorrow) return at(addCivilDays(todayCivil, 1), tomorrow[0]);

	// "in 3 days" / "dans 3 jours"
	const inDays = text.match(/\b(?:in|dans)\s+(\d{1,3})\s*(?:days?|jours?)\b/i);
	if (inDays) return at(addCivilDays(todayCivil, Number(inDays[1])), inDays[0]);

	// "next friday" / "vendredi prochain" / "friday"
	const weekdayNames = Object.keys(WEEKDAYS).join('|');
	const weekday = text.match(
		new RegExp(`\\b(next\\s+|prochain\\s+)?(${weekdayNames})(\\s+prochain)?\\b`, 'i')
	);
	if (weekday) {
		const target = WEEKDAYS[(weekday[2] as string).toLowerCase()] as number;
		const explicitlyNext = Boolean(weekday[1] || weekday[3]);
		return at(nextWeekday(todayCivil, target, explicitlyNext), weekday[0]);
	}

	return null;
}

/**
 * The next occurrence of a weekday. "friday" said on a Thursday means
 * tomorrow, not a week tomorrow — that is what people mean, and getting it
 * wrong by a week is exactly the failure that makes a planner untrustworthy.
 *
 * Said ON the day itself, it means today; "next friday" on a Friday means the
 * one after.
 */
export function nextWeekday(todayCivil: string, target: number, explicitlyNext: boolean): string {
	const todayDow = civilDayOfWeek(todayCivil);

	if (!explicitlyNext) {
		// Bare "friday": the next one to come round, today included.
		return addCivilDays(todayCivil, (target - todayDow + 7) % 7);
	}

	// "next friday" / "vendredi prochain": the Friday of NEXT week, not the one
	// that happens to be tomorrow. Said on a Thursday, "vendredi prochain" is
	// eight days away — anyone meaning tomorrow says "demain".
	//
	// Weeks run Monday to Sunday, so this is: find next Monday, then step to
	// the target day within that week.
	const daysToNextMonday = ((1 - todayDow + 7) % 7) || 7;
	const offsetWithinWeek = (target - 1 + 7) % 7; // Monday = 0 ... Sunday = 6
	return addCivilDays(todayCivil, daysToNextMonday + offsetWithinWeek);
}

/** Keyword classification. Returns null when nothing in the text decides it. */
export function detectKind(text: string): Extraction<TaskKind> {
	const machine = text.match(
		/\b(?:render|rendu|rendus|bake|baking|simulation|sim|cache|caching|export|transcode)\b/i
	);
	if (machine) return { value: 'machine', matched: '' };

	const admin = text.match(
		/\b(?:invoice|invoicing|facture|facturation|urssaf|tax|impôts|impots|email|mail|admin|devis|quote|call|réunion|reunion|meeting|planning)\b/i
	);
	if (admin) return { value: 'admin', matched: '' };

	return null;
}

/** Remove the fragments we consumed, leaving something that reads as a title. */
export function stripMatches(text: string, matches: string[]): string {
	let result = text;
	for (const match of matches) {
		if (!match) continue;
		result = result.replace(match, ' ');
	}
	return result.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}

function civil(year: number, month: number, day: number): string {
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * A date with no year means the next time that date occurs. "12 January" said
 * in December is next year, not eleven months ago.
 */
function inferYear(todayCivil: string, month: number, day: number): number {
	const [y] = todayCivil.split('-').map(Number) as [number, number, number];
	const candidate = civil(y, month, day);
	return candidate >= todayCivil ? y : y + 1;
}
