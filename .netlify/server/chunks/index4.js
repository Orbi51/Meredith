import { formatInTimeZone } from "date-fns-tz";
import { l as looksStructured, p as parseStructured, e as extractEstimate, a as extractDeadline, d as detectKind, s as stripMatches } from "./structured.js";
import Anthropic from "@anthropic-ai/sdk";
import { b as private_env } from "./shared-server.js";
function activeProvider() {
  const configured = (private_env.LLM_PROVIDER ?? "").toLowerCase();
  if (configured === "none") return "none";
  if (configured === "ollama") return "ollama";
  if (configured === "anthropic") return "anthropic";
  return private_env.ANTHROPIC_API_KEY ? "anthropic" : "none";
}
const SYSTEM = "You tidy up short task notes written by a freelance 3D/CG artist. You do exactly two things: give the task a clean title, and say which project it belongs to. You never invent a project that is not listed, and you never put dates, durations or project names into the title.";
function userPrompt(request) {
  return [
    `Projects that exist: ${request.projectNames.length ? request.projectNames.join(", ") : "(none)"}`,
    "",
    `Captured text: ${request.text}`,
    `Draft title: ${request.draftTitle}`,
    "",
    "Return the title with any project name, date or duration removed, and",
    "the project it belongs to. If no listed project clearly matches, and no",
    "project name appears in the text, project must be null."
  ].join("\n");
}
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    project: { type: ["string", "null"] }
  },
  required: ["title"]
};
async function callModel(request) {
  switch (activeProvider()) {
    case "ollama":
      return callOllama(request);
    case "anthropic":
      return callAnthropic(request);
    default:
      return null;
  }
}
async function callOllama(request) {
  const host = private_env.OLLAMA_HOST ?? "http://localhost:11434";
  const model = private_env.OLLAMA_MODEL ?? "mistral:7b";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(private_env.LLM_TIMEOUT_MS ?? 8e3));
  const payload = {
    model,
    stream: false,
    format: RESPONSE_SCHEMA,
    options: { temperature: 0 },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt(request) }
    ]
  };
  try {
    const post = (body2) => fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(body2)
    });
    let response = await post({ ...payload, think: false });
    if (!response.ok) response = await post(payload);
    if (!response.ok) return null;
    const body = await response.json();
    if (!body.message?.content) return null;
    const parsed = JSON.parse(body.message.content);
    return {
      title: typeof parsed.title === "string" ? parsed.title : null,
      projectName: typeof parsed.project === "string" ? parsed.project : null
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
async function callAnthropic(request) {
  if (!private_env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic({ apiKey: private_env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: private_env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
      max_tokens: 300,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt(request) }],
      tools: [
        {
          name: "record",
          description: "Record the tidied title and the project.",
          input_schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              project: { type: ["string", "null"] }
            },
            required: ["title"]
          }
        }
      ],
      tool_choice: { type: "tool", name: "record" }
    });
    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;
    const input = toolUse.input;
    return {
      title: typeof input.title === "string" ? input.title : null,
      projectName: typeof input.project === "string" ? input.project : null
    };
  } catch {
    return null;
  }
}
async function parseQuickAdd(text, options) {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      title: "Untitled task",
      projectId: null,
      unmatchedProjectName: null,
      estimateHours: null,
      deadline: null,
      kind: "creative",
      source: "deterministic",
      note: null,
      notes: null
    };
  }
  if (looksStructured(trimmed)) {
    const structured = parseStructured(trimmed, options);
    return {
      ...structured,
      title: structured.title.slice(0, 200),
      source: "structured",
      note: describe(structured.estimateHours, structured.deadline, options.timezone)
    };
  }
  const estimate = extractEstimate(trimmed);
  const deadline = extractDeadline(trimmed, options.now, options.timezone);
  const kind = detectKind(trimmed);
  const projectFromText = findProjectInText(trimmed, options.projects);
  let title = stripMatches(trimmed, [
    estimate?.matched ?? "",
    deadline?.matched ?? "",
    projectFromText?.matchedText ?? ""
  ]);
  let projectId = projectFromText?.project.id ?? null;
  let unmatchedProjectName = null;
  let source = "deterministic";
  if (activeProvider() !== "none") {
    const suggestion = await callModel({
      text: trimmed,
      draftTitle: title,
      projectNames: options.projects.map((p) => p.name)
    });
    if (suggestion) {
      const candidate = suggestion.title?.trim();
      if (candidate && candidate.length > 0 && candidate.length <= title.length && !reintroducesNoise(candidate, trimmed)) {
        title = candidate;
        source = "model-assisted";
      }
      if (!projectId && suggestion.projectName && appearsInText(suggestion.projectName, trimmed)) {
        const matched = matchProject(suggestion.projectName, options.projects);
        if (matched) {
          projectId = matched.id;
        } else {
          unmatchedProjectName = suggestion.projectName;
        }
        source = "model-assisted";
      }
    }
  }
  return {
    title: (title || trimmed).slice(0, 200),
    projectId,
    unmatchedProjectName,
    estimateHours: estimate?.value ?? null,
    deadline: deadline?.value ?? null,
    kind: kind?.value ?? "creative",
    source,
    note: describe(estimate?.value ?? null, deadline?.value ?? null, options.timezone),
    notes: null
  };
}
function describe(estimateHours, deadline, timezone) {
  const parts = [];
  if (estimateHours !== null) parts.push(`${estimateHours}h`);
  if (deadline) parts.push(`due ${formatInTimeZone(deadline, timezone, "EEE d MMM HH:mm")}`);
  return parts.length ? `Read: ${parts.join(", ")}` : null;
}
function reintroducesNoise(candidate, original) {
  if (/\d\s*(?:h|hr|min|hours?|heures?)\b/i.test(candidate)) return true;
  if (/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|today|tomorrow|demain|aujourd)/i.test(candidate)) {
    return true;
  }
  return candidate.length > original.length;
}
function appearsInText(name, text) {
  const haystack = text.toLowerCase();
  return name.toLowerCase().split(/\s+/).filter((word) => word.length > 2).some((word) => haystack.includes(word));
}
function findProjectInText(text, projects) {
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
function matchProject(name, projects) {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const exact = projects.find((p) => p.name.toLowerCase() === needle);
  if (exact) return exact;
  const byClient = projects.find((p) => p.clientName?.toLowerCase() === needle);
  if (byClient) return byClient;
  const contains = projects.filter(
    (p) => p.name.toLowerCase().includes(needle) || needle.includes(p.name.toLowerCase())
  );
  return contains.length === 1 ? contains[0] : null;
}
export {
  parseQuickAdd as p
};
