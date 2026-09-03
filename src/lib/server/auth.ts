/**
 * Resolving the signed-in user to a database row.
 *
 * Every server load and action that touches user data goes through
 * `requireUser`, so an unauthenticated request cannot reach a query.
 */

import { redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getUserByEmail } from './db/queries';
import type { UserRow } from './db/queries';

export async function currentUser(event: RequestEvent): Promise<UserRow | null> {
	const session = await event.locals.auth();
	const email = session?.user?.email;
	if (!email) return null;
	return getUserByEmail(email);
}

/** Redirects to the home page (which explains how to sign in) when signed out. */
export async function requireUser(event: RequestEvent): Promise<UserRow> {
	const user = await currentUser(event);
	if (!user) redirect(303, '/');
	return user;
}
