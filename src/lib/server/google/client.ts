/**
 * Google OAuth client construction.
 *
 * Two things about this integration will break the app silently if forgotten,
 * so they are written down here rather than in a wiki nobody reads:
 *
 * 1. The OAuth consent screen must be published to "In Production" in the
 *    Google Cloud Console, even unverified. While it is in "Testing", refresh
 *    tokens are revoked after seven days and the daily cron starts failing
 *    with invalid_grant. Unverified production is fine below 100 users; the
 *    user clicks past the warning screen once.
 *
 * 2. Refresh tokens also expire after roughly six months of non-use. The daily
 *    cron keeps the token warm, so this only bites if the app is left idle.
 */

import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { env } from '$env/dynamic/private';
import { decrypt } from '../crypto';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
/**
 * Google Tasks is the phone's capture surface: anything typed into the Google
 * Tasks app is drained into the inbox here the next time the app runs. It is
 * what lets this stay a local app with no hosting.
 */
export const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';

export const AUTHORIZATION_PARAMS = {
	scope: ['openid', 'email', 'profile', CALENDAR_SCOPE, TASKS_SCOPE].join(' '),
	// Both are required to be handed a refresh token. Without `prompt: consent`
	// Google returns one only on the very first authorisation, and if that one
	// is ever lost there is no way to get another without revoking access.
	access_type: 'offline',
	prompt: 'consent'
} as const;

export function oauthClient(redirectUri?: string): OAuth2Client {
	if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
		throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.');
	}
	return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
}

/** An authenticated client for a user, from their stored (encrypted) token. */
export function clientForUser(encryptedRefreshToken: string): OAuth2Client {
	const client = oauthClient();
	client.setCredentials({ refresh_token: decrypt(encryptedRefreshToken) });
	return client;
}

export function calendarApi(auth: OAuth2Client) {
	return google.calendar({ version: 'v3', auth });
}
