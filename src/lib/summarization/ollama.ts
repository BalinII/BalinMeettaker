import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  saveActionsAndDecisions,
  saveStructuredSummaryJson,
} from "@/lib/database";
import type {
  ActionInput,
  DecisionInput,
  Summary,
  TranscriptSegment,
} from "@/types";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_SUMMARY_MODEL = "llama3.1:8b";
export const LOCAL_SUMMARY_FORMAT_VERSION = 1;

const MAX_CHUNK_CHARACTERS = 8000;
const CHUNK_OVERLAP_CHARACTERS = 600;

const SUMMARY_KEYS = [
  "executive_summary",
  "key_topics",
  "decisions",
  "action_items",
  "risks_or_blockers",
  "follow_up_questions",
  "clean_notes",
] as const;

type SummaryKey = (typeof SUMMARY_KEYS)[number];

export interface SummaryActionItem {
  description: string;
  owner: string | null;
  due_date: string | null;
  status: "open" | "in_progress" | "completed" | "cancelled";
}

export interface SummaryDecision {
  title: string;
  description: string | null;
}

export interface StructuredMeetingSummary {
  executive_summary: string;
  key_topics: string[];
  decisions: SummaryDecision[];
  action_items: SummaryActionItem[];
  risks_or_blockers: string[];
  follow_up_questions: string[];
  clean_notes: string;
}

export interface OllamaHealth {
  ok: boolean;
  baseUrl: string;
  model: string;
  availableModels: string[];
  error?: string;
}

export interface SummarizeMeetingInput {
  meetingId: string;
  transcriptSegments: TranscriptSegment[];
  model?: string;
  baseUrl?: string;
}

export interface SummarizeMeetingResult {
  summary: Summary;
  structuredSummary: StructuredMeetingSummary;
  chunkCount: number;
  model: string;
}

interface OllamaGenerateResponse {
  response?: string;
  error?: string;
}

const SUMMARY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: SUMMARY_KEYS,
  properties: {
    executive_summary: { type: "string" },
    key_topics: { type: "array", items: { type: "string" } },
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description"],
        properties: {
          title: { type: "string" },
          description: { type: ["string", "null"] },
        },
      },
    },
    action_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "owner", "due_date", "status"],
        properties: {
          description: { type: "string" },
          owner: { type: ["string", "null"] },
          due_date: { type: ["string", "null"] },
          status: {
            type: "string",
            enum: ["open", "in_progress", "completed", "cancelled"],
          },
        },
      },
    },
    risks_or_blockers: { type: "array", items: { type: "string" } },
    follow_up_questions: { type: "array", items: { type: "string" } },
    clean_notes: { type: "string" },
  },
};

function normalizeBaseUrl(baseUrl = DEFAULT_OLLAMA_BASE_URL): string {
  return baseUrl.replace(/\/+$/, "");
}

function stringifyTranscriptSegment(segment: TranscriptSegment): string {
  const speaker = segment.speakerLabel || "Speaker";
  const startSeconds = Math.floor(segment.startMs / 1000);
  return `[${startSeconds}s] ${speaker}: ${segment.text.trim()}`;
}

export function chunkTranscript(
  transcriptSegments: TranscriptSegment[],
  maxCharacters = MAX_CHUNK_CHARACTERS
): string[] {
  const transcript = transcriptSegments
    .filter((segment) => segment.text.trim().length > 0)
    .map(stringifyTranscriptSegment)
    .join("\n");

  if (!transcript.trim()) {
    return [];
  }

  const chunks: string[] = [];
  let index = 0;

  while (index < transcript.length) {
    const targetEnd = Math.min(index + maxCharacters, transcript.length);
    const newlineEnd = transcript.lastIndexOf("\n", targetEnd);
    const end =
      newlineEnd > index + Math.floor(maxCharacters * 0.6) ? newlineEnd : targetEnd;
    chunks.push(transcript.slice(index, end).trim());

    if (end >= transcript.length) break;
    index = Math.max(0, end - CHUNK_OVERLAP_CHARACTERS);
  }

  return chunks.filter(Boolean);
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("Ollama returned non-JSON content.");
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}

function normalizeDecision(value: unknown): SummaryDecision | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (!title) return null;
  return {
    title,
    description:
      typeof record.description === "string" && record.description.trim()
        ? record.description.trim()
        : null,
  };
}

function normalizeActionItem(value: unknown): SummaryActionItem | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const description =
    typeof record.description === "string" ? record.description.trim() : "";
  if (!description) return null;

  const status =
    record.status === "in_progress" ||
    record.status === "completed" ||
    record.status === "cancelled"
      ? record.status
      : "open";

  return {
    description,
    owner:
      typeof record.owner === "string" && record.owner.trim()
        ? record.owner.trim()
        : null,
    due_date:
      typeof record.due_date === "string" && record.due_date.trim()
        ? record.due_date.trim()
        : null,
    status,
  };
}

export function validateStructuredMeetingSummary(
  value: unknown
): StructuredMeetingSummary {
  if (!value || typeof value !== "object") {
    throw new Error("Summary JSON must be an object.");
  }

  const record = value as Record<SummaryKey, unknown>;
  for (const key of SUMMARY_KEYS) {
    if (!(key in record)) {
      throw new Error(`Summary JSON is missing required key: ${key}`);
    }
  }

  const executiveSummary =
    typeof record.executive_summary === "string"
      ? record.executive_summary.trim()
      : "";
  const cleanNotes =
    typeof record.clean_notes === "string" ? record.clean_notes.trim() : "";

  if (!executiveSummary) {
    throw new Error("Summary JSON must include an executive_summary string.");
  }

  return {
    executive_summary: executiveSummary,
    key_topics: asStringArray(record.key_topics),
    decisions: Array.isArray(record.decisions)
      ? record.decisions.map(normalizeDecision).filter(isDefined)
      : [],
    action_items: Array.isArray(record.action_items)
      ? record.action_items.map(normalizeActionItem).filter(isDefined)
      : [],
    risks_or_blockers: asStringArray(record.risks_or_blockers),
    follow_up_questions: asStringArray(record.follow_up_questions),
    clean_notes: cleanNotes,
  };
}

async function ollamaGenerateJson(params: {
  baseUrl: string;
  model: string;
  prompt: string;
}): Promise<StructuredMeetingSummary> {
  const response = await tauriFetch(`${normalizeBaseUrl(params.baseUrl)}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: params.model,
      prompt: params.prompt,
      stream: false,
      format: SUMMARY_JSON_SCHEMA,
      options: { temperature: 0.1 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama generate failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as OllamaGenerateResponse;
  if (payload.error) {
    throw new Error(payload.error);
  }

  return validateStructuredMeetingSummary(extractJson(payload.response ?? ""));
}

function buildChunkPrompt(chunk: string, chunkNumber: number, totalChunks: number): string {
  return `You are extracting structured meeting notes from transcript chunk ${chunkNumber} of ${totalChunks}.
Return only valid JSON matching this schema:
${JSON.stringify(SUMMARY_JSON_SCHEMA)}

Rules:
- Capture only facts present in this chunk.
- Use [] for empty arrays and null for unknown owner/due_date/description.
- Keep clean_notes concise and chronological.

Transcript chunk:
${chunk}`;
}

function buildFinalPrompt(chunkSummaries: StructuredMeetingSummary[]): string {
  return `Consolidate these per-chunk meeting extractions into one de-duplicated final meeting summary.
Return only valid JSON matching this schema:
${JSON.stringify(SUMMARY_JSON_SCHEMA)}

Rules:
- Merge duplicate topics, decisions, actions, risks, and questions.
- Preserve owners and due dates when present.
- Keep executive_summary brief but specific.
- Write clean_notes as readable meeting notes.

Per-chunk JSON summaries:
${JSON.stringify(chunkSummaries)}`;
}

export async function checkOllamaHealth(params?: {
  baseUrl?: string;
  model?: string;
}): Promise<OllamaHealth> {
  const baseUrl = normalizeBaseUrl(params?.baseUrl);
  const model = params?.model?.trim() || DEFAULT_OLLAMA_SUMMARY_MODEL;

  try {
    const response = await tauriFetch(`${baseUrl}/api/tags`, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Ollama health check returned HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    const availableModels = (payload.models ?? [])
      .map((item) => item.name || item.model || "")
      .filter(Boolean);

    return {
      ok: availableModels.includes(model),
      baseUrl,
      model,
      availableModels,
      error: availableModels.includes(model)
        ? undefined
        : `Model "${model}" is not installed in Ollama.`,
    };
  } catch (error) {
    return {
      ok: false,
      baseUrl,
      model,
      availableModels: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseDueDate(dueDate: string | null): number | null {
  if (!dueDate) return null;
  const timestamp = Date.parse(dueDate);
  return Number.isNaN(timestamp) ? null : timestamp;
}

async function persistStructuredSummary(params: {
  meetingId: string;
  structuredSummary: StructuredMeetingSummary;
  model: string;
  chunkCount: number;
}): Promise<Summary> {
  const summary = await saveStructuredSummaryJson(params.meetingId, {
    structuredJson: {
      ...params.structuredSummary,
      metadata: {
        provider: "ollama",
        model: params.model,
        chunk_count: params.chunkCount,
        generated_at: new Date().toISOString(),
      },
    },
    formatVersion: LOCAL_SUMMARY_FORMAT_VERSION,
  });

  const actionInputs: ActionInput[] = params.structuredSummary.action_items.map(
    (item) => ({
      summaryId: summary.id,
      description: item.description,
      owner: item.owner,
      dueAt: parseDueDate(item.due_date),
      status: item.status,
      metadata: { due_date_text: item.due_date, provider: "ollama" },
    })
  );

  const decisionInputs: DecisionInput[] = params.structuredSummary.decisions.map(
    (item) => ({
      summaryId: summary.id,
      title: item.title,
      description: item.description,
      metadata: { provider: "ollama" },
    })
  );

  await saveActionsAndDecisions(params.meetingId, actionInputs, decisionInputs);

  return summary;
}

export async function summarizeMeetingWithOllama(
  input: SummarizeMeetingInput
): Promise<SummarizeMeetingResult> {
  const model = input.model?.trim() || DEFAULT_OLLAMA_SUMMARY_MODEL;
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const chunks = chunkTranscript(input.transcriptSegments);

  if (chunks.length === 0) {
    throw new Error("No transcript text is available to summarize.");
  }

  const health = await checkOllamaHealth({ baseUrl, model });
  if (!health.ok) {
    throw new Error(
      health.error || `Ollama is not ready with model "${model}" at ${baseUrl}.`
    );
  }

  try {
    const chunkSummaries: StructuredMeetingSummary[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      chunkSummaries.push(
        await ollamaGenerateJson({
          baseUrl,
          model,
          prompt: buildChunkPrompt(chunks[index], index + 1, chunks.length),
        })
      );
    }

    const structuredSummary =
      chunkSummaries.length === 1
        ? chunkSummaries[0]
        : await ollamaGenerateJson({
            baseUrl,
            model,
            prompt: buildFinalPrompt(chunkSummaries),
          });

    const summary = await persistStructuredSummary({
      meetingId: input.meetingId,
      structuredSummary,
      model,
      chunkCount: chunks.length,
    });

    return { summary, structuredSummary, chunkCount: chunks.length, model };
  } catch (error) {
    throw new Error(
      `Local Ollama summarisation failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
