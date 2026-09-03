<script lang="ts">
	import '../app.css';
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
			<!-- Plain forms rather than Auth.js's Svelte 4 components: these post to
			     the action routes in /signin and /signout, which is the same thing
			     the components do, without the slot/snippet mismatch. -->
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
	</nav>
	{@render children()}
</div>
