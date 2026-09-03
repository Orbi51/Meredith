/**
 * Reading capacity out of Google Calendar.
 *
 * Everything here answers one question: which hours in the horizon are already
 * spoken for? The app's own calendar is excluded — its events are the output of
 * the scheduler, and feeding them back in would leave no capacity at all.
 */

import type { OAuth2Client } from 'google-auth-library';
import type { calendar_v3 } from 'googleapis';
import { calendarApi } from './client';
import { addCivilDays, wallClockToInstant } from '$lib/scheduler/intervals';
import type { Interval } from '$lib/scheduler/types';

export type BusyReadOptions = {
	timeMin: Date;
	timeMax: Date;
	/** The app's own calendar. Its events are never treated as busy. */
	excludeCalendarId: string | null;
	timezone: string;
	/** Working-hours window used to bound all-day events. */
	allDayWindow?: { start: string; end: string };
};

export async function listCalendars(auth: OAuth2Client) {
	const response = await calendarApi(auth).calendarList.list({ maxResults: 250 });
	return response.data.items ?? [];
}

/**
 * Busy intervals across every calendar except the app's own.
 *
 * `singleEvents: true` expands recurring events into instances. Keep this flag
 * identical on every call for a calendar: switching it between a full read and
 * an incremental one invalidates the sync token and breaks sync.
 */
export async function readBusyIntervals(
	auth: OAuth2Client,
	options: BusyReadOptions
): Promise<Interval[]> {
	const api = calendarApi(auth);
	const calendars = await listCalendars(auth);
	const busy: Interval[] = [];

	for (const calendar of calendars) {
		if (!calendar.id) continue;
		if (calendar.id === options.excludeCalendarId) continue;
		// A calendar the user has unticked in the Google UI is one they do not
		// consider part of their day.
		if (calendar.selected === false) continue;

		let pageToken: string | undefined;
		do {
			const response: { data: calendar_v3.Schema$Events } = await api.events.list({
				calendarId: calendar.id,
				timeMin: options.timeMin.toISOString(),
				timeMax: options.timeMax.toISOString(),
				singleEvents: true,
				orderBy: 'startTime',
				maxResults: 2500,
				pageToken
			});

			for (const event of response.data.items ?? []) {
				const interval = eventToBusyInterval(event, options);
				if (interval) busy.push(interval);
			}

			pageToken = response.data.nextPageToken ?? undefined;
		} while (pageToken);
	}

	return busy;
}

/** Default hours an all-day event is assumed to consume, in the user's timezone. */
const DEFAULT_ALL_DAY_WINDOW = { start: '09:00', end: '18:00' };

export function eventToBusyInterval(
	event: calendar_v3.Schema$Event,
	options: Pick<BusyReadOptions, 'timezone' | 'allDayWindow'>
): Interval | null {
	if (event.status === 'cancelled') return null;
	// "Free" in Google's UI. The user is telling us this is not really busy.
	if (event.transparency === 'transparent') return null;
	// An invitation the user declined is not busy either.
	const self = event.attendees?.find((a) => a.self);
	if (self?.responseStatus === 'declined') return null;

	if (event.start?.dateTime && event.end?.dateTime) {
		return { start: new Date(event.start.dateTime), end: new Date(event.end.dateTime) };
	}

	// All-day event: block that day's working window rather than 24 hours, so a
	// public holiday does not silently swallow the evening too.
	if (event.start?.date && event.end?.date) {
		const window = options.allDayWindow ?? DEFAULT_ALL_DAY_WINDOW;
		const busy: Interval[] = [];
		let civil = event.start.date;
		// Google's all-day `end.date` is exclusive.
		while (civil < event.end.date) {
			busy.push({
				start: wallClockToInstant(civil, window.start, options.timezone),
				end: wallClockToInstant(civil, window.end, options.timezone)
			});
			civil = addCivilDays(civil, 1);
		}
		if (busy.length === 0) return null;
		// Collapse a multi-day all-day event into one span; the scheduler merges
		// overlapping busy intervals anyway, and the evenings in between are not
		// working hours.
		return { start: busy[0]!.start, end: busy[busy.length - 1]!.end };
	}

	return null;
}

export type SyncResult = {
	/** True when something changed and a replan is warranted. */
	changed: boolean;
	nextSyncToken: string | null;
	/** True when Google invalidated the token and a full re-read is required. */
	requiresFullResync: boolean;
};

/**
 * Incremental change detection for one calendar.
 *
 * Note what this does and does not do: a sync token cannot be combined with
 * timeMin/timeMax, so it tells us *that* something moved, not what the new
 * busy set is. The app uses it as a cheap trigger and then re-reads the
 * horizon with `readBusyIntervals`. For a single user that is a handful of
 * requests a day against a million-request quota.
 */
export async function detectChanges(
	auth: OAuth2Client,
	calendarId: string,
	syncToken: string | null
): Promise<SyncResult> {
	const api = calendarApi(auth);

	try {
		const response = await api.events.list({
			calendarId,
			singleEvents: true,
			maxResults: 2500,
			...(syncToken ? { syncToken } : { timeMin: new Date().toISOString() })
		});

		return {
			changed: (response.data.items ?? []).length > 0,
			nextSyncToken: response.data.nextSyncToken ?? null,
			requiresFullResync: false
		};
	} catch (error) {
		// 410 Gone: the token is too old. Discard it and start again.
		if (isGone(error)) {
			return { changed: true, nextSyncToken: null, requiresFullResync: true };
		}
		throw error;
	}
}

function isGone(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code: unknown }).code === 410
	);
}
