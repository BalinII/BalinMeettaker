-- Local transcription execution state for meeting audio files
CREATE TABLE IF NOT EXISTS transcription_runs (
    meeting_id TEXT PRIMARY KEY,
    audio_path TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('idle', 'queued', 'running', 'completed', 'failed')),
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_started_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transcription_runs_status ON transcription_runs(status);
CREATE INDEX IF NOT EXISTS idx_transcription_runs_updated_at ON transcription_runs(updated_at DESC);
