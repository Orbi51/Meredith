/**
 * Turning "storyboard rev2 Studio X ~6h friday" into a structured task.
 *
 * The governing rule from §8: **never reject input**. If the model is
 * unavailable, slow, confused, or returns nonsense, the text becomes a
 * title-only task in the inbox. A capture that fails is a capture the user
 * stops making, and then the app dies.
 *
 * The API key is server-side only and must never reach the client.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import { formatInTimeZone } from 'date-fns-tz';
import type { TaskKind } from '$lib/scheduler/types';

export type ParsedTask = {
	title: string;
	/** Matched against an existing project. Never silently creates one. */
	projectId: string | null;
	/** The project name the model believed it saw, when nothing matched. */
	unmatchedProjectName: string | null;
	estimateHours: number | null;
	deadline: Date | null;
	kind: TaskKind;
	/** False when we fell back to a title-only task. */
	parsed: boolean;
	/** Shown to the user so a misparse costs one click, not an edit screen. */
	note: string | null;
};

export type ProjectChoice = { id: string; name: string; clientName: string | null };

const MODEL = 'claude-sonnet-5';

/** A task with only a title is valid and schedulable. This is the safety net. */
function titleOnly(text: string, note: string | null = null): ParsedTask {
	return {
		title: text.trim().slice(0, 200) || 'Untitled task',
		projectId: null,
		unmatchedProjectName: null,
		estimateHours: null,
		deadline: null,
		kind: 'creative',
		parsed: false,
		note
	};
}

export async function parseQuickAdd(
	text: string,
	options: { projects: ProjectChoice[]; timezone: string; now: Date }
): Promise<ParsedTask> {
	if (!text.trim()) return titleOnly('');
	if (!env.ANTHROPIC_API_KEY) {
		return titleOnly(text, 'Saved as-is — no ANTHROPIC_API_KEY configured.');
	}

	try {
		const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
		const localNow = formatInTimeZone(options.now, options.timezone, "EEEE d MMMM yyyy, HH:mm");

		const response = await client.messages.create({
			model: MODEL,
			max_tokens: 400,
			system:
				'You extract structured task data from a freelance 3D/CG artist\'s shorthand. ' +
				'Reply with a single JSON object and nothing else. Never invent detail that is ' +
				'not present or clearly implied.',
			messages: [
				{
					role: 'user',
					content: buildPrompt(text, options.projects, localNow, options.timezone)
				}
			],
			tools: [
				{
					name: 'record_task',
					description: 'Record the structured form of the captured task.',
					input_schema: {
						type: 'object',
						properties: {
							title: {
								type: 'string',
								description:
									'The task itself, with the project name, estimate and date removed.'
							},
							project_name: {
								type: ['string', 'null'],
								description: 'Project or client mentioned, verbatim. Null if none.'
							},
							estimate_hours: {
								type: ['number', 'null'],
								description: 'Estimate in hours. "~6h" is 6, "half a day" is 4. Null if absent.'
							},
							deadline_iso: {
								type: ['string', 'null'],
								description:
									'Deadline as an ISO 8601 datetime with offset, resolved against the ' +
									'current date. Null if no date is mentioned.'
							},
							kind: {
								type: 'string',
								enum: ['creative', 'admin', 'machine'],
								description:
									'creative = modelling, lookdev, animation. admin = invoicing, email, ' +
									'planning. machine = renders and bakes that run unattended.'
							}
						},
						required: ['title', 'kind']
					}
				}
			],
			tool_choice: { type: 'tool', name: 'record_task' }
		});

		const toolUse = response.content.find((block) => block.type === 'tool_use');
		if (!toolUse || toolUse.type !== 'tool_use') {
			return titleOnly(text, 'Could not read the parse result — saved as a plain task.');
		}

		return fromToolInput(toolUse.input as Record<string, unknown>, text, options.projects);
	} catch (error) {
		// Network trouble, rate limit, bad key — none of it is the user's problem.
		return titleOnly(
			text,
			`Saved as-is — parsing failed (${error instanceof Error ? error.message : 'unknown error'}).`
		);
	}
}

function buildPrompt(
	text: string,
	projects: ProjectChoice[],
	localNow: string,
	timezone: string
): string {
	const projectList =
		projects.length > 0
			? projects
					.map((p) => `- ${p.name}${p.clientName ? ` (client: ${p.clientName})` : ''}`)
					.join('\n')
			: '(none yet)';

	return [
		`Current date and time: ${localNow} (${timezone}).`,
		'',
		'Existing projects:',
		projectList,
		'',
		'Capture this task:',
		text,
		'',
		'Notes:',
		'- A bare weekday such as "friday" means the next occurrence of that day.',
		'- Times default to the end of the working day (18:00) when only a date is given.',
		'- If no project is mentioned, project_name must be null. Do not guess.',
		'- The title must read naturally on its own.'
	].join('\n');
}

function fromToolInput(
	input: Record<string, unknown>,
	original: string,
	projects: ProjectChoice[]
): ParsedTask {
	const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : original.trim();

	const kind: TaskKind =
		input.kind === 'admin' || input.kind === 'machine' || input.kind === 'creative'
			? input.kind
			: 'creative';

	const estimateHours =
		typeof input.estimate_hours === 'number' && input.estimate_hours > 0
			? input.estimate_hours
			: null;

	let deadline: Date | null = null;
	if (typeof input.deadline_iso === 'string') {
		const candidate = new Date(input.deadline_iso);
		if (!Number.isNaN(candidate.getTime())) deadline = candidate;
	}

	const projectName = typeof input.project_name === 'string' ? input.project_name : null;
	const match = projectName ? matchProject(projectName, projects) : null;

	return {
		title: title.slice(0, 200),
		projectId: match?.id ?? null,
		// A name we could not match is offered as a confirmable chip — §8 forbids
		// silently creating a project the user never asked for.
		unmatchedProjectName: projectName && !match ? projectName : null,
		estimateHours,
		deadline,
		kind,
		parsed: true,
		note: null
	};
}

/**
 * Fuzzy project matching: exact, then case-insensitive, then substring either
 * way. Deliberately conservative — a wrong project is worse than none, because
 * the user will not notice it.
 */
export function matchProject(name: string, projects: ProjectChoice[]): ProjectChoice | null {
	const needle = name.trim().toLowerCase();
	if (!needle) return null;

	const exact = projects.find((p) => p.name.toLowerCase() === needle);
	if (exact) return exact;

	const byClient = projects.find((p) => p.clientName?.toLowerCase() === needle);
	if (byClient) return byClient;

	const contains = projects.filter(
		(p) => p.name.toLowerCase().includes(needle) || needle.includes(p.name.toLowerCase())
	);
	// Only when it is unambiguous. Two candidates means we do not know.
	return contains.length === 1 ? (contains[0] as ProjectChoice) : null;
}
