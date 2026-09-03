<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<h1 class="text-xl font-semibold">Settings</h1>

{#if form?.message}
	<p class="mt-2 rounded bg-green-50 p-2 text-sm text-green-800">{form.message}</p>
{/if}

<form method="POST" action="?/saveHours" class="mt-4">
	<h2 class="font-medium">Working hours</h2>
	<p class="mt-1 text-sm text-neutral-600">
		The capacity everything else is measured against. Marking a slot for a kind of work is a
		preference, not a rule — the scheduler will use an unmarked slot rather than miss a deadline.
	</p>

	<table class="mt-3 text-sm">
		<thead class="text-left text-xs text-neutral-500">
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
				<tr class="border-t border-neutral-100">
					<td class="py-1.5 pr-4">{day.name}</td>
					{#each [0, 1] as slot (slot)}
						<td class="py-1.5 pr-2">
							<input
								type="time"
								name="d{day.dayOfWeek}-s{slot}-start"
								value={day.intervals[slot]?.start ?? ''}
								class="rounded border border-neutral-300 px-1 py-0.5"
							/>
							<input
								type="time"
								name="d{day.dayOfWeek}-s{slot}-end"
								value={day.intervals[slot]?.end ?? ''}
								class="rounded border border-neutral-300 px-1 py-0.5"
							/>
						</td>
						<td class="py-1.5 pr-4">
							<select
								name="d{day.dayOfWeek}-s{slot}-kind"
								class="rounded border border-neutral-300 px-1 py-0.5 text-xs"
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
			<span class="text-xs text-neutral-500">Timezone</span>
			<input
				name="timezone"
				value={data.settings.timezone}
				class="mt-1 rounded border border-neutral-300 px-2 py-1"
			/>
		</label>
		<label class="block text-sm">
			<span class="text-xs text-neutral-500">Planning horizon (days)</span>
			<input
				name="horizonDays"
				type="number"
				min="1"
				max="90"
				value={data.settings.horizonDays}
				class="mt-1 w-24 rounded border border-neutral-300 px-2 py-1"
			/>
		</label>
		<button class="rounded bg-neutral-900 px-3 py-2 text-sm text-white">Save and replan</button>
	</div>
</form>

<section class="mt-10">
	<h2 class="font-medium">Calibration</h2>
	<p class="mt-1 max-w-2xl text-sm text-neutral-600">
		How far your estimates are from reality, learned from confirmed blocks. Below five samples the
		multiplier stays at 1.0 — the app will not adjust your estimates on evidence it does not have.
	</p>
	<table class="mt-3 text-sm">
		<thead class="text-left text-xs text-neutral-500">
			<tr><th class="py-1 pr-6">Kind</th><th class="pr-6">Multiplier</th><th class="pr-6">Samples</th><th>Median actual</th></tr>
		</thead>
		<tbody>
			{#each data.calibration as row (row.kind)}
				<tr class="border-t border-neutral-100">
					<td class="py-1.5 pr-6">{row.kind}</td>
					<td class="pr-6">
						×{row.multiplier}
						{#if row.sampleCount < 5}
							<span class="text-xs text-neutral-400">(not yet applied)</span>
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
	<p class="mt-1 text-sm text-neutral-600">
		{#if data.settings.targetCalendarId}
			Writing to <code class="text-xs">Planned work</code>. No other calendar is ever written to.
		{:else}
			Not connected yet — the calendar is created on the first replan.
		{/if}
	</p>
	<a class="mt-2 inline-block text-sm underline" href="/debug/calendar">Run the safety check</a>
</section>
