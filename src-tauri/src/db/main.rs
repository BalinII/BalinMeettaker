use tauri_plugin_sql::{Migration, MigrationKind};

/// Returns all database migrations
pub fn migrations() -> Vec<Migration> {
    vec![
        // Migration 1: Create system_prompts table with indexes and triggers
        Migration {
            version: 1,
            description: "create_system_prompts_table",
            sql: include_str!("migrations/system-prompts.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 2: Create chat history tables (conversations and messages)
        Migration {
            version: 2,
            description: "create_chat_history_tables",
            sql: include_str!("migrations/chat-history.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 3: Create local-only meeting data tables
        Migration {
            version: 3,
            description: "create_meeting_data_tables",
            sql: include_str!("migrations/meeting-data.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 4: Track local transcription runs and retry state
        Migration {
            version: 4,
            description: "create_transcription_runs_table",
            sql: include_str!("migrations/transcription-runs.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 5: Store the durable local meeting audio path on meetings
        Migration {
            version: 5,
            description: "add_meeting_audio_path",
            sql: include_str!("migrations/meeting-audio-path.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn includes_local_meeting_data_migration() {
        let all_migrations = migrations();
        let meeting_migration = all_migrations
            .iter()
            .find(|migration| migration.version == 3)
            .expect("meeting data migration should be registered");

        assert_eq!(meeting_migration.description, "create_meeting_data_tables");
        for table in [
            "meetings",
            "participants",
            "transcript_segments",
            "summaries",
            "actions",
            "decisions",
        ] {
            assert!(
                meeting_migration
                    .sql
                    .contains(&format!("CREATE TABLE IF NOT EXISTS {table}")),
                "migration should create {table} table"
            );
        }
    }

    #[test]
    fn includes_transcription_runs_migration() {
        let all_migrations = migrations();
        let transcription_migration = all_migrations
            .iter()
            .find(|migration| migration.version == 4)
            .expect("transcription runs migration should be registered");

        assert_eq!(
            transcription_migration.description,
            "create_transcription_runs_table"
        );
        assert!(transcription_migration
            .sql
            .contains("CREATE TABLE IF NOT EXISTS transcription_runs"));
        assert!(transcription_migration.sql.contains("attempts"));
    }

    #[test]
    fn includes_meeting_audio_path_migration() {
        let all_migrations = migrations();
        let audio_path_migration = all_migrations
            .iter()
            .find(|migration| migration.version == 5)
            .expect("meeting audio path migration should be registered");

        assert_eq!(audio_path_migration.description, "add_meeting_audio_path");
        assert!(audio_path_migration
            .sql
            .contains("ALTER TABLE meetings ADD COLUMN audio_path TEXT"));
    }
}
