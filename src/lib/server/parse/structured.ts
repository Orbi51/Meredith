/**
 * The optional dash format: `Project - Task - Time - Deadline`.
 *
 *   Studio X - storyboard rev2 - 6h - friday
 *
 * §2 of the plan forbids making the user learn a syntax, so this is a fast
 * path, never a requirement. Free text still works exactly as before. But when
 * the user does reach for the dashes, there is nothing left to guess: the
 * segments say what they are, no model is consulted, and the result is the
 * same every time.
 *
 * Fields are identified by what they LOOK like rather than by strict position,
 * so "roughly in that order" is good enough:
 *
 *   Studio X - storyboard rev2 - friday - 6h     works
 *   storyboard rev2 - 6h                          works
 *   storyboard rev2 - friday - Studio X           works
 *
 * The delimiter is a SPACED dash (" - "), which is why "rev-2", "e-mail" and
 * "12-09" pass through untouched.
 */

import { detectKind, extractDeadline, extractEstimate } from './deterministic';
import type { TaskKind } from '$lib/scheduler/types';

export type ProjectLike = { id: string; name: string; clientName: string | null };

export type StructuredCapture = {
	title: string;
	projectId: string | null;
	/** A project name the user typed that we do not know yet. */
	unmatchedProjectName: string | null;
	estimateHours: number | null;
	deadline: Date | null;
	kind: TaskKind;
	notes: string | null;
};

/** Spaced hyphen, en dash or em dash. Unspaced dashes are part of a word. */
const DELIMITER = /\s+[-–—]\s+/;

export function looksStructured(text: string): boolean {
	return DELIMITER.test(text);
}

export function splitSegments(text: string): string[] {
	return text
		.split(DELIMITER)
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);
}

/** Is this segment nothing but a duration? */
function wholeSegmentEstimate(segment: string, hoursPerDay?: number): number | null {
	const found = extractEstimate(segment, hoursPerDay);
	if (!found) return null;
	// "6h" is an estimate; "render 6h of fog" is a title that mentions one.
	return found.matched.trim().length === segment.length ? found.value : null;
}

/** Is this segment nothing but a date? */
function wholeSegmentDeadline(segment: string, now: Date, timezone: string): Date | null {
	const found = extractDeadline(segment, now, timezone);
	if (!found) return null;
	return found.matched.trim().length === segment.length ? found.value : null;
}

function matchKnownProject(segment: string, projects: ProjectLike[]): ProjectLike | null {
	const needle = segment.trim().toLowerCase();
	const exact = projects.find(
		(p) => p.name.toLowerCase() === needle || p.clientName?.toLowerCase() === needle
	);
	if (exact) return exact;

	const contains = projects.filter(
		(p) => p.name.toLowerCase().includes(needle) || needle.includes(p.name.toLowerCase())
	);
	return contains.length === 1 ? (contains[0] as ProjectLike) : null;
}

export function parseStructured(
	text: string,
	options: { projects: ProjectLike[]; timezone: string; now: Date; hoursPerDay?: number }
): StructuredCapture {
	const segments = splitSegments(text);

	let estimateHours: number | null = null;
	let deadline: Date | null = null;
	let projectId: string | null = null;
	let unmatchedProjectName: string | null = null;

	/** Segments that are not a date, a duration, or a known project. */
	const prose: { index: number; value: string }[] = [];

	segments.forEach((segment, index) => {
		const asEstimate = wholeSegmentEstimate(segment, options.hoursPerDay);
		if (asEstimate !== null && estimateHours === null) {
			estimateHours = asEstimate;
			return;
		}

		const asDeadline = wholeSegmentDeadline(segment, options.now, options.timezone);
		if (asDeadline !== null && deadline === null) {
			deadline = asDeadline;
			return;
		}

		const known = matchKnownProject(segment, options.projects);
		if (known && projectId === null) {
			projectId = known.id;
			return;
		}

		prose.push({ index, value: segment });
	});

	// One prose segment is the title. Two or more, and the documented order
	// (project first) decides: the leading segment is an unknown project name,
	// offered as a chip rather than created behind the user's back.
	let title: string;
	let notes: string | null = null;

	const values = prose.map((p) => p.value);
	const leadsWithUnknownProject =
		values.length > 1 && projectId === null && prose[0]?.index === 0;

	if (values.length === 0) {
		title = 'Untitled task';
	} else if (leadsWithUnknownProject) {
		unmatchedProjectName = values[0] as string;
		title = values[1] as string;
		notes = values.slice(2).join(' — ') || null;
	} else {
		title = values[0] as string;
		notes = values.slice(1).join(' — ') || null;
	}

	// Kind is decided from the whole capture, not one segment: "rendu" in the
	// title is what tells us this is unattended work.
	const kind = detectKind(text)?.value ?? 'creative';

	return { title, projectId, unmatchedProjectName, estimateHours, deadline, kind, notes };
}
