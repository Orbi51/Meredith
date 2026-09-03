/**
 * Subscribing this device to push, from the browser.
 *
 * Permission is only ever requested in response to the user pressing a button
 * — a notification prompt on page load is the fastest way to have it denied
 * permanently.
 */

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
	const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
		.replace(/-/g, '+')
		.replace(/_/g, '/');
	const raw = atob(padded);
	// Backed by a plain ArrayBuffer on purpose: applicationServerKey will not
	// accept a view that might sit on a SharedArrayBuffer.
	const bytes = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
	return bytes;
}

export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

export async function pushState(): Promise<PushState> {
	if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
	if (Notification.permission === 'denied') return 'denied';
	const registration = await navigator.serviceWorker.ready;
	return (await registration.pushManager.getSubscription()) ? 'on' : 'off';
}

export async function enablePush(): Promise<PushState> {
	const { publicKey } = await (await fetch('/api/push/subscribe')).json();
	if (!publicKey) throw new Error('Push is not configured on the server.');

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

	const registration = await navigator.serviceWorker.ready;
	const subscription = await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: urlBase64ToUint8Array(publicKey)
	});

	await fetch('/api/push/subscribe', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(subscription.toJSON())
	});
	return 'on';
}

export async function disablePush(): Promise<PushState> {
	const registration = await navigator.serviceWorker.ready;
	const subscription = await registration.pushManager.getSubscription();
	if (subscription) {
		await fetch('/api/push/subscribe', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ endpoint: subscription.endpoint })
		});
		await subscription.unsubscribe();
	}
	return 'off';
}
