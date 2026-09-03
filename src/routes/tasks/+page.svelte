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
		<button class="text-sm underline hover:text-neutral-900">Replan now</button>
	</form>
</div>

{#if form?.message}
	<p class="mt-2 rounded bg-neutral-100 p-2 text-xs text-neutral-700">{form.message}</p>
{/if}

{#if data.tasks.length === 0}
	<p class="mt-6 text-sm text-neutral-500">
		Nothing captured yet. <a class="underline" href="/add">Add a task</a>.
	</p>
{:else}
	<table class="mt-4 w-full text-sm">
		<thead class="text-left text-xs text-neutral-500">
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
				<tr class="border-t border-neutral-200 align-top">
					<td class="py-2">
						{#if task.projectName}
							<span class="text-neutral-500">[{task.projectName}]</span>
						{/if}
						{task.title}
						<span class="ml-1 text-xs text-neutral-400">{task.kind}</span>
						{#if task.source === 'calendar'}
							<span
								class="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800"
								title="Adopted from your Google Calendar. Its time is fixed there, so the scheduler leaves it alone."
							>
								from calendar
							</span>
						{/if}
						{#if task.waitingReason}
							<span class="block text-xs text-amber-700">waiting: {task.waitingReason}</span>
						{/if}
					</td>

					<td class="py-2">
						<!-- Raw and calibrated side by side, always (§6). -->
						{#if task.inferred}
							<span class="text-neutral-500">{task.effectiveHours}h</span>
							<span class="block text-xs text-neutral-400">inferred from past work</span>
						{:else if task.multiplier !== 1}
							<span>{task.rawHours}h</span>
							<span class="block text-xs text-amber-700">
								scheduled as {task.effectiveHours}h (×{task.multiplier})
							</span>
						{:else}
							<span>{task.rawHours}h</span>
						{/if}
						{#if task.hoursAlreadyDone > 0}
							<span class="block text-xs text-neutral-400">{task.hoursAlreadyDone}h done</span>
						{/if}
					</td>

					<td class="py-2">
						{task.plannedHours}h
						{#if task.source === 'calendar'}
							<span class="block text-xs text-neutral-400">fixed in your calendar</span>
						{/if}
						{#if task.source !== 'calendar' && task.status !== 'waiting' && task.plannedHours + task.hoursAlreadyDone < task.effectiveHours - 0.01}
							<span class="block text-xs text-red-700">
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
								class="rounded border border-neutral-300 px-1 py-0.5 text-xs"
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
					<tr class="border-t border-neutral-100 bg-neutral-50">
						<td colspan="6" class="p-3">
							<form method="POST" action="?/update" class="flex flex-wrap items-end gap-3">
								<input type="hidden" name="taskId" value={task.id} />
								<label class="block">
									<span class="text-xs text-neutral-500">Title</span>
									<input
										name="title"
										value={task.title}
										class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"
									/>
								</label>
								<label class="block">
									<span class="text-xs text-neutral-500">Estimate (h)</span>
									<input
										name="estimateHours"
										type="number"
										step="0.25"
										value={task.rawHours ?? ''}
										class="mt-1 w-24 rounded border border-neutral-300 px-2 py-1 text-sm"
									/>
								</label>
								<label class="block">
									<span class="text-xs text-neutral-500">Deadline</span>
									<input
										name="deadline"
										type="datetime-local"
										value={forInput(task.deadline)}
										class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"
									/>
								</label>
								<label class="block">
									<span class="text-xs text-neutral-500">Project</span>
									<select
										name="projectId"
										class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"
									>
										<option value="">none</option>
										{#each data.projects as project (project.id)}
											<option value={project.id} selected={task.projectName === project.name}>
												{project.name}
											</option>
										{/each}
									</select>
								</label>
								<button class="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">Save</button>
							</form>
							<form method="POST" action="?/remove" class="mt-2">
								<input type="hidden" name="taskId" value={task.id} />
								<button class="text-xs text-red-700 underline">Delete this task</button>
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
	<ul class="mt-2 space-y-1 text-sm">
		{#each data.projects as project (project.id)}
			<li class="flex items-center gap-2">
				<span>{project.name}</span>
				<span class="text-xs text-neutral-400">{project.status}</span>
				<form method="POST" action="?/archiveProject">
					<input type="hidden" name="projectId" value={project.id} />
					<button class="text-xs underline text-neutral-500">archive</button>
				</form>
			</li>
		{/each}
	</ul>

	<form method="POST" action="?/createProject" class="mt-3 flex flex-wrap items-end gap-2">
		<label class="block">
			<span class="text-xs text-neutral-500">New project</span>
			<input name="name" class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm" />
		</label>
		<label class="block">
			<span class="text-xs text-neutral-500">Client</span>
			<input name="clientName" class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm" />
		</label>
		<label class="block">
			<span class="text-xs text-neutral-500">Agreed fee (€)</span>
			<input
				name="agreedFee"
				type="number"
				step="1"
				class="mt-1 w-28 rounded border border-neutral-300 px-2 py-1 text-sm"
			/>
		</label>
		<button class="rounded border border-neutral-300 px-3 py-1.5 text-sm">Add</button>
	</form>
</section>
