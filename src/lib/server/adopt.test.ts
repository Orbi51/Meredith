import { describe, expect, it } from 'vitest';
import { looksLikeWork } from './adopt';
import type { CalendarAppointment } from './google/read';

const event = (summary: string, allDay = false): CalendarAppointment => ({
	start: new Date('2026-09-07T07:00:00Z'),
	end: new Date('2026-09-07T09:00:00Z'),
	summary,
	allDay,
	eventId: 'e1',
	calendarId: 'c1',
	primary: true
});

describe('looksLikeWork', () => {
	it('adopts the user’s "Project - task" convention', () => {
		// These are real event titles from the user's calendar.
		expect(looksLikeWork(event('GeGeGe - pushing image'))).toBe(true);
		expect(looksLikeWork(event('N3dge - adding props / lighting'))).toBe(true);
		expect(looksLikeWork(event('DSA - Red Sand'))).toBe(true);
		expect(looksLikeWork(event('N3dge - Textures and materials'))).toBe(true);
	});

	it('leaves appointments alone', () => {
		// An appointment is capacity being consumed, not a task. Adopting one
		// would put "see the doctor" on a to-do list and, worse, count its hours
		// as work delivered.
		expect(looksLikeWork(event('Rendez-vous chez Dr Renaud BERQUET'))).toBe(false);
		expect(looksLikeWork(event('Morning Planning'))).toBe(false);
		expect(looksLikeWork(event('Lunch with Marie'))).toBe(false);
	});

	it('ignores hyphens that are part of a word or a date', () => {
		expect(looksLikeWork(event('e-mail catch-up'))).toBe(false);
		expect(looksLikeWork(event('sprint 2026-09-07'))).toBe(false);
	});

	it('never adopts an all-day event', () => {
		// An all-day entry marks a day — a holiday, a deadline, a trip. It is not
		// a two-hour block of work, and treating it as one would invent capacity.
		expect(looksLikeWork(event('DSA - Red Sand', true))).toBe(false);
	});
});
