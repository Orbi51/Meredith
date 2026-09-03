import { describe, expect, it } from 'vitest';
import { ForbiddenTaskListError, INBOX_LIST_TITLE, markCaptureTaken } from './tasks';
import type { OAuth2Client } from 'google-auth-library';

const capture = (listId: string) => ({
	id: 't1',
	listId,
	text: 'anything',
	notes: null,
	capturedAt: new Date()
});

describe('the app only ever touches its own task list', () => {
	// The same guarantee as the calendar. Your "Work" and "My Tasks" lists are
	// yours: swallowing a personal item into the plan and marking it completed
	// is not a mistake you could undo by hand.
	const auth = {} as OAuth2Client;

	it('refuses a list that is not ours', async () => {
		await expect(markCaptureTaken(auth, capture('someone-elses-list'), null, 'our-list')).rejects.toThrow(
			ForbiddenTaskListError
		);
	});

	it('refuses when we do not know which list is ours', async () => {
		// Null own-list means "not set up yet" — never "anything goes".
		await expect(markCaptureTaken(auth, capture('any-list'), null, null)).rejects.toThrow(
			ForbiddenTaskListError
		);
	});

	it('names the list it is protecting', () => {
		expect(INBOX_LIST_TITLE).toBe('Meredith inbox');
	});
});
