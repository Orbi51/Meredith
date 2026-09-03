/**
 * Web push, and the rule that governs it (§10).
 *
 * > Interrupt the user only when the overcommitment report changes for the
 * > worse. A push notification when a deadline becomes impossible is valuable.
 * > A notification because the calendar shuffled is noise, and noise is why
 * > people abandon these tools.
 *
 * So this module is mostly about NOT sending things. Two messages exist:
 *
 *   - the daily brief, once a morning, only if there is something to say;
 *   - an at-risk alert, only when a deadline has become worse than the last
 *     state the user was told about.
 */

import webpush from 'web-push';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db, schema } from './db';
import { getSettings, updateSettings } from './db/queries';
import type { SchedulerOutput } from '$lib/scheduler/types';

export function pushConfigured(): boolean {
	return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

function configure() {
	webpush.setVapidDetails(
		env.VAPID_SUBJECT ?? 'mailto:nobody@example.com',
		env.VAPID_PUBLIC_KEY as string,
		env.VAPID_PRIVATE_KEY as string
	);
}

export type PushPayload = { title: string; body: string; url?: string };

/** Send to every device, dropping any the push service says is gone. */
export async function sendToUser(userId: string, payload: PushPayload): Promise<number> {
	if (!pushConfigured()) return 0;
	configure();

	const subscriptions = await db
		.select()
		.from(schema.pushSubscriptions)
		.where(eq(schema.pushSubscriptions.userId, userId));

	let delivered = 0;
	for (const subscription of subscriptions) {
		try {
			await webpush.sendNotification(
				{
					endpoint: subscription.endpoint,
					keys: { p256dh: subscription.p256dh, auth: subscription.auth }
				},
				JSON.stringify(payload)
			);
			delivered++;
		} catch (error) {
			const status = (error as { statusCode?: number }).statusCode;
			// 404/410 mean the browser threw the subscription away. Keeping it
			// would mean retrying a dead endpoint forever.
			if (status === 404 || status === 410) {
				await db
					.delete(schema.pushSubscriptions)
					.where(eq(schema.pushSubscriptions.id, subscription.id));
			}
		}
	}
	return delivered;
}

/**
 * A stable fingerprint of "what is currently going wrong".
 *
 * Only the identity of the at-risk tasks and the sign of their slack goes in.
 * Deliberately NOT the block times: the plan shuffles constantly, and nobody
 * wants a notification because a block moved by twenty minutes.
 */
export function riskDigest(output: SchedulerOutput): string {
	const parts = [
		...output.atRisk.map((r) => `${r.taskId}:${r.slackHours < 0 ? 'impossible' : 'tight'}`),
		...output.unplaced.map((u) => `${u.taskId}:unplaced`)
	].sort();
	return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

/**
 * Has the situation got worse since we last said anything?
 *
 * "Worse" means a task became impossible or unplaceable that was not before.
 * Things getting BETTER is not worth an interruption — the user will see it
 * next time they open the app.
 */
export function hasWorsened(previous: string | null, current: string, output: SchedulerOutput) {
	if (output.atRisk.length === 0 && output.unplaced.length === 0) return false;
	return previous !== current;
}

/**
 * Tell the user only if a deadline has newly broken. Returns what was sent, or
 * null when the right thing to do was nothing.
 */
export async function notifyIfWorse(
	userId: string,
	output: SchedulerOutput,
	titles: Map<string, string>
): Promise<PushPayload | null> {
	const settings = await getSettings(userId);
	if (!settings) return null;

	const digest = riskDigest(output);
	if (!hasWorsened(settings.lastRiskDigest, digest, output)) return null;

	const impossible = output.atRisk.filter((r) => r.slackHours < 0);
	const unplaced = output.unplaced;
	if (impossible.length === 0 && unplaced.length === 0) {
		// Nothing actually broken — record the state so we stay quiet about it.
		await updateSettings(userId, { lastRiskDigest: digest });
		return null;
	}

	const name = (id: string) => titles.get(id) ?? 'a task';
	const body =
		impossible.length > 0
			? impossible.length === 1
				? `${name(impossible[0]!.taskId)} can no longer be finished in time.`
				: `${impossible.length} deadlines can no longer be met.`
			: unplaced.length === 1
				? `${name(unplaced[0]!.taskId)} does not fit in the next three weeks.`
				: `${unplaced.length} tasks do not fit in the next three weeks.`;

	const payload: PushPayload = { title: 'A deadline just broke', body, url: '/plan' };
	await sendToUser(userId, payload);
	await updateSettings(userId, { lastRiskDigest: digest });
	return payload;
}

/**
 * The morning brief: what today looks like. Sent once per day, and only when
 * there is something on it.
 */
export async function sendDailyBrief(
	userId: string,
	options: { today: string; blocksToday: number; hoursToday: number; firstUp: string | null }
): Promise<PushPayload | null> {
	const settings = await getSettings(userId);
	if (!settings) return null;
	if (settings.lastBriefSentOn === options.today) return null; // already sent
	if (options.blocksToday === 0) return null; // a silent day needs no telling

	const payload: PushPayload = {
		title: `${options.hoursToday}h planned today`,
		body: options.firstUp ? `First up: ${options.firstUp}` : `${options.blocksToday} blocks.`,
		url: '/'
	};

	await sendToUser(userId, payload);
	await updateSettings(userId, { lastBriefSentOn: options.today });
	return payload;
}
