<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const timeFormat = $derived(
		new Intl.DateTimeFormat('fr-FR', {
			timeZone: data.scenario.timezone,
			weekday: 'short',
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		})
	);

	const titleById = $derived(new Map(data.scenario.tasks.map((t) => [t.id, t.title])));
</script>

<h1 class="text-xl font-semibold">Scheduler debug</h1>
<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
	Fixture scenario, all times shown in {data.scenario.timezone}.
</p>

<section class="mt-6">
	<h2 class="font-medium">Blocks ({data.output.blocks.length})</h2>
	<table class="mt-2 w-full text-sm">
		<thead class="text-left text-neutral-500 dark:text-neutral-400">
			<tr><th class="py-1">Task</th><th>Pool</th><th>Start</th><th>End</th></tr>
		</thead>
		<tbody>
			{#each data.output.blocks as block (block.taskId + block.start.toISOString())}
				<tr class="border-t border-neutral-200 dark:border-neutral-800">
					<td class="py-1">{titleById.get(block.taskId) ?? block.taskId}</td>
					<td class="text-neutral-500 dark:text-neutral-400">{block.pool}</td>
					<td>{timeFormat.format(block.start)}</td>
					<td>{timeFormat.format(block.end)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<section class="mt-6">
	<h2 class="font-medium">Overcommitment report</h2>
	{#if data.output.unplaced.length === 0 && data.output.atRisk.length === 0}
		<p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">Everything fits.</p>
	{/if}
	<ul class="mt-2 space-y-1 text-sm">
		{#each data.output.unplaced as item (item.taskId)}
			<li class="text-red-700 dark:text-red-400">
				{titleById.get(item.taskId) ?? item.taskId}: {item.hoursShort}h unplaced ({item.reason})
			</li>
		{/each}
		{#each data.output.atRisk as item (item.taskId)}
			<li class="text-amber-700 dark:text-amber-400">
				{titleById.get(item.taskId) ?? item.taskId}: {item.slackHours}h of slack{item.scheduledPastDeadline
					? ' — scheduled past its deadline'
					: ''}
			</li>
		{/each}
	</ul>
</section>

<section class="mt-6">
	<h2 class="font-medium">Capacity</h2>
	<ul class="mt-2 space-y-1 text-sm">
		{#each data.output.capacityUsed as week (week.weekIso)}
			<li>
				{week.weekIso}: {week.committedHours}h committed of {week.availableHours}h available
			</li>
		{/each}
	</ul>
</section>

<details class="mt-6">
	<summary class="cursor-pointer text-sm text-neutral-500 dark:text-neutral-400">Raw output</summary>
	<pre class="mt-2 overflow-x-auto rounded bg-neutral-900 dark:bg-neutral-100 p-3 text-xs text-neutral-100">{JSON.stringify(
			data.output,
			null,
			2
		)}</pre>
</details>
