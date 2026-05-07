import { getDatabase } from "./config";
import type {
  ActionInput,
  ActionItem,
  CreateMeetingInput,
  Decision,
  DecisionInput,
  Meeting,
  MeetingDetail,
  MeetingStatus,
  Participant,
  SaveSummaryInput,
  Summary,
  TranscriptSegment,
  TranscriptSegmentInput,
} from "@/types";

type JsonObject = Record<string, unknown>;

interface DbMeeting {
  id: string;
  title: string;
  status: MeetingStatus;
  started_at: number | null;
  ended_at: number | null;
  created_at: number;
  updated_at: number;
}

interface DbParticipant {
  id: string;
  meeting_id: string;
  name: string;
  email: string | null;
  role: string | null;
  created_at: number;
  updated_at: number;
}

interface DbTranscriptSegment {
  id: string;
  meeting_id: string;
  participant_id: string | null;
  speaker_label: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number | null;
  metadata_json: string | null;
  created_at: number;
  updated_at: number;
}

interface DbSummary {
  id: string;
  meeting_id: string;
  structured_json: string;
  format_version: number;
  created_at: number;
  updated_at: number;
}

interface DbAction {
  id: string;
  meeting_id: string;
  summary_id: string | null;
  description: string;
  owner: string | null;
  due_at: number | null;
  status: ActionItem["status"];
  metadata_json: string | null;
  created_at: number;
  updated_at: number;
}

interface DbDecision {
  id: string;
  meeting_id: string;
  summary_id: string | null;
  title: string;
  description: string | null;
  decided_at: number | null;
  metadata_json: string | null;
  created_at: number;
  updated_at: number;
}

const MEETING_STATUSES: MeetingStatus[] = [
  "scheduled",
  "recording",
  "processing",
  "completed",
  "cancelled",
  "failed",
];

function newId(): string {
  return crypto.randomUUID();
}

function safeJsonParse<T>(jsonString: string | null, fallback: T): T {
  if (!jsonString) return fallback;
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    console.error("Failed to parse meeting JSON:", error);
    return fallback;
  }
}

function validateMeetingStatus(status: MeetingStatus): void {
  if (!MEETING_STATUSES.includes(status)) {
    throw new Error(`Invalid meeting status: ${status}`);
  }
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
}

function mapMeeting(row: DbMeeting): Meeting {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapParticipant(row: DbParticipant): Participant {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTranscriptSegment(row: DbTranscriptSegment): TranscriptSegment {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    participantId: row.participant_id,
    speakerLabel: row.speaker_label,
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.text,
    confidence: row.confidence,
    metadata: safeJsonParse<JsonObject | null>(row.metadata_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSummary(row: DbSummary): Summary {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    structuredJson: safeJsonParse<JsonObject>(row.structured_json, {}),
    formatVersion: row.format_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAction(row: DbAction): ActionItem {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    summaryId: row.summary_id,
    description: row.description,
    owner: row.owner,
    dueAt: row.due_at,
    status: row.status,
    metadata: safeJsonParse<JsonObject | null>(row.metadata_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDecision(row: DbDecision): Decision {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    summaryId: row.summary_id,
    title: row.title,
    description: row.description,
    decidedAt: row.decided_at,
    metadata: safeJsonParse<JsonObject | null>(row.metadata_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createMeeting(input: CreateMeetingInput): Promise<Meeting> {
  assertNonEmpty(input.title, "Meeting title");

  const db = await getDatabase();
  const now = Date.now();
  const meeting: Meeting = {
    id: input.id ?? newId(),
    title: input.title.trim(),
    status: input.status ?? "scheduled",
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    createdAt: now,
    updatedAt: now,
  };
  validateMeetingStatus(meeting.status);

  try {
    await db.execute("BEGIN");
    await db.execute(
      "INSERT INTO meetings (id, title, status, started_at, ended_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        meeting.id,
        meeting.title,
        meeting.status,
        meeting.startedAt,
        meeting.endedAt,
        meeting.createdAt,
        meeting.updatedAt,
      ]
    );

    for (const participant of input.participants ?? []) {
      assertNonEmpty(participant.name, "Participant name");
      await db.execute(
        "INSERT INTO participants (id, meeting_id, name, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          participant.id ?? newId(),
          meeting.id,
          participant.name.trim(),
          participant.email ?? null,
          participant.role ?? null,
          now,
          now,
        ]
      );
    }

    await db.execute("COMMIT");
    return meeting;
  } catch (error) {
    await db.execute("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function updateMeetingStatus(
  meetingId: string,
  status: MeetingStatus,
  endedAt?: number | null
): Promise<Meeting | null> {
  assertNonEmpty(meetingId, "Meeting id");
  validateMeetingStatus(status);

  const db = await getDatabase();
  const now = Date.now();
  await db.execute(
    "UPDATE meetings SET status = ?, ended_at = COALESCE(?, ended_at), updated_at = ? WHERE id = ?",
    [status, endedAt ?? null, now, meetingId]
  );

  return getMeetingById(meetingId);
}

export async function listMeetings(): Promise<Meeting[]> {
  const db = await getDatabase();
  const rows = await db.select<DbMeeting[]>(
    "SELECT * FROM meetings ORDER BY updated_at DESC"
  );
  return rows.map(mapMeeting);
}

export async function getMeetingById(meetingId: string): Promise<Meeting | null> {
  assertNonEmpty(meetingId, "Meeting id");

  const db = await getDatabase();
  const rows = await db.select<DbMeeting[]>("SELECT * FROM meetings WHERE id = ?", [
    meetingId,
  ]);

  return rows[0] ? mapMeeting(rows[0]) : null;
}

export async function getMeetingDetail(
  meetingId: string
): Promise<MeetingDetail | null> {
  const meeting = await getMeetingById(meetingId);
  if (!meeting) return null;

  const db = await getDatabase();
  const [participants, transcriptSegments, summaries, actions, decisions] =
    await Promise.all([
      db.select<DbParticipant[]>(
        "SELECT * FROM participants WHERE meeting_id = ? ORDER BY name ASC",
        [meetingId]
      ),
      db.select<DbTranscriptSegment[]>(
        "SELECT * FROM transcript_segments WHERE meeting_id = ? ORDER BY start_ms ASC",
        [meetingId]
      ),
      db.select<DbSummary[]>(
        "SELECT * FROM summaries WHERE meeting_id = ? ORDER BY updated_at DESC",
        [meetingId]
      ),
      db.select<DbAction[]>(
        "SELECT * FROM actions WHERE meeting_id = ? ORDER BY created_at ASC",
        [meetingId]
      ),
      db.select<DbDecision[]>(
        "SELECT * FROM decisions WHERE meeting_id = ? ORDER BY created_at ASC",
        [meetingId]
      ),
    ]);

  return {
    ...meeting,
    participants: participants.map(mapParticipant),
    transcriptSegments: transcriptSegments.map(mapTranscriptSegment),
    summaries: summaries.map(mapSummary),
    actions: actions.map(mapAction),
    decisions: decisions.map(mapDecision),
  };
}

export async function saveTranscriptSegments(
  meetingId: string,
  segments: TranscriptSegmentInput[]
): Promise<TranscriptSegment[]> {
  assertNonEmpty(meetingId, "Meeting id");

  const db = await getDatabase();
  const now = Date.now();
  const savedSegments: TranscriptSegment[] = [];

  try {
    await db.execute("BEGIN");
    for (const segment of segments) {
      assertNonEmpty(segment.text, "Transcript segment text");
      if (segment.endMs < segment.startMs) {
        throw new Error("Transcript segment endMs must be greater than or equal to startMs");
      }

      const id = segment.id ?? newId();
      await db.execute(
        `INSERT INTO transcript_segments (id, meeting_id, participant_id, speaker_label, start_ms, end_ms, text, confidence, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           participant_id = excluded.participant_id,
           speaker_label = excluded.speaker_label,
           start_ms = excluded.start_ms,
           end_ms = excluded.end_ms,
           text = excluded.text,
           confidence = excluded.confidence,
           metadata_json = excluded.metadata_json,
           updated_at = excluded.updated_at`,
        [
          id,
          meetingId,
          segment.participantId ?? null,
          segment.speakerLabel ?? null,
          segment.startMs,
          segment.endMs,
          segment.text,
          segment.confidence ?? null,
          segment.metadata ? JSON.stringify(segment.metadata) : null,
          now,
          now,
        ]
      );
      savedSegments.push({
        id,
        meetingId,
        participantId: segment.participantId ?? null,
        speakerLabel: segment.speakerLabel ?? null,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
        confidence: segment.confidence ?? null,
        metadata: segment.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }
    await db.execute("COMMIT");
    return savedSegments;
  } catch (error) {
    await db.execute("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function saveStructuredSummaryJson(
  meetingId: string,
  input: SaveSummaryInput
): Promise<Summary> {
  assertNonEmpty(meetingId, "Meeting id");

  const db = await getDatabase();
  const now = Date.now();
  const id = input.id ?? newId();
  const summary: Summary = {
    id,
    meetingId,
    structuredJson: input.structuredJson,
    formatVersion: input.formatVersion ?? 1,
    createdAt: now,
    updatedAt: now,
  };

  await db.execute(
    `INSERT INTO summaries (id, meeting_id, structured_json, format_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       structured_json = excluded.structured_json,
       format_version = excluded.format_version,
       updated_at = excluded.updated_at`,
    [
      summary.id,
      meetingId,
      JSON.stringify(summary.structuredJson),
      summary.formatVersion,
      summary.createdAt,
      summary.updatedAt,
    ]
  );

  return summary;
}

export async function saveActionsAndDecisions(
  meetingId: string,
  actions: ActionInput[],
  decisions: DecisionInput[]
): Promise<{ actions: ActionItem[]; decisions: Decision[] }> {
  assertNonEmpty(meetingId, "Meeting id");

  const db = await getDatabase();
  const now = Date.now();
  const savedActions: ActionItem[] = [];
  const savedDecisions: Decision[] = [];

  try {
    await db.execute("BEGIN");

    for (const action of actions) {
      assertNonEmpty(action.description, "Action description");
      const item: ActionItem = {
        id: action.id ?? newId(),
        meetingId,
        summaryId: action.summaryId ?? null,
        description: action.description,
        owner: action.owner ?? null,
        dueAt: action.dueAt ?? null,
        status: action.status ?? "open",
        metadata: action.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      };
      await db.execute(
        `INSERT INTO actions (id, meeting_id, summary_id, description, owner, due_at, status, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           summary_id = excluded.summary_id,
           description = excluded.description,
           owner = excluded.owner,
           due_at = excluded.due_at,
           status = excluded.status,
           metadata_json = excluded.metadata_json,
           updated_at = excluded.updated_at`,
        [
          item.id,
          meetingId,
          item.summaryId,
          item.description,
          item.owner,
          item.dueAt,
          item.status,
          item.metadata ? JSON.stringify(item.metadata) : null,
          item.createdAt,
          item.updatedAt,
        ]
      );
      savedActions.push(item);
    }

    for (const decision of decisions) {
      assertNonEmpty(decision.title, "Decision title");
      const item: Decision = {
        id: decision.id ?? newId(),
        meetingId,
        summaryId: decision.summaryId ?? null,
        title: decision.title,
        description: decision.description ?? null,
        decidedAt: decision.decidedAt ?? now,
        metadata: decision.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      };
      await db.execute(
        `INSERT INTO decisions (id, meeting_id, summary_id, title, description, decided_at, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           summary_id = excluded.summary_id,
           title = excluded.title,
           description = excluded.description,
           decided_at = excluded.decided_at,
           metadata_json = excluded.metadata_json,
           updated_at = excluded.updated_at`,
        [
          item.id,
          meetingId,
          item.summaryId,
          item.title,
          item.description,
          item.decidedAt,
          item.metadata ? JSON.stringify(item.metadata) : null,
          item.createdAt,
          item.updatedAt,
        ]
      );
      savedDecisions.push(item);
    }

    await db.execute("COMMIT");
    return { actions: savedActions, decisions: savedDecisions };
  } catch (error) {
    await db.execute("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
