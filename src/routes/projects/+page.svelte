<script lang="ts">
	import { formatInTimeZone } from 'date-fns-tz';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let editing = $state<string | null>(null);

	const forInput = (date: Date | string | null) =>
		date ? formatInTimeZone(new Date(date), data.timezone, 'yyyy-MM-dd') : '';
	const day = (date: Date | string | null) =>
		date ? formatInTimeZone(new Date(date), data.timezone, 'd MMM yyyy') : '—';

	// Derived, not captured once: the max date on the rate picker must still be
	// right if the page is left open across midnight.
	const today = $derived(formatInTimeZone(new Date(), data.timezone, 'yyyy-MM-dd'));
</script>

<h1 class="text-xl font-semibold">Projects</h1>
<p class="mt-1 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
	Fees can be agreed in any currency. Everything is converted to euros at a rate you fix, so the
	hourly rate you compare jobs on is always in the money you actually bank.
</p>

{#if form?.message}
	<p class="mt-3 rounded bg-neutral-100 dark:bg-neutral-800 p-2 text-sm text-neutral-700 dark:text-neutral-300">{form.message}</p>
{/if}

<table class="mt-4 w-full text-sm">
	<thead class="text-left text-xs text-neutral-500 dark:text-neutral-400">
		<tr>
			<th class="py-1">Project</th>
			<th>Fee</th>
			<th>Worked</th>
			<th>Effective</th>
			<th>Projected</th>
			<th>Status</th>
			<th></th>
		</tr>
	</thead>
	<tbody>
		{#each data.projects as project (project.projectId)}
			<tr class="border-t border-neutral-200 dark:border-neutral-800 align-top">
				<td class="py-2">
					<span
						class="mr-1 inline-block h-2 w-2 rounded-full align-middle"
						style="background:{project.color}"
					></span>
					{project.name}
					{#if project.clientName}
						<span class="text-xs text-neutral-400 dark:text-neutral-500">{project.clientName}</span>
					{/if}
					{#if project.deadline}
						<span class="block text-xs text-neutral-500 dark:text-neutral-400">due {day(project.deadline)}</span>
					{/if}
				</td>

				<td class="py-2">
					{#if project.feeFormatted}
						{project.feeFormatted}
						{#if project.currency !== 'EUR'}
							{#if project.feeEur !== null}
								<span class="block text-xs text-neutral-500 dark:text-neutral-400">
									≈ {project.feeEur.toLocaleString('fr-FR')} EUR
								</span>
								<span class="block text-xs text-neutral-400 dark:text-neutral-500">
									@ {project.fxRateToEur} · {project.fxRateAt}
								</span>
							{:else}
								<span class="block text-xs text-amber-700 dark:text-amber-400">no rate yet</span>
							{/if}
						{/if}
					{:else}
						—
					{/if}
				</td>

				<td class="py-2">
					{project.actualHours}h
					{#if project.plannedHours > 0}
						<span class="block text-xs text-neutral-400 dark:text-neutral-500">+{project.plannedHours}h planned</span>
					{/if}
					{#if project.overrunHours !== null && project.overrunHours > 0}
						<span class="block text-xs text-red-700 dark:text-red-400">
							{project.overrunHours}h over the {project.agreedHours}h agreed
						</span>
					{/if}
				</td>

				<td class="py-2">
					{project.effectiveRateEur !== null ? project.effectiveRateEur + ' €/h' : '—'}
				</td>
				<td class="py-2">
					{project.projectedRateEur !== null ? project.projectedRateEur + ' €/h' : '—'}
				</td>
				<td class="py-2 text-xs text-neutral-500 dark:text-neutral-400">{project.status}</td>

				<td class="py-2 text-right">
					<button
						class="text-xs underline"
						onclick={() => (editing = editing === project.projectId ? null : project.projectId)}
					>
						{editing === project.projectId ? 'close' : 'edit'}
					</button>
				</td>
			</tr>

			{#if editing === project.projectId}
				<tr class="border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
					<td colspan="7" class="p-3">
						<form method="POST" action="?/update" class="flex flex-wrap items-end gap-3">
							<input type="hidden" name="projectId" value={project.projectId} />

							<label class="block">
								<span class="text-xs text-neutral-500 dark:text-neutral-400">Name</span>
								<input
									name="name"
									value={project.name}
									class="mt-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
								/>
							</label>
							<label class="block">
								<span class="text-xs text-neutral-500 dark:text-neutral-400">Client</span>
								<input
									name="clientName"
									value={project.clientName ?? ''}
									class="mt-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
								/>
							</label>
							<label class="block">
								<span class="text-xs text-neutral-500 dark:text-neutral-400">Agreed fee</span>
								<input
									name="agreedFee"
									type="number"
									step="0.01"
									value={project.agreedFee ?? ''}
									class="mt-1 w-28 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
								/>
							</label>
							<label class="block">
								<span class="text-xs text-neutral-500 dark:text-neutral-400">Currency</span>
								<select
									name="currency"
									class="mt-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
								>
									{#each data.currencies as code (code)}
										<option value={code} selected={project.currency === code}>{code}</option>
									{/each}
								</select>
							</label>
							<label class="block">
								<span class="text-xs text-neutral-500 dark:text-neutral-400">Agreed hours</span>
								<input
									name="agreedHours"
									type="number"
									step="0.5"
									value={project.agreedHours ?? ''}
									class="mt-1 w-24 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
								/>
							</label>
							<label class="block">
								<span class="text-xs text-neutral-500 dark:text-neutral-400">Deadline</span>
								<input
									name="deadline"
									type="date"
									value={forInput(project.deadline)}
									class="mt-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
								/>
							</label>
							<label class="block">
								<span class="text-xs text-neutral-500 dark:text-neutral-400">Colour</span>
								<input
									name="color"
									type="color"
									value={project.color}
									class="mt-1 h-8 w-14 rounded border border-neutral-300 dark:border-neutral-700"
								/>
							</label>
							<label class="block">
								<span class="text-xs text-neutral-500 dark:text-neutral-400">Status</span>
								<select
									name="status"
									class="mt-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
								>
									{#each ['active', 'waiting', 'done', 'archived'] as status (status)}
										<option value={status} selected={project.status === status}>{status}</option>
									{/each}
								</select>
							</label>
							<label class="block">
								<span class="text-xs text-neutral-500 dark:text-neutral-400">Rate to EUR (optional)</span>
								<input
									name="fxRateToEur"
									type="number"
									step="0.000001"
									placeholder={project.currency === 'EUR' ? 'n/a' : 'or fetch below'}
									value={project.fxRateAt === 'entered by hand' ? (project.fxRateToEur ?? '') : ''}
									class="mt-1 w-32 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
								/>
							</label>

							<button class="rounded bg-neutral-900 dark:bg-neutral-100 px-3 py-1.5 text-sm text-white dark:text-neutral-900">Save</button>
						</form>

						{#if project.currency !== 'EUR'}
							<form method="POST" action="?/refreshRate" class="mt-3 flex flex-wrap items-end gap-2">
								<input type="hidden" name="projectId" value={project.projectId} />
								<label class="block">
									<span class="text-xs text-neutral-500 dark:text-neutral-400">Rate on date</span>
									<input
										name="onDate"
										type="date"
										max={today}
										class="mt-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
									/>
								</label>
								<button class="rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm">
									Fetch ECB rate
								</button>
								<span class="text-xs text-neutral-500 dark:text-neutral-400">
									Leave the date blank for today's. Use your invoice date to freeze the rate the
									books should use.
								</span>
							</form>
						{/if}
					</td>
				</tr>
			{/if}
		{/each}
	</tbody>
</table>

<form method="POST" action="?/create" class="mt-6 flex flex-wrap items-end gap-2">
	<label class="block">
		<span class="text-xs text-neutral-500 dark:text-neutral-400">New project</span>
		<input name="name" class="mt-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm" />
	</label>
	<label class="block">
		<span class="text-xs text-neutral-500 dark:text-neutral-400">Client</span>
		<input name="clientName" class="mt-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm" />
	</label>
	<button class="rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm">Add</button>
</form>

<p class="mt-6 max-w-2xl text-xs text-neutral-500 dark:text-neutral-400">
	Rates are the European Central Bank's daily reference rates. Expect a percent or two of
	difference from what your bank actually gives you after fees — good enough to judge whether a job
	was worth taking, not a substitute for the figure on your statement.
</p>
