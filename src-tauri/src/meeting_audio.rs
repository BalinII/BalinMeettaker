use crate::speaker::SpeakerInput;
use futures_util::StreamExt;
use hound::{WavSpec, WavWriter};
use serde::Serialize;
use std::fs::{self, File};
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tokio::task::JoinHandle;
use tracing::{error, warn};

#[derive(Default)]
pub struct MeetingAudioState {
    capture: Mutex<Option<ActiveMeetingCapture>>,
}

struct ActiveMeetingCapture {
    meeting_id: String,
    audio_path: PathBuf,
    stop_flag: Arc<AtomicBool>,
    task: JoinHandle<Result<CapturedMeetingAudio, String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedMeetingAudio {
    pub meeting_id: String,
    pub audio_path: String,
    pub sample_rate: u32,
    pub sample_count: u64,
    pub duration_ms: u64,
}

#[tauri::command]
pub async fn start_meeting_audio_capture(
    app: AppHandle,
    meeting_id: String,
    device_id: Option<String>,
) -> Result<CapturedMeetingAudio, String> {
    let meeting_id = validate_meeting_id(&meeting_id)?;
    let state = app.state::<MeetingAudioState>();
    {
        let guard = state
            .capture
            .lock()
            .map_err(|error| format!("Failed to acquire meeting capture lock: {error}"))?;
        if guard.is_some() {
            return Err("Capture already running".to_string());
        }
    }

    let artifact_paths = build_meeting_artifact_paths(&app, &meeting_id)?;
    create_meeting_artifact_dirs(&artifact_paths)?;
    let audio_path = artifact_paths.audio_path;

    let input = SpeakerInput::new_with_device(device_id).map_err(|error| {
        error!("Failed to create meeting speaker input: {}", error);
        format!("Audio device unavailable: {error}")
    })?;
    let stream = input.stream();
    let sample_rate = stream.sample_rate();
    validate_sample_rate(sample_rate)?;

    let writer = create_wav_writer(&audio_path, sample_rate)?;
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_for_task = stop_flag.clone();
    let meeting_id_for_task = meeting_id.clone();
    let audio_path_for_task = audio_path.clone();

    let task = tokio::spawn(async move {
        write_meeting_wav(
            stream,
            writer,
            stop_flag_for_task,
            meeting_id_for_task,
            audio_path_for_task,
            sample_rate,
        )
        .await
    });

    let mut guard = state
        .capture
        .lock()
        .map_err(|error| format!("Failed to acquire meeting capture lock: {error}"))?;

    if guard.is_some() {
        stop_flag.store(true, Ordering::Release);
        return Err("Capture already running".to_string());
    }

    *guard = Some(ActiveMeetingCapture {
        meeting_id: meeting_id.clone(),
        audio_path: audio_path.clone(),
        stop_flag,
        task,
    });

    Ok(CapturedMeetingAudio {
        meeting_id,
        audio_path: path_to_string(&audio_path),
        sample_rate,
        sample_count: 0,
        duration_ms: 0,
    })
}

#[tauri::command]
pub async fn stop_meeting_audio_capture(
    app: AppHandle,
    meeting_id: String,
) -> Result<CapturedMeetingAudio, String> {
    let meeting_id = validate_meeting_id(&meeting_id)?;
    let active = {
        let state = app.state::<MeetingAudioState>();
        let mut guard = state
            .capture
            .lock()
            .map_err(|error| format!("Failed to acquire meeting capture lock: {error}"))?;

        let active = guard
            .take()
            .ok_or_else(|| "No meeting audio capture is running".to_string())?;

        if active.meeting_id != meeting_id {
            let running_id = active.meeting_id.clone();
            *guard = Some(active);
            return Err(format!(
                "Meeting audio capture is running for {running_id}, not {meeting_id}"
            ));
        }

        active
    };

    active.stop_flag.store(true, Ordering::Release);

    let result = active
        .task
        .await
        .map_err(|error| format!("Meeting audio capture task failed: {error}"))??;

    if result.sample_count == 0 {
        remove_empty_audio_file(&active.audio_path);
        return Err("No audio captured for this meeting".to_string());
    }

    Ok(result)
}

async fn write_meeting_wav(
    mut stream: impl StreamExt<Item = f32> + Unpin,
    mut writer: WavWriter<BufWriter<File>>,
    stop_flag: Arc<AtomicBool>,
    meeting_id: String,
    audio_path: PathBuf,
    sample_rate: u32,
) -> Result<CapturedMeetingAudio, String> {
    let started = Instant::now();
    let mut sample_count = 0_u64;

    while !stop_flag.load(Ordering::Acquire) {
        match tokio::time::timeout(Duration::from_millis(100), stream.next()).await {
            Ok(Some(sample)) => {
                let clamped = sample.clamp(-1.0, 1.0);
                let sample_i16 = (clamped * i16::MAX as f32) as i16;
                writer
                    .write_sample(sample_i16)
                    .map_err(|error| format!("Failed to write meeting audio sample: {error}"))?;
                sample_count += 1;
            }
            Ok(None) => {
                warn!("Meeting audio stream ended unexpectedly");
                break;
            }
            Err(_) => {}
        }
    }

    writer
        .finalize()
        .map_err(|error| format!("Failed to finalise meeting WAV file: {error}"))?;

    Ok(CapturedMeetingAudio {
        meeting_id,
        audio_path: path_to_string(&audio_path),
        sample_rate,
        sample_count,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

fn validate_meeting_id(meeting_id: &str) -> Result<String, String> {
    let trimmed = meeting_id.trim();
    if trimmed.is_empty() {
        return Err("Meeting id is required".to_string());
    }

    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
    {
        return Err("Meeting id contains unsupported path characters".to_string());
    }

    Ok(trimmed.to_string())
}

fn validate_sample_rate(sample_rate: u32) -> Result<(), String> {
    if !(8000..=96000).contains(&sample_rate) {
        return Err(format!(
            "Invalid sample rate: {sample_rate}. Expected 8000-96000 Hz"
        ));
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct MeetingArtifactPaths {
    meeting_dir: PathBuf,
    audio_dir: PathBuf,
    transcript_dir: PathBuf,
    summary_dir: PathBuf,
    audio_path: PathBuf,
}

fn build_meeting_artifact_paths(
    app: &AppHandle,
    meeting_id: &str,
) -> Result<MeetingArtifactPaths, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate local app data directory: {error}"))?;

    Ok(build_meeting_artifact_paths_from_base(
        &app_data_dir,
        meeting_id,
    ))
}

fn build_meeting_artifact_paths_from_base(
    base_dir: &Path,
    meeting_id: &str,
) -> MeetingArtifactPaths {
    let meeting_dir = base_dir.join("meetings").join(meeting_id);
    let audio_dir = meeting_dir.join("audio");
    let transcript_dir = meeting_dir.join("transcript");
    let summary_dir = meeting_dir.join("summary");
    let audio_path = audio_dir.join("system-audio.wav");

    MeetingArtifactPaths {
        meeting_dir,
        audio_dir,
        transcript_dir,
        summary_dir,
        audio_path,
    }
}

fn create_meeting_artifact_dirs(paths: &MeetingArtifactPaths) -> Result<(), String> {
    for dir in [
        &paths.meeting_dir,
        &paths.audio_dir,
        &paths.transcript_dir,
        &paths.summary_dir,
    ] {
        fs::create_dir_all(dir)
            .map_err(|error| format!("Failed to create local meeting artifact folder: {error}"))?;
    }
    Ok(())
}

fn create_wav_writer(
    audio_path: &Path,
    sample_rate: u32,
) -> Result<WavWriter<BufWriter<File>>, String> {
    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    WavWriter::create(audio_path, spec)
        .map_err(|error| format!("Failed to create local meeting WAV file: {error}"))
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn remove_empty_audio_file(audio_path: &Path) {
    if let Err(error) = fs::remove_file(audio_path) {
        warn!("Failed to remove empty meeting audio file: {}", error);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_safe_meeting_ids() {
        assert_eq!(
            validate_meeting_id("meeting_123-abc").unwrap(),
            "meeting_123-abc"
        );
        assert!(validate_meeting_id("../meeting").is_err());
        assert!(validate_meeting_id(" ").is_err());
    }

    #[test]
    fn validates_supported_sample_rates() {
        assert!(validate_sample_rate(16_000).is_ok());
        assert!(validate_sample_rate(7_999).is_err());
        assert!(validate_sample_rate(96_001).is_err());
    }

    #[test]
    fn builds_stable_local_meeting_artifact_paths() {
        let paths =
            build_meeting_artifact_paths_from_base(Path::new("/tmp/minutesmith"), "abc_123");

        assert_eq!(
            paths.audio_dir,
            Path::new("/tmp/minutesmith").join("meetings/abc_123/audio")
        );
        assert_eq!(
            paths.transcript_dir,
            Path::new("/tmp/minutesmith").join("meetings/abc_123/transcript")
        );
        assert_eq!(
            paths.summary_dir,
            Path::new("/tmp/minutesmith").join("meetings/abc_123/summary")
        );
        assert_eq!(paths.audio_path, paths.audio_dir.join("system-audio.wav"));
    }
}
