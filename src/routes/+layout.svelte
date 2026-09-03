<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

<div class="mx-auto max-w-6xl p-4">
	<nav class="mb-6 flex gap-4 text-sm text-neutral-600">
		<a class="hover:text-neutral-900" href="/">Today</a>
		<a class="hover:text-neutral-900" href="/week">Week</a>
		<a class="hover:text-neutral-900" href="/plan">Plan</a>
		<a class="hover:text-neutral-900" href="/tasks">Tasks</a>
		<a class="hover:text-neutral-900" href="/settings">Settings</a>
		<a class="ml-auto hover:text-neutral-900" href="/debug">Debug</a>
	</nav>
	{@render children()}
</div>
