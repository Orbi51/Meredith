<script lang="ts">
	import { formatInTimeZone } from 'date-fns-tz';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/** datetime-local wants "YYYY-MM-DDTHH:mm" in the user's own timezone. */
	function forInput(date: Date | string | null): string {
		if (!date) return '';
		return formatInTimeZone(new Date(date), data.timezone, "yyyy-MM-dd'T'HH:mm");
	}
</script>

<h1 class="text-xl font-semibold">Capture</h1>

{#if !data.parsed}
	<form method="GET" class="mt-4 flex gap-2">
		<!-- svelte-ignore a11y_autofocus -->
		<!-- Deliberate: this is the capture field, and capture must cost nothing. -->
		<input
			name="text"
			value={data.text}
			placeholder="storyboard rev2 Studio X ~6h friday"
			class="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
			autofocus
		/>
		<button class="rounded bg-neutral-900 px-3 py-2 text-sm text-white">Parse</button>
	</form>
	<p class="mt-2 text-xs text-neutral-500">
		Type it however you like. Nothing is mandatory — a title on its own is a valid task.
	</p>
{:else}
	<p class="mt-2 text-sm text-neutral-500">
		From: <span class="font-mono">{data.text}</span>
		<a class="ml-2 underline" href="/add">start over</a>
	</p>

	{#if data.parsed.note}
		<p class="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-800">{data.parsed.note}</p>
	{/if}

	<form method="POST" action="?/save" class="mt-4 max-w-xl space-y-3">
		<label class="block">
			<span class="text-xs text-neutral-500">Title</span>
			<input
				name="title"
				value={data.parsed.title}
				class="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
			/>
		</label>

		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="text-xs text-neutral-500">Estimate (hours)</span>
				<input
					name="estimateHours"
					type="number"
					step="0.25"
					min="0"
					value={data.parsed.estimateHours ?? ''}
					placeholder="leave blank to infer"
					class="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
				/>
			</label>

			<label class="block">
				<span class="text-xs text-neutral-500">Kind</span>
				<select
					name="kind"
					class="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
				>
					<option value="creative" selected={data.parsed.kind === 'creative'}>
						creative (2h blocks)
					</option>
					<option value="admin" selected={data.parsed.kind === 'admin'}>admin (30m blocks)</option>
					<option value="machine" selected={data.parsed.kind === 'machine'}>
						machine (runs unattended)
					</option>
				</select>
			</label>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="text-xs text-neutral-500">Deadline</span>
				<input
					name="deadline"
					type="datetime-local"
					value={forInput(data.parsed.deadline)}
					class="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
				/>
			</label>

			<label class="block">
				<span class="text-xs text-neutral-500">Project</span>
				<select
					name="projectId"
					class="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
				>
					<option value="">none</option>
					{#each data.projects as project (project.id)}
						<option value={project.id} selected={data.parsed.projectId === project.id}>
							{project.name}
						</option>
					{/each}
				</select>
			</label>
		</div>

		{#if data.parsed.unmatchedProjectName}
			<!-- A name we could not match. Offered, never assumed. -->
			<label class="flex items-center gap-2 rounded bg-neutral-100 p-3 text-sm">
				<input type="checkbox" name="createProject" />
				<input type="hidden" name="newProjectName" value={data.parsed.unmatchedProjectName} />
				<span>
					Create a new project called
					<strong>{data.parsed.unmatchedProjectName}</strong>?
				</span>
			</label>
		{/if}

		<label class="block">
			<span class="text-xs text-neutral-500">Notes</span>
			<textarea
				name="notes"
				rows="2"
				class="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
			></textarea>
		</label>

		{#if form?.message}
			<p class="text-sm text-red-700">{form.message}</p>
		{/if}

		<button class="rounded bg-neutral-900 px-3 py-2 text-sm text-white">Save and replan</button>
	</form>
{/if}
