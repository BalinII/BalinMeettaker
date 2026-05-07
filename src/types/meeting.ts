export type MeetingStatus =
  | "scheduled"
  | "recording"
  | "processing"
  | "completed"
  | "cancelled"
  | "failed";

export type ActionStatus = "open" | "in_progress" | "completed" | "cancelled";

export interface Meeting {
  id: string;
  title: string;
  status: MeetingStatus;
  startedAt?: number | null;
  endedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Participant {
  id: string;
  meetingId: string;
  name: string;
  email?: string | null;
  role?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TranscriptSegment {
  id: string;
  meetingId: string;
  participantId?: string | null;
  speakerLabel?: string | null;
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number | null;
  metadata?: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface Summary {
  id: string;
  meetingId: string;
  structuredJson: Record<string, unknown>;
  formatVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface ActionItem {
  id: string;
  meetingId: string;
  summaryId?: string | null;
  description: string;
  owner?: string | null;
  dueAt?: number | null;
  status: ActionStatus;
  metadata?: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface Decision {
  id: string;
  meetingId: string;
  summaryId?: string | null;
  title: string;
  description?: string | null;
  decidedAt?: number | null;
  metadata?: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface MeetingDetail extends Meeting {
  participants: Participant[];
  transcriptSegments: TranscriptSegment[];
  summaries: Summary[];
  actions: ActionItem[];
  decisions: Decision[];
}

export interface CreateMeetingInput {
  id?: string;
  title: string;
  status?: MeetingStatus;
  startedAt?: number | null;
  endedAt?: number | null;
  participants?: Array<
    Pick<Participant, "name"> &
      Partial<Pick<Participant, "id" | "email" | "role">>
  >;
}

export interface TranscriptSegmentInput {
  id?: string;
  participantId?: string | null;
  speakerLabel?: string | null;
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface SaveSummaryInput {
  id?: string;
  structuredJson: Record<string, unknown>;
  formatVersion?: number;
}

export interface ActionInput {
  id?: string;
  summaryId?: string | null;
  description: string;
  owner?: string | null;
  dueAt?: number | null;
  status?: ActionStatus;
  metadata?: Record<string, unknown> | null;
}

export interface DecisionInput {
  id?: string;
  summaryId?: string | null;
  title: string;
  description?: string | null;
  decidedAt?: number | null;
  metadata?: Record<string, unknown> | null;
}
