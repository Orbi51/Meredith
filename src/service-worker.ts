/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

/**
 * The service worker (§11).
 *
 * Three jobs, no more:
 *   1. cache the shell so the app opens instantly and works on a train;
 *   2. serve today's view from cache when the network is gone;
 *   3. show a push notification.
 *
 * The offline capture QUEUE lives in the page, not here — see
 * `$lib/offline-queue.ts`. This worker only wakes it up on reconnect.
 *
 * Deliberately conservative about what it caches: a stale plan is worse than
 * no plan, so pages are network-first and the cache is only a fallback.
 */

import { build, files, version } from '$service-worker';

const self = globalThis.self as unknown as ServiceWorkerGlobalScope;

const CACHE = `capacity-${version}`;
/** The built app and the static files — safe to cache forever, they are hashed. */
const PRECACHE = [...build, ...files];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	// Never cache the auth flow: a stale sign-in page is a confusing dead end.
	if (url.pathname.startsWith('/auth') || url.pathname.startsWith('/signin')) return;

	// Hashed build assets: cache first, they never change under the same name.
	if (PRECACHE.includes(url.pathname)) {
		event.respondWith(
			caches.match(request).then((cached) => cached ?? fetch(request))
		);
		return;
	}

	// Everything else: network first, falling back to whatever we last saw.
	event.respondWith(
		fetch(request)
			.then((response) => {
				if (response.ok && response.type === 'basic') {
					const copy = response.clone();
					caches.open(CACHE).then((cache) => cache.put(request, copy));
				}
				return response;
			})
			.catch(async () => {
				const cached = await caches.match(request);
				if (cached) return cached;
				// An offline navigation with nothing cached still gets the today
				// view rather than the browser's error page.
				const shell = await caches.match('/');
				if (shell) return shell;
				return new Response('Offline, and this page has not been opened before.', {
					status: 503,
					headers: { 'content-type': 'text/plain' }
				});
			})
	);
});

/**
 * A push arrives only when the overcommitment report has become worse (§10).
 * A notification because the calendar shuffled is noise, and noise is why
 * people abandon these tools — so the server, not this worker, decides.
 */
self.addEventListener('push', (event) => {
	if (!event.data) return;

	let payload: { title?: string; body?: string; url?: string } = {};
	try {
		payload = event.data.json();
	} catch {
		payload = { body: event.data.text() };
	}

	event.waitUntil(
		self.registration.showNotification(payload.title ?? 'Capacity', {
			body: payload.body ?? '',
			icon: '/icon-192.png',
			badge: '/icon-192.png',
			data: { url: payload.url ?? '/' },
			// Replaces the previous one rather than stacking: the latest state of
			// the plan is the only one worth reading.
			tag: 'capacity-brief',
			renotify: true
		} as NotificationOptions)
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const target = (event.notification.data?.url as string) ?? '/';

	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
			for (const client of clients) {
				if ('focus' in client) {
					client.navigate(target);
					return client.focus();
				}
			}
			return self.clients.openWindow(target);
		})
	);
});

/** The page asks us to flush the offline capture queue when it reconnects. */
self.addEventListener('message', (event) => {
	if (event.data === 'flush-queue') {
		self.clients.matchAll().then((clients) => {
			for (const client of clients) client.postMessage('flush-queue');
		});
	}
});

export {};
