/**
 * Turning "storyboard rev2 Studio X ~6h friday" into a structured task.
 *
 * The governing rule from §8: **never reject input**. If the model is missing,
 * slow, or confused, the deterministic parser still produces a task. A capture
 * that fails is a capture the user stops making, and then the app dies.
 *
 * Order of work:
 *   1. `deterministic.ts` extracts the estimate, deadline and kind. These have
 *      exactly one right answer and code gets them right every time.
 *   2. A model — local or hosted, or none at all — tidies the title and spots a
 *      project name. Only these two, and only as a suggestion.
 *   3. Everything the model says is validated before it is believed.
 */

import { formatInTimeZone } from 'date-fns-tz';
import type { TaskKind } from '$lib/scheduler/types';
import { detectKind, extractDeadline, extractEstimate, stripMatches } from './deterministic';
import { looksStructured, parseStructured } from './structured';
import { activeProvider, callModel } from './providers';

export type ParsedTask = {
	title: string;
	/** Matched against an existing project. Never silently creates one. */
	projectId: string | null;
	/** A project name we saw but could not match, offered as a confirmable chip. */
	unmatchedProjectName: string | null;
	estimateHours: number | null;
	deadline: Date | null;
	kind: TaskKind;
	/** How the result was arrived at, shown to the user. */
	source: 'structured' | 'deterministic' | 'model-assisted';
	note: string | null;
	/** Extra prose from a structured capture, offered as the task's notes. */
	notes: string | null;
};

export type ProjectChoice = { id: string; name: string; clientName: string | null };

export async function parseQuickAdd(
	text: string,
	options: { projects: ProjectChoice[]; timezone: string; now: Date; hoursPerDay?: number }
): Promise<ParsedTask> {
	const trimmed = text.trim();
	if (!trimmed) {
		return {
			title: 'Untitled task',
			projectId: null,
			unmatchedProjectName: null,
			estimateHours: null,
			deadline: null,
			kind: 'creative',
			source: 'deterministic',
			note: null,
			notes: null
		};
	}

	// The dash format says what each field is, so there is nothing left to
	// infer. No model is consulted: it could only make this worse, and slower.
	if (looksStructured(trimmed)) {
		const structured = parseStructured(trimmed, options);
		return {
			...structured,
			title: structured.title.slice(0, 200),
			source: 'structured',
			note: describe(structured.estimateHours, structured.deadline, options.timezone)
		};
	}

	// ------------------------------------------------------------------ step 1
	const estimate = extractEstimate(trimmed, options.hoursPerDay);
	const deadline = extractDeadline(trimmed, options.now, options.timezone);
	const kind = detectKind(trimmed);

	// A project named in the text is found by matching, not by asking a model —
	// exact matching beats a 7B model's memory of a list every time.
	const projectFromText = findProjectInText(trimmed, options.projects);

	let title = stripMatches(trimmed, [
		estimate?.matched ?? '',
		deadline?.matched ?? '',
		projectFromText?.matchedText ?? ''
	]);

	let projectId = projectFromText?.project.id ?? null;
	let unmatchedProjectName: string | null = null;
	let source: ParsedTask['source'] = 'deterministic';

	// ------------------------------------------------------------------ step 2
	if (activeProvider() !== 'none') {
		const suggestion = await callModel({
			text: trimmed,
			draftTitle: title,
			projectNames: options.projects.map((p) => p.name)
		});

		if (suggestion) {
			// ------------------------------------------------------------ step 3
			// A tidied title is believed only if it is actually tidier. Small
			// models love to helpfully re-add "for Studio X on Friday", which is
			// precisely the text we just removed.
			const candidate = suggestion.title?.trim();
			if (candidate && candidate.length > 0 && candidate.length <= title.length && !reintroducesNoise(candidate, trimmed)) {
				title = candidate;
				source = 'model-assisted';
			}

			// A project suggestion is believed only if the name it gives actually
			// appears in what the user typed. Small models will confidently
			// attach the first project on the list to "fix the thing" — and
			// because that name IS a real project, matching alone would let the
			// hallucination straight through. A wrong project is worse than none:
			// the user does not notice it, and the hours land on the wrong client.
			if (!projectId && suggestion.projectName && appearsInText(suggestion.projectName, trimmed)) {
				const matched = matchProject(suggestion.projectName, options.projects);
				if (matched) {
					projectId = matched.id;
				} else {
					// A name we do not know, but that the user did type: offered as a
					// chip, never created behind their back.
					unmatchedProjectName = suggestion.projectName;
				}
				source = 'model-assisted';
			}
		}
	}

	return {
		title: (title || trimmed).slice(0, 200),
		projectId,
		unmatchedProjectName,
		estimateHours: estimate?.value ?? null,
		deadline: deadline?.value ?? null,
		kind: kind?.value ?? 'creative',
		source,
		note: describe(estimate?.value ?? null, deadline?.value ?? null, options.timezone),
		notes: null
	};
}

/** A short, honest description of what was understood. */
function describe(
	estimateHours: number | null,
	deadline: Date | null,
	timezone: string
): string | null {
	const parts: string[] = [];
	if (estimateHours !== null) parts.push(`${estimateHours}h`);
	if (deadline) parts.push(`due ${formatInTimeZone(deadline, timezone, 'EEE d MMM HH:mm')}`);
	return parts.length ? `Read: ${parts.join(', ')}` : null;
}

/** Does this title put back the dates and durations we stripped out? */
function reintroducesNoise(candidate: string, original: string): boolean {
	if (/\d\s*(?:h|hr|min|hours?|heures?)\b/i.test(candidate)) return true;
	if (/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|today|tomorrow|demain|aujourd)/i.test(candidate)) {
		return true;
	}
	// A title longer than what the user typed is not a tidier title.
	return candidate.length > original.length;
}

function appearsInText(name: string, text: string): boolean {
	const haystack = text.toLowerCase();
	return name
		.toLowerCase()
		.split(/\s+/)
		.filter((word) => word.length > 2)
		.some((word) => haystack.includes(word));
}

/**
 * Find a known project named in the text, longest name first so that
 * "Aurora titles" wins over a project merely called "Aurora".
 */
function findProjectInText(
	text: string,
	projects: ProjectChoice[]
): { project: ProjectChoice; matchedText: string } | null {
	const haystack = text.toLowerCase();
	const candidates = [...projects].sort((a, b) => b.name.length - a.name.length);

	for (const project of candidates) {
		for (const needle of [project.name, project.clientName]) {
			if (!needle || needle.length < 3) continue;
			const index = haystack.indexOf(needle.toLowerCase());
			if (index !== -1) {
				return { project, matchedText: text.slice(index, index + needle.length) };
			}
		}
	}
	return null;
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
