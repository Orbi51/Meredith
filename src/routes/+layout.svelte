<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { dev } from '$app/environment';
	import { page } from '$app/state';
	import { enqueue, queueSize, startFlushing } from '$lib/offline-queue';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	let quickAdd = $state<HTMLInputElement | null>(null);
	let online = $state(true);
	let pending = $state(0);
	let flushed = $state(0);
	let installPrompt = $state<Event | null>(null);
	let showIosHint = $state(false);

	/**
	 * Cmd/Ctrl+K focuses capture from anywhere (§8). If capture takes more than a
	 * few seconds the user stops doing it, and then the app is worthless.
	 */
	function onKeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			quickAdd?.focus();
		}
	}

	/**
	 * Offline, capture goes to IndexedDB instead of the server. The point is
	 * that the user never has to think about it: same box, same Enter key.
	 */
	async function onCapture(event: SubmitEvent) {
		if (navigator.onLine) return; // let the normal navigation happen
		event.preventDefault();

		const text = quickAdd?.value.trim();
		if (!text) return;

		await enqueue(text);
		pending = await queueSize();
		if (quickAdd) quickAdd.value = '';
	}

	onMount(() => {
		online = navigator.onLine;
		const setOnline = () => (online = navigator.onLine);
		window.addEventListener('online', setOnline);
		window.addEventListener('offline', setOnline);

		queueSize().then((n) => (pending = n));

		const stop = startFlushing(async (count) => {
			flushed = count;
			pending = await queueSize();
			setTimeout(() => (flushed = 0), 6000);
		});

		if ('serviceWorker' in navigator) {
			if (dev) {
				// In development a worker is a liability: when the dev server stops
				// it cheerfully serves the last cached page, and you spend twenty
				// minutes wondering why your edits do nothing. Skipping
				// registration is not enough — one registered in a previous
				// session is still there — so tear it down and drop its caches.
				navigator.serviceWorker.getRegistrations().then((registrations) => {
					for (const registration of registrations) registration.unregister();
				});
				caches?.keys().then((keys) => {
					for (const key of keys) caches.delete(key);
				});
			} else {
				navigator.serviceWorker.register('/service-worker.js', { type: 'module' }).catch(() => {
					/* the app works without it; offline support is the only loss */
				});
			}
		}

		// Android and desktop offer a real install prompt.
		const onBeforeInstall = (event: Event) => {
			event.preventDefault();
			installPrompt = event;
		};
		window.addEventListener('beforeinstallprompt', onBeforeInstall);

		// iOS does not, and web push there REQUIRES the app to be on the home
		// screen — so it needs saying once, in words.
		const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
		const standalone =
			window.matchMedia('(display-mode: standalone)').matches ||
			(navigator as unknown as { standalone?: boolean }).standalone === true;
		if (isIos && !standalone && !localStorage.getItem('ios-install-hint-dismissed')) {
			showIosHint = true;
		}

		return () => {
			window.removeEventListener('online', setOnline);
			window.removeEventListener('offline', setOnline);
			window.removeEventListener('beforeinstallprompt', onBeforeInstall);
			stop();
		};
	});

	async function install() {
		const prompt = installPrompt as unknown as { prompt: () => Promise<void> } | null;
		await prompt?.prompt();
		installPrompt = null;
	}

	function dismissIosHint() {
		localStorage.setItem('ios-install-hint-dismissed', '1');
		showIosHint = false;
	}

	const links = [
		['/', 'Today'],
		['/week', 'Week'],
		['/plan', 'Plan'],
		['/tasks', 'Tasks'],
		['/projects', 'Projects'],
		['/settings', 'Settings']
	] as const;
</script>

<svelte:window onkeydown={onKeydown} />

<div class="mx-auto max-w-6xl p-4">
	<nav class="mb-4 flex items-center gap-4 text-sm text-neutral-600">
		{#each links as [href, label] (href)}
			<a
				class="hover:text-neutral-900 {page.url.pathname === href
					? 'font-medium text-neutral-900'
					: ''}"
				{href}
			>
				{label}
			</a>
		{/each}

		<span class="ml-auto flex items-center gap-3">
			{#if !online}
				<span class="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">offline</span>
			{/if}
			{#if installPrompt}
				<button class="text-xs underline" onclick={install}>Install</button>
			{/if}
			{#if data.session?.user}
				<span class="hidden text-xs text-neutral-400 sm:inline">{data.session.user.email}</span>
				<form method="POST" action="/signout">
					<button class="cursor-pointer underline hover:text-neutral-900">Sign out</button>
				</form>
			{:else}
				<form method="POST" action="/signin">
					<input type="hidden" name="providerId" value="google" />
					<button class="cursor-pointer underline hover:text-neutral-900">
						Sign in with Google
					</button>
				</form>
			{/if}
		</span>
	</nav>

	{#if showIosHint}
		<p class="mb-4 rounded bg-neutral-100 p-3 text-sm text-neutral-700">
			Add Capacity to your home screen — Share → <strong>Add to Home Screen</strong>. On iPhone
			that is also what lets it send you notifications.
			<button class="ml-2 underline" onclick={dismissIosHint}>dismiss</button>
		</p>
	{/if}

	{#if data.session?.user}
		<form method="GET" action="/add" class="mb-2 flex gap-2" onsubmit={onCapture}>
			<input
				bind:this={quickAdd}
				name="text"
				placeholder="storyboard rev2 Studio X ~6h friday   ·   or  Project - task - 6h - friday   (Ctrl+K)"
				class="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
			/>
			<button class="rounded bg-neutral-900 px-3 py-2 text-sm whitespace-nowrap text-white">
				Capture
			</button>
		</form>

		{#if pending > 0}
			<p class="mb-4 text-xs text-amber-700">
				{pending} capture{pending === 1 ? '' : 's'} waiting to sync — they will be sent when you are
				back online.
			</p>
		{:else if flushed > 0}
			<p class="mb-4 text-xs text-green-700">
				{flushed} offline capture{flushed === 1 ? '' : 's'} synced.
			</p>
		{:else}
			<div class="mb-4"></div>
		{/if}
	{/if}

	{@render children()}
</div>
