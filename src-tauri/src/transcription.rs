use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub id: Option<String>,
    pub participant_id: Option<String>,
    pub speaker_label: Option<String>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub confidence: Option<f64>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResponse {
    pub provider: String,
    pub segments: Vec<TranscriptSegment>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum BackendOutput {
    Response(TranscriptionResponse),
    Segments(Vec<TranscriptSegment>),
}

/// Transcribes a local audio file using a local backend command when configured.
///
/// Set `MINUTESMITH_LOCAL_TRANSCRIBE_COMMAND` to a command that prints JSON to stdout.
/// The command receives `meeting_id` and `audio_path` as the final two arguments and may
/// return either `{ "segments": [...] }` or a raw segment array. No hosted APIs are called here.
#[tauri::command]
pub async fn transcribe_audio_file_local(
    meeting_id: String,
    audio_path: String,
) -> Result<TranscriptionResponse, String> {
    let meeting_id = meeting_id.trim().to_string();
    let audio_path = audio_path.trim().to_string();

    if meeting_id.is_empty() {
        return Err("Meeting id is required".to_string());
    }
    if audio_path.is_empty() {
        return Err("Audio path is required".to_string());
    }

    if let Ok(command) = std::env::var("MINUTESMITH_LOCAL_TRANSCRIBE_COMMAND") {
        let command = command.trim().to_string();
        if !command.is_empty() {
            return run_local_backend_command(&command, &meeting_id, &audio_path).await;
        }
    }

    Ok(placeholder_response(&audio_path))
}

async fn run_local_backend_command(
    command: &str,
    meeting_id: &str,
    audio_path: &str,
) -> Result<TranscriptionResponse, String> {
    let command = command.to_string();
    let meeting_id = meeting_id.to_string();
    let audio_path = audio_path.to_string();

    tokio::task::spawn_blocking(move || {
        let output = if cfg!(target_os = "windows") {
            let script = format!(r#"{} "{}" "{}""#, command, meeting_id, audio_path);
            Command::new("cmd").args(["/C", &script]).output()
        } else {
            let script = format!(r#"{} "$1" "$2""#, command);
            Command::new("sh")
                .args([
                    "-c",
                    &script,
                    "minutesmith-transcribe",
                    &meeting_id,
                    &audio_path,
                ])
                .output()
        }
        .map_err(|error| format!("Failed to start local transcription backend: {error}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                format!(
                    "Local transcription backend exited with status {}",
                    output.status
                )
            } else {
                stderr
            });
        }

        let stdout = String::from_utf8(output.stdout).map_err(|error| {
            format!("Local transcription backend returned non-UTF8 output: {error}")
        })?;
        let parsed: BackendOutput = serde_json::from_str(&stdout)
            .map_err(|error| format!("Failed to parse local transcription JSON: {error}"))?;

        let mut response = match parsed {
            BackendOutput::Response(response) => TranscriptionResponse {
                provider: if response.provider.trim().is_empty() {
                    "local-command".to_string()
                } else {
                    response.provider
                },
                segments: response.segments,
            },
            BackendOutput::Segments(segments) => TranscriptionResponse {
                provider: "local-command".to_string(),
                segments,
            },
        };

        validate_segments(&mut response.segments)?;
        Ok(response)
    })
    .await
    .map_err(|error| format!("Local transcription task failed: {error}"))?
}

fn validate_segments(segments: &mut [TranscriptSegment]) -> Result<(), String> {
    for segment in segments {
        segment.text = segment.text.trim().to_string();
        if segment.text.is_empty() {
            return Err("Local transcription returned an empty segment".to_string());
        }
        if segment.end_ms < segment.start_ms {
            return Err("Local transcription returned a segment with end before start".to_string());
        }
    }
    Ok(())
}

fn placeholder_response(audio_path: &str) -> TranscriptionResponse {
    let file_name = Path::new(audio_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(audio_path);

    TranscriptionResponse {
        provider: "local-placeholder".to_string(),
        segments: vec![TranscriptSegment {
            id: None,
            participant_id: None,
            speaker_label: Some("Local backend".to_string()),
            start_ms: 0,
            end_ms: 1000,
            text: format!(
                "Local transcription backend is not configured yet for {file_name}. Set MINUTESMITH_LOCAL_TRANSCRIBE_COMMAND to a faster-whisper compatible local command and retry."
            ),
            confidence: None,
            metadata: Some(serde_json::json!({
                "placeholder": true,
                "sourceAudioPath": audio_path
            })),
        }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_is_timestamped_and_local() {
        let response = placeholder_response("/tmp/meeting.wav");

        assert_eq!(response.provider, "local-placeholder");
        assert_eq!(response.segments[0].start_ms, 0);
        assert!(response.segments[0].end_ms > response.segments[0].start_ms);
        assert!(response.segments[0]
            .text
            .contains("MINUTESMITH_LOCAL_TRANSCRIBE_COMMAND"));
    }
}
