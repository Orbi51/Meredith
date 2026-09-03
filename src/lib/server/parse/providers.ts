/**
 * Where the language model comes from, if there is one at all.
 *
 * Three options, chosen with LLM_PROVIDER:
 *
 *   `none`       — no model. Capture is handled entirely by the deterministic
 *                  parser. The app is fully usable, and free.
 *   `ollama`     — a local model over Ollama's HTTP API. Also free, and
 *                  nothing leaves the machine.
 *   `anthropic`  — the hosted API. Best quality on the fuzzy parts.
 *
 * The model is only ever asked for the two things code is bad at: tidying the
 * title and spotting a project name. Dates, durations and kind are extracted
 * deterministically before the model is consulted, because models get those
 * wrong (see `deterministic.ts`).
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';

export type LlmRequest = {
	/** The original captured text. */
	text: string;
	/** The title the deterministic parser arrived at, as a starting point. */
	draftTitle: string;
	projectNames: string[];
};

export type LlmResponse = {
	title: string | null;
	projectName: string | null;
};

export type ProviderName = 'none' | 'ollama' | 'anthropic';

export function activeProvider(): ProviderName {
	const configured = (env.LLM_PROVIDER ?? '').toLowerCase();
	if (configured === 'none') return 'none';
	if (configured === 'ollama') return 'ollama';
	if (configured === 'anthropic') return 'anthropic';

	// Nothing configured: use the hosted API if there is a key, otherwise do
	// without. Never fail because a model is missing.
	return env.ANTHROPIC_API_KEY ? 'anthropic' : 'none';
}

const SYSTEM =
	'You tidy up short task notes written by a freelance 3D/CG artist. ' +
	'You do exactly two things: give the task a clean title, and say which ' +
	'project it belongs to. You never invent a project that is not listed, and ' +
	'you never put dates, durations or project names into the title.';

function userPrompt(request: LlmRequest): string {
	return [
		`Projects that exist: ${request.projectNames.length ? request.projectNames.join(', ') : '(none)'}`,
		'',
		`Captured text: ${request.text}`,
		`Draft title: ${request.draftTitle}`,
		'',
		'Return the title with any project name, date or duration removed, and',
		'the project it belongs to. If no listed project clearly matches, and no',
		'project name appears in the text, project must be null.'
	].join('\n');
}

const RESPONSE_SCHEMA = {
	type: 'object',
	properties: {
		title: { type: 'string' },
		project: { type: ['string', 'null'] }
	},
	required: ['title']
} as const;

export async function callModel(request: LlmRequest): Promise<LlmResponse | null> {
	switch (activeProvider()) {
		case 'ollama':
			return callOllama(request);
		case 'anthropic':
			return callAnthropic(request);
		default:
			return null;
	}
}

/**
 * A local model over Ollama. `format` takes a JSON schema, so the response is
 * structurally valid without any parsing heroics — though it may still be
 * wrong, which is what the validation in `index.ts` is for.
 */
async function callOllama(request: LlmRequest): Promise<LlmResponse | null> {
	const host = env.OLLAMA_HOST ?? 'http://localhost:11434';
	const model = env.OLLAMA_MODEL ?? 'mistral:7b';

	const controller = new AbortController();
	// A local model that is thinking too hard is worse than no model: capture
	// has to feel instant or the user stops capturing.
	const timeout = setTimeout(() => controller.abort(), Number(env.LLM_TIMEOUT_MS ?? 8000));

	const payload = {
		model,
		stream: false,
		format: RESPONSE_SCHEMA,
		options: { temperature: 0 },
		messages: [
			{ role: 'system', content: SYSTEM },
			{ role: 'user', content: userPrompt(request) }
		]
	};

	try {
		const post = (body: object) =>
			fetch(`${host}/api/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				signal: controller.signal,
				body: JSON.stringify(body)
			});

		// Hybrid reasoning models (qwen3 and friends) will happily spend several
		// seconds thinking about a job this small. Turn it off — but older models
		// reject the field outright, so fall back if they complain.
		let response = await post({ ...payload, think: false });
		if (!response.ok) response = await post(payload);

		if (!response.ok) return null;
		const body = (await response.json()) as { message?: { content?: string } };
		if (!body.message?.content) return null;

		const parsed = JSON.parse(body.message.content) as { title?: unknown; project?: unknown };
		return {
			title: typeof parsed.title === 'string' ? parsed.title : null,
			projectName: typeof parsed.project === 'string' ? parsed.project : null
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

async function callAnthropic(request: LlmRequest): Promise<LlmResponse | null> {
	if (!env.ANTHROPIC_API_KEY) return null;

	try {
		const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
		const response = await client.messages.create({
			model: env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
			max_tokens: 300,
			system: SYSTEM,
			messages: [{ role: 'user', content: userPrompt(request) }],
			tools: [
				{
					name: 'record',
					description: 'Record the tidied title and the project.',
					input_schema: {
						type: 'object',
						properties: {
							title: { type: 'string' },
							project: { type: ['string', 'null'] }
						},
						required: ['title']
					}
				}
			],
			tool_choice: { type: 'tool', name: 'record' }
		});

		const toolUse = response.content.find((block) => block.type === 'tool_use');
		if (!toolUse || toolUse.type !== 'tool_use') return null;

		const input = toolUse.input as { title?: unknown; project?: unknown };
		return {
			title: typeof input.title === 'string' ? input.title : null,
			projectName: typeof input.project === 'string' ? input.project : null
		};
	} catch {
		return null;
	}
}
