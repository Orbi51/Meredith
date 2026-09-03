/**
 * The daily job, on a schedule.
 *
 * Netlify is serverless, so there is no always-on process to hold a timer —
 * `ENABLE_DAILY_JOB` must be false there. This function is the replacement: it
 * wakes once a morning and calls the endpoint that does the work.
 *
 * 05:00 UTC is 07:00 in Paris in summer and 06:00 in winter. Netlify schedules
 * in UTC only, so the brief drifts by an hour across the year; an hour either
 * side of seven is still the morning.
 */

import type { Config } from '@netlify/functions';

export default async () => {
	// Netlify sets URL to the site's primary address at runtime.
	const base = process.env.URL ?? process.env.DEPLOY_PRIME_URL;
	const secret = process.env.CRON_SECRET;

	if (!base || !secret) {
		console.error('[daily] URL or CRON_SECRET missing — nothing was run.');
		return new Response('not configured', { status: 500 });
	}

	const response = await fetch(`${base}/api/cron/daily`, {
		method: 'POST',
		headers: { authorization: `Bearer ${secret}` }
	});

	const body = await response.text();
	console.log(`[daily] ${response.status}: ${body.slice(0, 500)}`);

	// A non-2xx here shows up in the Netlify function log rather than anywhere
	// the user would see it, so it is logged loudly and reported as a failure.
	return new Response(body, { status: response.ok ? 200 : 500 });
};

export const config: Config = {
	schedule: '0 5 * * *'
};
