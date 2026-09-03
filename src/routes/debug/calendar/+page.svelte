<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let running = $state(false);
</script>

<h1 class="text-xl font-semibold">Phase 0 acceptance check</h1>
<p class="mt-1 max-w-2xl text-sm text-neutral-600">
	Creates a block on the app's own <code>Planned work</code> calendar, moves it, deletes it, and
	fingerprints every other calendar before and after to prove nothing else was touched. The test
	event is removed at the end.
</p>

{#if !data.email}
	<p class="mt-4 rounded bg-amber-50 p-3 text-sm text-amber-800">
		Sign in with Google first, using the link in the top right.
	</p>
{:else}
	<form
		method="POST"
		action="?/verify"
		class="mt-4"
		use:enhance={() => {
			running = true;
			return async ({ update }) => {
				await update();
				running = false;
			};
		}}
	>
		<button
			class="rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
			disabled={running}
		>
			{running ? 'Running…' : 'Run the check'}
		</button>
		<span class="ml-2 text-sm text-neutral-500">as {data.email}</span>
	</form>
{/if}

{#if form?.steps}
	<ul class="mt-6 space-y-2 text-sm">
		{#each form.steps as step (step.name)}
			<li class="flex gap-2">
				<span class={step.ok ? 'text-green-700' : 'text-red-700'}>{step.ok ? '✓' : '✗'}</span>
				<span>
					{step.name}
					<span class="block text-xs text-neutral-500">{step.detail}</span>
				</span>
			</li>
		{/each}
	</ul>

	<p
		class="mt-4 rounded p-3 text-sm {form.passed
			? 'bg-green-50 text-green-800'
			: 'bg-red-50 text-red-800'}"
	>
		{form.passed
			? 'Phase 0 threshold met.'
			: 'Phase 0 threshold NOT met — see the failing step above.'}
	</p>
{/if}
