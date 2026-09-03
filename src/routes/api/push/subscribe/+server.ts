/** Register or drop a device for web push. */
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { currentUser } from '$lib/server/auth';
import { db, schema } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	// The client needs the public key to subscribe; it is public by design.
	return json({ publicKey: env.VAPID_PUBLIC_KEY ?? null });
};

export const POST: RequestHandler = async (event) => {
	const user = await currentUser(event);
	if (!user) return json({ error: 'signed out' }, { status: 401 });

	const body = (await event.request.json()) as {
		endpoint?: string;
		keys?: { p256dh?: string; auth?: string };
	};

	if (!body.endpoint || !body.keys?.p256dh || !body.keys.auth) {
		return json({ error: 'incomplete subscription' }, { status: 400 });
	}

	await db
		.insert(schema.pushSubscriptions)
		.values({
			userId: user.id,
			endpoint: body.endpoint,
			p256dh: body.keys.p256dh,
			auth: body.keys.auth
		})
		// Re-subscribing the same device must not create a second row, or every
		// notification arrives twice.
		.onConflictDoNothing({ target: schema.pushSubscriptions.endpoint });

	return json({ ok: true });
};

export const DELETE: RequestHandler = async (event) => {
	const user = await currentUser(event);
	if (!user) return json({ error: 'signed out' }, { status: 401 });

	const { endpoint } = (await event.request.json()) as { endpoint?: string };
	if (endpoint) {
		await db
			.delete(schema.pushSubscriptions)
			.where(eq(schema.pushSubscriptions.endpoint, endpoint));
	}
	return json({ ok: true });
};
