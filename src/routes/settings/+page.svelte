<script lang="ts">
	import { onMount } from 'svelte';
	import { formatInTimeZone } from 'date-fns-tz';
	import { disablePush, enablePush, pushState, type PushState } from '$lib/push-client';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let notifications = $state<PushState>('unsupported');
	let busy = $state(false);
	let pushError = $state<string | null>(null);

	const day = (v: Date | string) =>
		formatInTimeZone(new Date(v), data.settings.timezone, 'EEE d MMM');

	onMount(() => {
		pushState().then((state) => (notifications = state));
	});

	async function toggleNotifications() {
		busy = true;
		pushError = null;
		try {
			notifications = notifications === 'on' ? await disablePush() : await enablePush();
		} catch (error) {
			pushError = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}
</script>

<h1 class="text-xl font-semibold">Settings</h1>

{#if form?.message}
	<p class="mt-2 rounded bg-green-50 dark:bg-green-950 p-2 text-sm text-green-800 dark:text-green-300">{form.message}</p>
{/if}

<form method="POST" action="?/saveHours" class="mt-4">
	<h2 class="font-medium">Working hours</h2>
	<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
		The capacity everything else is measured against. Marking a slot for a kind of work is a
		preference, not a rule — the scheduler will use an unmarked slot rather than miss a deadline.
	</p>

	<table class="mt-3 text-sm">
		<thead class="text-left text-xs text-neutral-500 dark:text-neutral-400">
			<tr>
				<th class="py-1 pr-4">Day</th>
				<th class="pr-2">Morning</th>
				<th class="pr-4">Prefer</th>
				<th class="pr-2">Afternoon</th>
				<th>Prefer</th>
			</tr>
		</thead>
		<tbody>
			{#each data.days as day (day.dayOfWeek)}
				<tr class="border-t border-neutral-100 dark:border-neutral-800">
					<td class="py-1.5 pr-4">{day.name}</td>
					{#each [0, 1] as slot (slot)}
						<td class="py-1.5 pr-2">
							<input
								type="time"
								name="d{day.dayOfWeek}-s{slot}-start"
								value={day.intervals[slot]?.start ?? ''}
								class="rounded border border-neutral-300 dark:border-neutral-700 px-1 py-0.5"
							/>
							<input
								type="time"
								name="d{day.dayOfWeek}-s{slot}-end"
								value={day.intervals[slot]?.end ?? ''}
								class="rounded border border-neutral-300 dark:border-neutral-700 px-1 py-0.5"
							/>
						</td>
						<td class="py-1.5 pr-4">
							<select
								name="d{day.dayOfWeek}-s{slot}-kind"
								class="rounded border border-neutral-300 dark:border-neutral-700 px-1 py-0.5 text-xs"
							>
								<option value="" selected={!day.intervals[slot]?.preferredKind}>any</option>
								<option
									value="creative"
									selected={day.intervals[slot]?.preferredKind === 'creative'}
								>
									creative
								</option>
								<option value="admin" selected={day.intervals[slot]?.preferredKind === 'admin'}>
									admin
								</option>
							</select>
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>

	<div class="mt-4 flex flex-wrap items-end gap-4">
		<label class="block text-sm">
			<span class="text-xs text-neutral-500 dark:text-neutral-400">Timezone</span>
			<input
				name="timezone"
				value={data.settings.timezone}
				class="mt-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1"
			/>
		</label>
		<label class="block text-sm">
			<span class="text-xs text-neutral-500 dark:text-neutral-400">Hours in a working day</span>
			<input
				name="hoursPerDay"
				type="number"
				min="1"
				max="16"
				step="0.5"
				value={data.settings.hoursPerDay}
				class="mt-1 w-24 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1"
				title="Used for both '2j' in a capture and the €/day rates on the projects page — one definition, so they cannot disagree."
			/>
		</label>
		<label class="block text-sm">
			<span class="text-xs text-neutral-500 dark:text-neutral-400">Your usual day rate (€)</span>
			<input
				name="defaultDayRateEur"
				type="number"
				min="0"
				step="10"
				value={data.settings.defaultDayRateEur ?? ''}
				placeholder="optional"
				class="mt-1 w-28 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1"
				title="Only used for comparison: it is what tells you a fixed-price job is quietly earning less than you normally ask for."
			/>
		</label>
		<label class="block text-sm">
			<span class="text-xs text-neutral-500 dark:text-neutral-400">Planning horizon (days)</span>
			<input
				name="horizonDays"
				type="number"
				min="1"
				max="90"
				value={data.settings.horizonDays}
				class="mt-1 w-24 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1"
			/>
		</label>
		<button class="rounded bg-neutral-900 dark:bg-neutral-100 px-3 py-2 text-sm text-white dark:text-neutral-900">Save and replan</button>
	</div>
</form>

<section class="mt-10">
	<h2 class="font-medium">Calibration</h2>
	<p class="mt-1 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
		How far your estimates are from reality, learned from confirmed blocks. Below five samples the
		multiplier stays at 1.0 — the app will not adjust your estimates on evidence it does not have.
	</p>
	<table class="mt-3 text-sm">
		<thead class="text-left text-xs text-neutral-500 dark:text-neutral-400">
			<tr><th class="py-1 pr-6">Kind</th><th class="pr-6">Multiplier</th><th class="pr-6">Samples</th><th>Median actual</th></tr>
		</thead>
		<tbody>
			{#each data.calibration as row (row.kind)}
				<tr class="border-t border-neutral-100 dark:border-neutral-800">
					<td class="py-1.5 pr-6">{row.kind}</td>
					<td class="pr-6">
						×{row.multiplier}
						{#if row.sampleCount < 5}
							<span class="text-xs text-neutral-400 dark:text-neutral-500">(not yet applied)</span>
						{/if}
					</td>
					<td class="pr-6">{row.sampleCount}</td>
					<td>{row.medianActualHours ?? '—'}h</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<section class="mt-10">
	<h2 class="font-medium">Google Calendar</h2>
	<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
		{#if data.settings.targetCalendarId}
			Writing to <code class="text-xs">Planned work</code>. No other calendar is ever written to.
		{:else}
			Not connected yet — the calendar is created on the first replan.
		{/if}
	</p>
	<a class="mt-2 inline-block text-sm underline" href="/debug/calendar">Run the safety check</a>
</section>

<section class="mt-10">
	<h2 class="font-medium">Notifications</h2>
	<p class="mt-1 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
		Two messages, and no others: a morning brief when something is planned, and an alert when a
		deadline becomes impossible. Nothing is sent because the calendar shuffled — noise is why
		people abandon these tools.
	</p>

	{#if !data.pushAvailable}
		<p class="mt-2 text-sm text-amber-800 dark:text-amber-300">
			Push is not configured on the server (no VAPID keys).
		</p>
	{:else if notifications === 'unsupported'}
		<p class="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
			This browser cannot do web push. On iPhone, add the app to your home screen first.
		</p>
	{:else if notifications === 'denied'}
		<p class="mt-2 text-sm text-amber-800 dark:text-amber-300">
			Notifications are blocked for this site. You will need to allow them in your browser
			settings.
		</p>
	{:else}
		<button
			class="mt-2 rounded border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
			disabled={busy}
			onclick={toggleNotifications}
		>
			{notifications === 'on' ? 'Turn notifications off' : 'Turn notifications on'}
		</button>
		{#if notifications === 'on'}
			<span class="ml-2 text-sm text-green-700 dark:text-green-400">on for this device</span>
		{/if}
	{/if}

	{#if pushError}
		<p class="mt-2 text-sm text-red-700 dark:text-red-400">{pushError}</p>
	{/if}
</section>

<section class="mt-10">
	<h2 class="font-medium">What your time is worth</h2>
	<p class="mt-1 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
		Effective and projected hourly rates, in euros whatever the fee was agreed in, live on
		<a class="underline" href="/projects">the projects page</a> — next to the fee and currency
		they are calculated from. Keeping one table rather than two is why the numbers agree.
	</p>
</section>

<section class="mt-10 mb-16">
	<h2 class="font-medium">Recurring admin</h2>
	<p class="mt-1 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
		Invoicing at the end of each month, and the URSSAF declaration at the end of the month
		following each quarter. Added as ordinary tasks so they compete for capacity like everything
		else — admin that lives outside the plan is admin that happens at 23:00 on the deadline.
	</p>

	<ul class="mt-2 space-y-1 text-sm">
		{#each data.upcomingAdmin as item (item.title)}
			<li>
				<span class="font-mono text-xs text-neutral-500 dark:text-neutral-400">{day(item.deadline)}</span>
				{item.title}
				<span class="text-xs text-neutral-400 dark:text-neutral-500">{item.estimateHours}h</span>
			</li>
		{/each}
	</ul>

	<form method="POST" action="?/generateAdmin" class="mt-3">
		<button class="rounded border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">
			Add these to my tasks
		</button>
	</form>
</section>
