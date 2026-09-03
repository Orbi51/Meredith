<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	let quickAdd = $state<HTMLInputElement | null>(null);

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

	const links = [
		['/', 'Today'],
		['/week', 'Week'],
		['/tasks', 'Tasks'],
		['/settings', 'Settings']
	] as const;
</script>

<svelte:window onkeydown={onKeydown} />

<div class="mx-auto max-w-6xl p-4">
	<nav class="mb-4 flex items-center gap-4 text-sm text-neutral-600">
		{#each links as [href, label] (href)}
			<a
				class="hover:text-neutral-900 {page.url.pathname === href ? 'font-medium text-neutral-900' : ''}"
				{href}
			>
				{label}
			</a>
		{/each}

		<span class="ml-auto flex items-center gap-3">
			{#if data.session?.user}
				<span class="text-xs text-neutral-400">{data.session.user.email}</span>
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

	{#if data.session?.user}
		<form method="GET" action="/add" class="mb-6 flex gap-2">
			<input
				bind:this={quickAdd}
				name="text"
				placeholder="storyboard rev2 Studio X ~6h friday        (Ctrl+K)"
				class="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
			/>
			<button class="rounded bg-neutral-900 px-3 py-2 text-sm whitespace-nowrap text-white">
				Capture
			</button>
		</form>
	{/if}

	{@render children()}
</div>
