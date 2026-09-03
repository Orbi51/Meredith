<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { formatInTimeZone } from 'date-fns-tz';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const time = (v: Date | string) => formatInTimeZone(new Date(v), data.timezone, 'HH:mm');
	const day = (v: Date | string) => formatInTimeZone(new Date(v), data.timezone, 'EEE d MMM');
	const dayTime = (v: Date | string) =>
		formatInTimeZone(new Date(v), data.timezone, 'EEE d MMM HH:mm');

	const overrun = $derived(data.capacity.overrunHours > 0);

	/** The consequence of overcommitting, in the user's own words. */
	const breaking = $derived(data.pressure.filter((p) => p.slackHours < 0));
</script>

<div class="flex items-baseline justify-between">
	<h1 class="text-xl font-semibold">Weekly plan · {data.currentWeek}</h1>
	{#if data.alreadyDoneThisWeek}
		<span class="text-sm text-green-700">done for this week</span>
	{/if}
</div>

{#each data.warnings as warning (warning)}
	<p class="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-800">{warning}</p>
{/each}

<!-- ───────────────────────────────────────────────── step 1: review last week -->
<section class="mt-8">
	<h2 class="font-medium">1 · Last week</h2>
	<p class="mt-1 text-sm text-neutral-600">
		{#if data.review.length === 0}
			Nothing was planned last week — nothing to review.
		{:else}
			{data.reviewTotals.planned}h planned, {data.reviewTotals.actual}h recorded.
			{#if data.reviewTotals.unreviewed > 0}
				<strong>{data.reviewTotals.unreviewed} still to confirm.</strong> This is what teaches the
				app how long your work really takes.
			{/if}
		{/if}
	</p>

	{#if data.review.length > 0}
		<ul class="mt-3 space-y-1">
			{#each data.review as block (block.id)}
				<li class="flex flex-wrap items-center gap-2 border-b border-neutral-100 py-1.5 text-sm">
					<span class="w-40 font-mono text-xs text-neutral-500">
						{day(block.start)} {time(block.start)}
					</span>
					<span class="min-w-48 flex-1">{block.title}</span>
					<span class="text-xs text-neutral-500">{block.plannedHours}h planned</span>

					{#if block.status === 'planned'}
						<form
							method="POST"
							action="?/review"
							class="flex gap-1"
							use:enhance={() => async ({ update }) => {
								// Confirming a block changes the capacity and slack figures in
								// every other step, so refresh the whole page, not just the form.
								await update();
								await invalidateAll();
							}}
						>
							<input type="hidden" name="blockId" value={block.id} />
							{#each [['as-planned', 'as planned'], ['more', '+30'], ['less', '−30'], ['skipped', "didn't happen"]] as [value, label] (value)}
								<button
									name="outcome"
									{value}
									class="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100"
								>
									{label}
								</button>
							{/each}
						</form>
					{:else}
						<span class="text-xs text-neutral-500">
							{block.status}{#if block.actualHours !== null}
								· {block.actualHours}h{/if}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<!-- ──────────────────────────────────────────── step 2: fixed commitments -->
<section class="mt-8">
	<h2 class="font-medium">2 · Already committed</h2>
	<p class="mt-1 text-sm text-neutral-600">
		Appointments in your calendar for the rest of this week. Read-only — this is context.
	</p>
	{#if data.appointments.length === 0}
		<p class="mt-2 text-sm text-neutral-500">Nothing in the calendar.</p>
	{:else}
		<ul class="mt-2 space-y-1 text-sm">
			{#each data.appointments as appointment (appointment.start + appointment.summary)}
				<li class="flex gap-3">
					<span class="w-40 font-mono text-xs text-neutral-500">
						{day(appointment.start)}
						{#if !appointment.allDay}{time(appointment.start)}–{time(appointment.end)}{:else}all day{/if}
					</span>
					<span>{appointment.summary}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<!-- ─────────────────────────────────────────────────────── step 3: capacity -->
<section class="mt-8">
	<h2 class="font-medium">3 · What you actually have</h2>
	<div class="mt-2 flex items-baseline gap-3">
		<span class="text-4xl font-semibold">{data.capacity.availableHours}h</span>
		<span class="text-sm text-neutral-600">
			{data.capacity.workingHours}h of working hours − {data.capacity.appointmentHours}h of
			appointments
		</span>
	</div>
	<p class="mt-1 text-sm text-neutral-500">This is the budget for the rest of this ritual.</p>
</section>

<!-- ───────────────────────────────────────────── step 4: deadline pressure -->
<section class="mt-8">
	<h2 class="font-medium">4 · Deadline pressure</h2>
	<p class="mt-1 text-sm text-neutral-600">
		Every deadline in the next three weeks, least room first. Slack is measured in
		<em>working</em> hours, not days on a calendar.
	</p>

	{#if data.pressure.length === 0}
		<p class="mt-2 text-sm text-neutral-500">No deadlines in the next three weeks.</p>
	{:else}
		<table class="mt-3 w-full text-sm">
			<thead class="text-left text-xs text-neutral-500">
				<tr><th class="py-1">Task</th><th>Due</th><th>Left to do</th><th>Slack</th></tr>
			</thead>
			<tbody>
				{#each data.pressure as item (item.taskId)}
					<tr class="border-t border-neutral-100 {item.slackHours < 0 ? 'bg-red-50' : ''}">
						<td class="py-1.5">
							{#if item.projectName}<span class="text-neutral-500">[{item.projectName}]</span>{/if}
							{item.title}
							{#if item.waiting}
								<span class="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">waiting</span>
							{/if}
						</td>
						<td>{dayTime(item.deadline)}</td>
						<td>
							{item.remainingHours}h
							{#if item.multiplier !== 1 && item.rawHours !== null}
								<span class="block text-xs text-amber-700">
									you said {item.rawHours}h (×{item.multiplier})
								</span>
							{:else if item.inferred}
								<span class="block text-xs text-neutral-400">inferred</span>
							{/if}
						</td>
						<td class={item.slackHours < 0 ? 'font-medium text-red-700' : ''}>
							{item.slackHours}h
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<!-- ───────────────────────────────────────────────────────── step 5: commit -->
<section class="mt-8">
	<h2 class="font-medium">5 · Commit</h2>
	<p class="mt-1 text-sm text-neutral-600">
		What are you promising to do this week? The total is what matters, not the order.
	</p>

	<!-- The budget line. §9: make the overrun impossible to miss. -->
	<div
		class="mt-3 rounded p-3 {overrun ? 'bg-red-50 text-red-900' : 'bg-neutral-100 text-neutral-800'}"
	>
		<span class="text-2xl font-semibold">{data.capacity.committedHours}h</span>
		<span class="text-sm">committed of {data.capacity.availableHours}h available</span>
		{#if overrun}
			<strong class="ml-2">— {data.capacity.overrunHours}h more than you have.</strong>
			<p class="mt-1 text-sm">
				Something has to give. Either take work out of this week, move a deadline, or accept that
				{#if breaking.length > 0}
					<strong>
						{breaking.map((b) => b.title).join(', ')}
					</strong>
					{breaking.length === 1 ? 'slips' : 'slip'}.
				{:else}
					something slips.
				{/if}
			</p>
		{/if}
	</div>

	<ul class="mt-3 space-y-1">
		{#each data.committable as task (task.taskId)}
			<li class="flex flex-wrap items-center gap-2 border-b border-neutral-100 py-1.5 text-sm">
				<form
					method="POST"
					action="?/commit"
					use:enhance={() => async ({ update }) => {
						await update();
						await invalidateAll();
					}}
				>
					<input type="hidden" name="taskId" value={task.taskId} />
					<input type="hidden" name="committed" value={String(!task.committed)} />
					<button
						class="rounded border px-2 py-0.5 text-xs {task.committed
							? 'border-neutral-900 bg-neutral-900 text-white'
							: 'border-neutral-300 hover:bg-neutral-100'}"
					>
						{task.committed ? 'committed' : 'commit'}
					</button>
				</form>

				<span class="min-w-48 flex-1">
					{#if task.projectName}<span class="text-neutral-500">[{task.projectName}]</span>{/if}
					{task.title}
				</span>

				<span class="text-xs text-neutral-500">
					{task.remainingHours}h
					{#if task.multiplier !== 1 && task.rawHours !== null}
						<span class="text-amber-700">(you said {task.rawHours}h)</span>
					{:else if task.inferred}
						<span class="text-neutral-400">inferred</span>
					{/if}
				</span>

				<span class="w-32 text-right text-xs text-neutral-500">
					{task.deadline ? dayTime(task.deadline) : 'no deadline'}
				</span>
			</li>
		{/each}
	</ul>
</section>

<!-- ─────────────────────────────────────────────────────── step 6: generate -->
<section class="mt-8 mb-16">
	<h2 class="font-medium">6 · Generate</h2>
	<p class="mt-1 text-sm text-neutral-600">
		Nothing is written to your calendar until you have seen the preview and confirmed it.
	</p>

	<form method="POST" action="?/preview" class="mt-3 inline-block">
		<button class="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100">
			Preview the plan
		</button>
	</form>

	{#if form?.preview}
		<div class="mt-4 rounded border border-neutral-200 p-3">
			<h3 class="text-sm font-medium">
				{form.preview.blocks.length} blocks
			</h3>

			{#if form.preview.atRisk.length > 0}
				<div class="mt-2 rounded bg-red-50 p-2 text-sm text-red-800">
					<strong>At risk:</strong>
					<ul class="mt-1 space-y-0.5">
						{#each form.preview.atRisk as risk (risk.title)}
							<li>
								{risk.title} — {risk.slackHours}h slack{#if risk.pastDeadline}, scheduled past its
									deadline{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if form.preview.unplaced.length > 0}
				<div class="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-800">
					<strong>Does not fit in the horizon:</strong>
					<ul class="mt-1 space-y-0.5">
						{#each form.preview.unplaced as item (item.title)}
							<li>{item.title} — {item.hoursShort}h short ({item.reason})</li>
						{/each}
					</ul>
				</div>
			{/if}

			<ul class="mt-3 max-h-72 space-y-0.5 overflow-y-auto text-sm">
				{#each form.preview.blocks as block (block.start + block.title)}
					<li class="flex gap-3">
						<span class="w-40 font-mono text-xs text-neutral-500">
							{block.day} {block.time}
						</span>
						<span>{block.title}</span>
						{#if block.pool === 'machine'}
							<span class="text-xs text-neutral-400">unattended</span>
						{/if}
					</li>
				{/each}
			</ul>

			<form method="POST" action="?/generate" class="mt-4">
				<button class="rounded bg-neutral-900 px-3 py-2 text-sm text-white">
					Write these {form.preview.blocks.length} blocks to my calendar
				</button>
			</form>
		</div>
	{/if}

	{#if form?.generated}
		<div class="mt-4 rounded bg-green-50 p-3 text-sm text-green-900">
			Written. {form.generated.blocks} blocks planned
			{#if form.generated.calendar}
				· calendar: {form.generated.calendar.inserted} added,
				{form.generated.calendar.updated} updated,
				{form.generated.calendar.removed} removed
			{/if}
			{#each form.generated.warnings as warning (warning)}
				<p class="mt-1 text-amber-800">{warning}</p>
			{/each}
		</div>
	{/if}
</section>
