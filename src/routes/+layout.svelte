<script lang="ts">
	import '../app.css';
	import { SignIn, SignOut } from '@auth/sveltekit/components';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<div class="mx-auto max-w-6xl p-4">
	<nav class="mb-6 flex items-center gap-4 text-sm text-neutral-600">
		<a class="hover:text-neutral-900" href="/">Today</a>
		<a class="hover:text-neutral-900" href="/week">Week</a>
		<a class="hover:text-neutral-900" href="/plan">Plan</a>
		<a class="hover:text-neutral-900" href="/tasks">Tasks</a>
		<a class="hover:text-neutral-900" href="/settings">Settings</a>
		<a class="ml-auto hover:text-neutral-900" href="/debug">Debug</a>

		{#if data.session?.user}
			<span class="text-neutral-400">{data.session.user.email}</span>
			<SignOut>
				{#snippet submitButton()}
					<span class="cursor-pointer underline hover:text-neutral-900">Sign out</span>
				{/snippet}
			</SignOut>
		{:else}
			<SignIn provider="google">
				{#snippet submitButton()}
					<span class="cursor-pointer underline hover:text-neutral-900">Sign in with Google</span>
				{/snippet}
			</SignIn>
		{/if}
	</nav>
	{@render children()}
</div>
