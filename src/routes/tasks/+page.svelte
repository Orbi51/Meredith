<script lang="ts">
	import { formatInTimeZone } from 'date-fns-tz';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const day = (value: Date | string | null) =>
		value ? formatInTimeZone(new Date(value), data.timezone, 'EEE d MMM HH:mm') : '—';

	let editing = $state<string | null>(null);

	function forInput(date: Date | string | null): string {
		if (!date) return '';
		return formatInTimeZone(new Date(date), data.timezone, "yyyy-MM-dd'T'HH:mm");
	}
</script>

<div class="flex items-baseline justify-between">
	<h1 class="text-xl font-semibold">Tasks</h1>
	<form method="POST" action="?/replan">
		<button class="text-sm underline hover:text-neutral-900 dark:hover:text-neutral-100">Replan now</button>
	</form>
</div>

{#if form?.message}
	<p class="mt-2 rounded bg-neutral-100 dark:bg-neutral-800 p-2 text-xs text-neutral-700 dark:text-neutral-300">{form.message}</p>
{/if}

{#if data.tasks.length === 0}
	<p class="mt-6 text-sm text-neutral-500 dark:text-neutral-400">
		Nothing captured yet. <a class="underline" href="/add">Add a task</a>.
	</p>
{:else}
	<table class="mt-4 w-full text-sm">
		<thead class="text-left text-xs text-neutral-500 dark:text-neutral-400">
			<tr>
				<th class="py-1">Task</th>
				<th>Estimate</th>
				<th>Planned</th>
				<th>Deadline</th>
				<th>Status</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			{#each data.tasks as task (task.id)}
				<tr class="border-t border-neutral-200 dark:border-neutral-800 align-top">
					<td class="py-2">
						{#if task.projectColor}
							<span
								class="mr-1 inline-block h-2 w-2 rounded-full align-middle"
								style="background:{task.projectColor}"
							></span>
						{/if}
						{#if task.projectName}
							<span class="text-neutral-500 dark:text-neutral-400">[{task.projectName}]</span>
						{/if}
						{task.title}
						<span class="ml-1 text-xs text-neutral-400 dark:text-neutral-500">{task.kind}</span>
						{#if task.source === 'calendar'}
							<span
								class="ml-1 rounded bg-sky-100 dark:bg-sky-900 px-1.5 py-0.5 text-xs text-sky-800 dark:text-sky-300"
								title="Adopted from your Google Calendar. Its time is fixed there, so the scheduler leaves it alone."
							>
								from calendar
							</span>
						{/if}
						{#if task.waitingReason}
							<span class="block text-xs text-amber-700 dark:text-amber-400">waiting: {task.waitingReason}</span>
						{/if}
					</td>

					<td class="py-2">
						<!-- Raw and calibrated side by side, always (§6). -->
						{#if task.inferred}
							<span class="text-neutral-500 dark:text-neutral-400">{task.effectiveHours}h</span>
							<span class="block text-xs text-neutral-400 dark:text-neutral-500">inferred from past work</span>
						{:else if task.multiplier !== 1}
							<span>{task.rawHours}h</span>
							<span class="block text-xs text-amber-700 dark:text-amber-400">
								scheduled as {task.effectiveHours}h (×{task.multiplier})
							</span>
						{:else}
							<span>{task.rawHours}h</span>
						{/if}
						{#if task.hoursAlreadyDone > 0}
							<span class="block text-xs text-neutral-400 dark:text-neutral-500">{task.hoursAlreadyDone}h done</span>
						{/if}
					</td>

					<td class="py-2">
						{task.plannedHours}h
						{#if task.source === 'calendar'}
							<span class="block text-xs text-neutral-400 dark:text-neutral-500">fixed in your calendar</span>
						{/if}
						{#if task.source !== 'calendar' && task.status !== 'waiting' && task.plannedHours + task.hoursAlreadyDone < task.effectiveHours - 0.01}
							<span class="block text-xs text-red-700 dark:text-red-400">
								{Math.round((task.effectiveHours - task.plannedHours - task.hoursAlreadyDone) * 100) /
									100}h unplaced
							</span>
						{/if}
					</td>

					<td class="py-2">{day(task.deadline)}</td>

					<td class="py-2">
						<form method="POST" action="?/setStatus" class="flex items-center gap-1">
							<input type="hidden" name="taskId" value={task.id} />
							<select
								name="status"
								class="rounded border border-neutral-300 dark:border-neutral-700 px-1 py-0.5 text-xs"
								onchange={(e) => e.currentTarget.form?.requestSubmit()}
							>
								{#each ['inbox', 'active', 'waiting', 'done'] as status (status)}
									<option value={status} selected={task.status === status}>{status}</option>
								{/each}
							</select>
						</form>
					</td>

					<td class="py-2 text-right">
						{#if task.source === 'calendar'}
							<form method="POST" action="?/dismiss">
								<input type="hidden" name="taskId" value={task.id} />
								<button class="text-xs underline" title="Removes it here only — the calendar event stays">
									remove
								</button>
							</form>
						{:else}
							<button
								class="text-xs underline"
								onclick={() => (editing = editing === task.id ? null : task.id)}
							>
								{editing === task.id ? 'close' : 'edit'}
							</button>
						{/if}
					</td>
				</tr>

				{#if editing === task.id}
					<tr class="border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
						<td colspan="6" class="p-3">
							<form method="POST" action="?/update" class="flex flex-wrap items-end gap-3">
								<input type="hidden" name="taskId" value={task.id} />
								<label class="block">
									<span class="text-xs text-neutral-500 dark:text-neutral-400">Title</span>
									<input
										name="title"
										value={task.title}
										class="mt-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
									/>
								</label>
								<label class="block">
									<span class="text-xs text-neutral-500 dark:text-neutral-400">Estimate (h)</span>
									<input
										name="estimateHours"
										type="number"
										step="0.25"
										value={task.rawHours ?? ''}
										class="mt-1 w-24 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
									/>
								</label>
								<label class="block">
									<span class="text-xs text-neutral-500 dark:text-neutral-400">Deadline</span>
									<input
										name="deadline"
										type="datetime-local"
										value={forInput(task.deadline)}
										class="mt-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
									/>
								</label>
								<label class="block">
									<span class="text-xs text-neutral-500 dark:text-neutral-400">Project</span>
									<select
										name="projectId"
										class="mt-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
									>
										<option value="">none</option>
										{#each data.projects as project (project.id)}
											<option value={project.id} selected={task.projectName === project.name}>
												{project.name}
											</option>
										{/each}
									</select>
								</label>

								<label class="block">
									<span class="text-xs text-neutral-500 dark:text-neutral-400">Not before</span>
									<input
										name="earliestStart"
										type="datetime-local"
										value={forInput(task.earliestStart)}
										class="mt-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
										title="The scheduler will not place this task before this moment — waiting on an asset, a brief, a delivery."
									/>
								</label>

								<label class="block">
									<span class="text-xs text-neutral-500 dark:text-neutral-400">Wait for</span>
									<select
										name="dependsOnTaskId"
										class="mt-1 max-w-56 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
										title="This task will never be placed before the one it waits for has finished."
									>
										<option value="">nothing</option>
										{#each data.tasks.filter((other) => other.id !== task.id) as other (other.id)}
											<option value={other.id} selected={task.dependsOnTaskId === other.id}>
												{other.title}
											</option>
										{/each}
									</select>
								</label>

								<label class="block">
									<span class="text-xs text-neutral-500 dark:text-neutral-400">Smallest useful block</span>
									<select
										name="minBlockMinutes"
										class="mt-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
										title="A scheduler that chops modelling into 25-minute fragments produces a calendar that looks full and achieves nothing."
									>
										{#each [30, 60, 90, 120, 180, 240] as minutes (minutes)}
											<option value={minutes} selected={task.minBlockMinutes === minutes}>
												{minutes < 60 ? minutes + ' min' : minutes / 60 + 'h'}
											</option>
										{/each}
									</select>
								</label>

								<label class="flex items-center gap-2 pb-1 text-sm">
									<input type="checkbox" name="splittable" checked={task.splittable} />
									<span title="Unticked, this task needs one unbroken stretch big enough for all of it.">
										can be split
									</span>
								</label>

								<label class="block">
									<span class="text-xs text-neutral-500 dark:text-neutral-400">Waiting on</span>
									<input
										name="waitingReason"
										value={task.waitingReason ?? ''}
										placeholder="client feedback"
										class="mt-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-sm"
									/>
								</label>

								<button class="rounded bg-neutral-900 dark:bg-neutral-100 px-3 py-1.5 text-sm text-white dark:text-neutral-900">Save</button>
							</form>
							<form method="POST" action="?/remove" class="mt-2">
								<input type="hidden" name="taskId" value={task.id} />
								<button class="text-xs text-red-700 dark:text-red-400 underline">Delete this task</button>
							</form>
						</td>
					</tr>
				{/if}
			{/each}
		</tbody>
	</table>
{/if}

<section class="mt-10">
	<h2 class="font-medium">Projects</h2>
	<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
		Fees, currencies, agreed hours and hourly rates live on
		<a class="underline" href="/projects">the projects page</a>.
	</p>
	<ul class="mt-2 flex flex-wrap gap-3 text-sm">
		{#each data.projects as project (project.id)}
			<li class="text-neutral-600 dark:text-neutral-400">{project.name}</li>
		{/each}
	</ul>
</section>
