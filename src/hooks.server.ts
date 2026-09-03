/**
 * Auth.js with the Google provider.
 *
 * The only thing this app wants from sign-in is a long-lived refresh token
 * with calendar scope. Google hands one over exactly once — on the first
 * consent — which is why `access_type: offline` and `prompt: consent` are
 * both set (see `$lib/server/google/client`). We store it encrypted the
 * moment it arrives; if we drop it, the user has to revoke access in their
 * Google account settings before they can be issued another.
 */

import { SvelteKitAuth } from '@auth/sveltekit';
import Google from '@auth/sveltekit/providers/google';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { AUTHORIZATION_PARAMS } from '$lib/server/google/client';
import { encrypt } from '$lib/server/crypto';
import { db, schema } from '$lib/server/db';
import { startDailyJob } from '$lib/server/daily-job';

// The plan picked an always-on Node process precisely so cron works without a
// second service. Off by default in development, where a replan every morning
// against the real calendar is not wanted.
if (env.ENABLE_DAILY_JOB === 'true') {
	startDailyJob(env.DAILY_JOB_TIMEZONE ?? 'Europe/Paris');
}

export const { handle, signIn, signOut } = SvelteKitAuth({
	trustHost: true,
	secret: env.AUTH_SECRET,
	providers: [
		Google({
			clientId: env.GOOGLE_CLIENT_ID,
			clientSecret: env.GOOGLE_CLIENT_SECRET,
			authorization: { params: AUTHORIZATION_PARAMS }
		})
	],
	callbacks: {
		async signIn({ user, account }) {
			if (!user.email || account?.provider !== 'google') return false;

			const [existing] = await db
				.select()
				.from(schema.users)
				.where(eq(schema.users.email, user.email));

			// Google only returns a refresh token on a fresh consent. On later
			// sign-ins it is absent — keep the one we already have rather than
			// overwriting it with null.
			const refreshToken = account.refresh_token ? encrypt(account.refresh_token) : undefined;

			if (existing) {
				await db
					.update(schema.users)
					.set({
						name: user.name ?? existing.name,
						googleAccountId: account.providerAccountId,
						...(refreshToken ? { googleRefreshToken: refreshToken } : {})
					})
					.where(eq(schema.users.id, existing.id));
				return true;
			}

			const [created] = await db
				.insert(schema.users)
				.values({
					email: user.email,
					name: user.name ?? null,
					googleAccountId: account.providerAccountId,
					googleRefreshToken: refreshToken ?? null
				})
				.returning();

			if (created) {
				// Sensible starting point: Monday to Friday, 09:00–12:30 and
				// 14:00–18:00, mornings kept for creative work.
				await db.insert(schema.settings).values({ userId: created.id });
				await db.insert(schema.workingHours).values(
					[1, 2, 3, 4, 5].map((dayOfWeek) => ({
						userId: created.id,
						dayOfWeek,
						intervals: [
							{ start: '09:00', end: '12:30', preferredKind: 'creative' as const },
							{ start: '14:00', end: '18:00', preferredKind: null }
						]
					}))
				);
			}

			return true;
		}
	}
});
