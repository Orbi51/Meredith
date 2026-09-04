<script lang="ts">
	import { formatInTimeZone } from 'date-fns-tz';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const time = (value: Date | string) => formatInTimeZone(new Date(value), data.timezone, 'HH:mm');

	const overcommitted = $derived(
		data.capacity ? data.capacity.committedHours > data.capacity.availableHours : false
	);
</script>

<div class="flex items-baseline justify-between">
	<h1 class="text-xl font-semibold">{data.weekIso}</h1>
	<span class="text-sm">
		<a class="underline" href="?offset={data.offset - 1}">← previous</a>
		<a class="ml-3 underline" href="?offset={data.offset + 1}">next →</a>
	</span>
</div>

{#if data.capacity}
	<p
		class="mt-2 inline-block rounded px-2 py-1 text-sm {overcommitted
			? 'bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-300'
			: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'}"
	>
		{data.capacity.committedHours}h committed of {data.capacity.availableHours}h available
		{#if overcommitted}
			— over capacity
		{/if}
	</p>
{/if}

<div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-7">
	{#each data.days as day (day.civil)}
		<div class="rounded border p-2 {day.isToday ? 'border-neutral-900 dark:border-neutral-100' : 'border-neutral-200 dark:border-neutral-800'}">
			<h2 class="text-xs font-medium text-neutral-500 dark:text-neutral-400">{day.label}</h2>
			{#if day.blocks.length === 0}
				<p class="mt-2 text-xs text-neutral-300 dark:text-neutral-600">—</p>
			{:else}
				<ul class="mt-2 space-y-1">
					{#each day.blocks as block (block.id)}
						<li
							class="rounded border-l-2 bg-neutral-50 dark:bg-neutral-900 p-1.5 text-xs {block.status === 'skipped'
								? 'opacity-50'
								: ''}"
							style="border-left-color: {block.color}"
						>
							<span class="font-mono text-neutral-500 dark:text-neutral-400">{time(block.start)}</span>
							<span class="block">{block.title}</span>
							{#if block.pool === 'machine'}
								<span class="text-neutral-400 dark:text-neutral-500">unattended</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/each}
</div>
