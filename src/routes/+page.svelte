<script lang="ts">
	import { formatInTimeZone } from 'date-fns-tz';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const time = (value: Date | string) =>
		data.signedIn ? formatInTimeZone(new Date(value), data.timezone, 'HH:mm') : '';
	const day = (value: Date | string) =>
		data.signedIn ? formatInTimeZone(new Date(value), data.timezone, 'EEE d MMM') : '';
</script>

{#if !data.signedIn}
	<h1 class="text-xl font-semibold">Capacity</h1>
	<p class="mt-2 max-w-lg text-sm text-neutral-600 dark:text-neutral-400">
		The calendar is capacity, not a to-do list. Sign in with Google to let the app read your
		appointments and write planned work to its own calendar.
	</p>
{:else}
	<div class="flex items-baseline justify-between">
		<h1 class="text-xl font-semibold">Today</h1>
		<span class="text-sm text-neutral-500 dark:text-neutral-400">{day(data.now)}</span>
	</div>

	<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
		<strong>{data.remainingHours.toFixed(1)}h</strong> left of
		{data.committedHours.toFixed(1)}h committed today
	</p>

	{#if data.atRisk.length > 0}
		<section class="mt-4 rounded bg-red-50 dark:bg-red-950 p-3">
			<h2 class="text-sm font-medium text-red-800 dark:text-red-300">Deadline passed</h2>
			<ul class="mt-1 space-y-1 text-sm text-red-700 dark:text-red-400">
				{#each data.atRisk as item (item.taskId)}
					<li>{item.title} — was due {day(item.deadline)} {time(item.deadline)}</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.blocks.length === 0}
		<p class="mt-6 text-sm text-neutral-500 dark:text-neutral-400">
			Nothing planned today. <a class="underline" href="/add">Capture a task</a> and the scheduler
			will find room for it.
		</p>
	{:else}
		<ul class="mt-6 space-y-2">
			{#each data.blocks as block (block.id)}
				<!-- The project's colour on the left edge: the week becomes readable
				     at a glance, without reading a single name. -->
				<li
					class="rounded border border-l-4 p-3 {block.id === data.nextBlockId
						? 'border-neutral-900 dark:border-neutral-100'
						: 'border-neutral-200 dark:border-neutral-800'} {block.status === 'skipped' ? 'opacity-50' : ''}"
					style={block.projectColor ? `border-left-color: ${block.projectColor}` : ''}
				>
					<div class="flex items-baseline gap-3">
						<span class="font-mono text-sm text-neutral-500 dark:text-neutral-400">
							{time(block.start)}–{time(block.end)}
						</span>
						<span class="text-sm">
							{#if block.projectName}
								<span class="text-neutral-500 dark:text-neutral-400">[{block.projectName}]</span>
							{/if}
							{block.title}
						</span>
						{#if block.pool === 'machine'}
							<span class="rounded bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-500 dark:text-neutral-400">
								unattended
							</span>
						{/if}
						{#if block.id === data.nextBlockId}
							<span class="ml-auto text-xs font-medium">next up</span>
						{/if}
					</div>

					{#if block.status === 'planned'}
						<form method="POST" action="?/confirm" class="mt-2 flex flex-wrap gap-2">
							<input type="hidden" name="blockId" value={block.id} />
							{#each [['as-planned', 'as planned'], ['more', '+30'], ['less', '−30'], ['skipped', "didn't happen"]] as [value, label] (value)}
								<button
									name="outcome"
									{value}
									class="rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
								>
									{label}
								</button>
							{/each}
						</form>
					{:else}
						<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
							{block.status}{#if block.status === 'skipped'}
								— returned to the pool and rescheduled{/if}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/if}
