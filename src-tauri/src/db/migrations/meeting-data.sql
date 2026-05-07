-- Local-only meeting data model
CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('scheduled', 'recording', 'processing', 'completed', 'cancelled', 'failed')),
    started_at INTEGER,
    ended_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    role TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transcript_segments (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    participant_id TEXT,
    speaker_label TEXT,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL,
    confidence REAL,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE SET NULL,
    CHECK(end_ms >= start_ms)
);

CREATE TABLE IF NOT EXISTS summaries (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    structured_json TEXT NOT NULL,
    format_version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    summary_id TEXT,
    description TEXT NOT NULL,
    owner TEXT,
    due_at INTEGER,
    status TEXT NOT NULL CHECK(status IN ('open', 'in_progress', 'completed', 'cancelled')) DEFAULT 'open',
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (summary_id) REFERENCES summaries(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    summary_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    decided_at INTEGER,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (summary_id) REFERENCES summaries(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_meetings_updated_at ON meetings(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_participants_meeting_id ON participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_meeting_time ON transcript_segments(meeting_id, start_ms ASC);
CREATE INDEX IF NOT EXISTS idx_summaries_meeting_id ON summaries(meeting_id);
CREATE INDEX IF NOT EXISTS idx_actions_meeting_status ON actions(meeting_id, status);
CREATE INDEX IF NOT EXISTS idx_decisions_meeting_id ON decisions(meeting_id);

CREATE TRIGGER IF NOT EXISTS update_meeting_timestamp_on_participant_change
AFTER INSERT ON participants
FOR EACH ROW
BEGIN
    UPDATE meetings SET updated_at = NEW.updated_at WHERE id = NEW.meeting_id;
END;

CREATE TRIGGER IF NOT EXISTS update_meeting_timestamp_on_transcript_insert
AFTER INSERT ON transcript_segments
FOR EACH ROW
BEGIN
    UPDATE meetings SET updated_at = NEW.updated_at WHERE id = NEW.meeting_id;
END;

CREATE TRIGGER IF NOT EXISTS update_meeting_timestamp_on_summary_insert
AFTER INSERT ON summaries
FOR EACH ROW
BEGIN
    UPDATE meetings SET updated_at = NEW.updated_at WHERE id = NEW.meeting_id;
END;

CREATE TRIGGER IF NOT EXISTS update_meeting_timestamp_on_action_insert
AFTER INSERT ON actions
FOR EACH ROW
BEGIN
    UPDATE meetings SET updated_at = NEW.updated_at WHERE id = NEW.meeting_id;
END;

CREATE TRIGGER IF NOT EXISTS update_meeting_timestamp_on_decision_insert
AFTER INSERT ON decisions
FOR EACH ROW
BEGIN
    UPDATE meetings SET updated_at = NEW.updated_at WHERE id = NEW.meeting_id;
END;
