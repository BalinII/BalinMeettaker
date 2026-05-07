use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const FASTER_WHISPER_RUNNER: &str = include_str!("../scripts/transcribe_faster_whisper.py");
const DEFAULT_FASTER_WHISPER_MODEL: &str = "small.en";
const DEFAULT_TRANSCRIPTION_TIMEOUT_SECS: u64 = 60 * 30;

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
    pub model: Option<String>,
    pub segments: Vec<TranscriptSegment>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum BackendOutput {
    Response(TranscriptionResponse),
    Segments(Vec<TranscriptSegment>),
}

#[tauri::command]
pub async fn transcribe_audio_file_faster_whisper(
    meeting_id: String,
    audio_path: String,
    model_name: Option<String>,
    language: Option<String>,
) -> Result<TranscriptionResponse, String> {
    let meeting_id = validate_required(&meeting_id, "Meeting id")?;
    let audio_path = validate_audio_path(&audio_path)?;
    let model_name = model_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| std::env::var("MINUTESMITH_FASTER_WHISPER_MODEL").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_FASTER_WHISPER_MODEL.to_string());
    let language = language
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| std::env::var("MINUTESMITH_FASTER_WHISPER_LANGUAGE").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    run_faster_whisper_runner(&meeting_id, &audio_path, &model_name, language.as_deref()).await
}

#[tauri::command]
pub async fn transcribe_audio_file_local_command(
    meeting_id: String,
    audio_path: String,
) -> Result<TranscriptionResponse, String> {
    let meeting_id = validate_required(&meeting_id, "Meeting id")?;
    let audio_path = validate_audio_path(&audio_path)?;
    let command = std::env::var("MINUTESMITH_LOCAL_TRANSCRIBE_COMMAND")
        .map(|value| value.trim().to_string())
        .unwrap_or_default();

    if command.is_empty() {
        return Err("Transcription command not configured. Set MINUTESMITH_LOCAL_TRANSCRIBE_COMMAND to use the local-command provider.".to_string());
    }

    run_local_backend_command(&command, &meeting_id, &audio_path).await
}

/// Transcribes a local audio file using the configured local provider.
///
/// `MINUTESMITH_TRANSCRIPTION_PROVIDER=local-command` preserves the legacy dev
/// command runner. Otherwise MinuteSmith defaults to bundled faster-whisper
/// runner execution. No hosted transcription APIs are called here.
#[tauri::command]
pub async fn transcribe_audio_file_local(
    meeting_id: String,
    audio_path: String,
    model_name: Option<String>,
    language: Option<String>,
) -> Result<TranscriptionResponse, String> {
    let provider = std::env::var("MINUTESMITH_TRANSCRIPTION_PROVIDER")
        .unwrap_or_else(|_| "faster-whisper".to_string())
        .trim()
        .to_string();

    if provider.eq_ignore_ascii_case("local-command") {
        return transcribe_audio_file_local_command(meeting_id, audio_path).await;
    }

    transcribe_audio_file_faster_whisper(meeting_id, audio_path, model_name, language).await
}

async fn run_faster_whisper_runner(
    _meeting_id: &str,
    audio_path: &str,
    model_name: &str,
    language: Option<&str>,
) -> Result<TranscriptionResponse, String> {
    let python = configured_python_command();
    let audio_path = audio_path.to_string();
    let model_name = model_name.to_string();
    let language = language.map(ToOwned::to_owned);

    tokio::task::spawn_blocking(move || {
        let mut args = vec![
            "-c".to_string(),
            FASTER_WHISPER_RUNNER.to_string(),
            "--audio-path".to_string(),
            audio_path,
            "--model".to_string(),
            model_name.clone(),
            "--output-format".to_string(),
            "json".to_string(),
        ];
        if let Some(language) = language {
            args.push("--language".to_string());
            args.push(language);
        }

        let output = run_command_with_timeout(&python, &args, transcription_timeout())?;
        parse_backend_output(
            output,
            "faster-whisper",
            Some(model_name),
            "faster-whisper runner",
        )
    })
    .await
    .map_err(|error| format!("faster-whisper transcription task failed: {error}"))?
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
        let (program, args) = if cfg!(target_os = "windows") {
            (
                "cmd".to_string(),
                vec![
                    "/C".to_string(),
                    format!(r#"{} "{}" "{}""#, command, meeting_id, audio_path),
                ],
            )
        } else {
            (
                "sh".to_string(),
                vec![
                    "-c".to_string(),
                    format!(r#"{} "$1" "$2""#, command),
                    "minutesmith-transcribe".to_string(),
                    meeting_id,
                    audio_path,
                ],
            )
        };

        let output = run_command_with_timeout(&program, &args, transcription_timeout())?;
        parse_backend_output(output, "local-command", None, "local transcription backend")
    })
    .await
    .map_err(|error| format!("Local transcription task failed: {error}"))?
}

fn configured_python_command() -> String {
    std::env::var("MINUTESMITH_PYTHON")
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if cfg!(target_os = "windows") {
                "python".to_string()
            } else {
                "python3".to_string()
            }
        })
}

fn transcription_timeout() -> Duration {
    let seconds = std::env::var("MINUTESMITH_TRANSCRIPTION_TIMEOUT_SECS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|seconds| *seconds > 0)
        .unwrap_or(DEFAULT_TRANSCRIPTION_TIMEOUT_SECS);
    Duration::from_secs(seconds)
}

fn run_command_with_timeout(
    program: &str,
    args: &[String],
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let mut child = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| match error.kind() {
            ErrorKind::NotFound => format!(
                "Python not found: could not start '{program}'. Set MINUTESMITH_PYTHON to the Python executable inside your faster-whisper virtual environment."
            ),
            _ => format!("Failed to start local transcription process '{program}': {error}"),
        })?;

    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                return child.wait_with_output().map_err(|error| {
                    format!("Failed to read local transcription output: {error}")
                });
            }
            Ok(None) if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "Command timeout: local transcription exceeded {} seconds",
                    timeout.as_secs()
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(250)),
            Err(error) => {
                let _ = child.kill();
                return Err(format!(
                    "Failed while waiting for local transcription process: {error}"
                ));
            }
        }
    }
}

fn parse_backend_output(
    output: std::process::Output,
    fallback_provider: &str,
    fallback_model: Option<String>,
    backend_label: &str,
) -> Result<TranscriptionResponse, String> {
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("{backend_label} exited with status {}", output.status)
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|error| format!("{backend_label} returned non-UTF8 output: {error}"))?;
    let parsed: BackendOutput = serde_json::from_str(&stdout)
        .map_err(|error| format!("Failed to parse {backend_label} JSON: {error}"))?;

    let mut response = match parsed {
        BackendOutput::Response(response) => TranscriptionResponse {
            provider: if response.provider.trim().is_empty() {
                fallback_provider.to_string()
            } else {
                response.provider
            },
            model: response.model.or(fallback_model),
            segments: response.segments,
        },
        BackendOutput::Segments(segments) => TranscriptionResponse {
            provider: fallback_provider.to_string(),
            model: fallback_model,
            segments,
        },
    };

    validate_segments(&mut response.segments)?;
    Ok(response)
}

fn validate_required(value: &str, field_name: &str) -> Result<String, String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        Err(format!("{field_name} is required"))
    } else {
        Ok(value)
    }
}

fn validate_audio_path(audio_path: &str) -> Result<String, String> {
    let audio_path = validate_required(audio_path, "Audio path")?;
    let path = Path::new(&audio_path);
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Invalid audio file: {audio_path} cannot be read: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("Invalid audio file: {audio_path} is not a file"));
    }
    if metadata.len() == 0 {
        return Err(format!("Invalid audio file: {audio_path} is empty"));
    }
    Ok(audio_path)
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
        if segment.speaker_label.is_none() {
            segment.speaker_label = Some("Unknown".to_string());
        }
        if segment.metadata.is_none() {
            segment.metadata = Some(serde_json::json!({}));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_segments_trims_text_and_rejects_bad_timing() {
        let mut segments = vec![TranscriptSegment {
            id: None,
            participant_id: None,
            speaker_label: None,
            start_ms: 10,
            end_ms: 20,
            text: "  Hello from local audio  ".to_string(),
            confidence: None,
            metadata: None,
        }];

        validate_segments(&mut segments).expect("valid segments should pass");
        assert_eq!(segments[0].text, "Hello from local audio");
        assert_eq!(segments[0].speaker_label.as_deref(), Some("Unknown"));
        assert!(segments[0].metadata.is_some());

        segments[0].end_ms = 5;
        assert!(validate_segments(&mut segments).is_err());
    }

    #[test]
    fn defaults_to_python3_on_unix() {
        if !cfg!(target_os = "windows") && std::env::var("MINUTESMITH_PYTHON").is_err() {
            assert_eq!(configured_python_command(), "python3");
        }
    }
}
