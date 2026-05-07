# Local faster-whisper transcription setup

MinuteSmith transcribes meeting audio locally. The normal capture flow writes a
meeting WAV file to local app data, stores that file path on the meeting record,
and passes the saved path to the transcription provider. Transcript segments are
then stored in SQLite with millisecond timestamps.

## Requirements

- Python 3.10 or newer is recommended. Python 3.9+ may work with current
  `faster-whisper` releases, but MinuteSmith development is tested against
  modern Python 3 versions.
- A working local Python environment with `pip`.
- Enough disk space for the selected Whisper/CTranslate2 model. The default app
  model is `small.en`.
- No hosted speech-to-text API key is required; transcription stays local.

## Create a virtual environment

macOS/Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
```

Windows PowerShell:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
```

## Install faster-whisper

Inside the activated virtual environment:

```bash
python -m pip install faster-whisper
```

If your audio files need formats outside WAV/standard media support, ensure your
system has FFmpeg available. MinuteSmith's durable meeting capture currently
writes WAV files, which faster-whisper can read in common local setups.

## Configure MinuteSmith

MinuteSmith defaults to the local faster-whisper provider. The Dashboard exposes:

- **faster-whisper model**: defaults to `small.en`; you can enter another model
  name such as `base`, `medium`, or a local CTranslate2 model directory.
- **Language**: defaults to `en`; leave it blank to let faster-whisper
  auto-detect where supported by the selected model.

Environment variables are also supported:

```bash
# Use the Python executable from your venv. Recommended for desktop launches.
export MINUTESMITH_PYTHON="/absolute/path/to/.venv/bin/python"

# Optional defaults if the UI does not override them.
export MINUTESMITH_FASTER_WHISPER_MODEL="small.en"
export MINUTESMITH_FASTER_WHISPER_LANGUAGE="en"

# Optional CTranslate2 tuning.
export MINUTESMITH_FASTER_WHISPER_DEVICE="auto"      # auto, cpu, cuda, etc.
export MINUTESMITH_FASTER_WHISPER_COMPUTE_TYPE="default" # default, int8, float16, etc.

# Optional command timeout. Default: 1800 seconds.
export MINUTESMITH_TRANSCRIPTION_TIMEOUT_SECS="1800"
```

For packaged desktop apps, set `MINUTESMITH_PYTHON` to the Python executable in
an environment visible to the app process. For development with `npm run tauri`,
launch from a shell where the variables above are exported.

## Expected local model behaviour

- On first use, faster-whisper may download the requested model into its local
  cache. If the network is unavailable and the model is not already cached (or
  the model path is invalid), MinuteSmith reports a model download/load error.
- Subsequent runs reuse the local model cache.
- Larger models generally improve accuracy but need more disk, memory, and time.
- `small.en` is English-only. Use a multilingual model such as `small`, `base`,
  or `medium` for non-English meetings.
- Diarisation is intentionally not enabled yet; segments use
  `speakerLabel: "Unknown"`.

## Local-command fallback for development

The legacy local command provider remains available for experiments and recovery.
Set:

```bash
export MINUTESMITH_TRANSCRIPTION_PROVIDER="local-command"
export MINUTESMITH_LOCAL_TRANSCRIBE_COMMAND="/path/to/transcribe-command"
```

The command receives `meeting_id` and `audio_path` as the final two arguments and
must print JSON to stdout in either of these forms:

```json
{
  "provider": "local-command",
  "model": "dev-model",
  "segments": [
    {
      "speakerLabel": "Unknown",
      "startMs": 0,
      "endMs": 4200,
      "text": "Example text",
      "confidence": 0.91,
      "metadata": {}
    }
  ]
}
```

or a raw array of segment objects.

## Troubleshooting errors

- **Python not found**: install Python and/or set `MINUTESMITH_PYTHON` to the
  venv's Python executable.
- **faster-whisper is not installed**: activate the venv and run
  `python -m pip install faster-whisper`.
- **Model download/load unavailable**: check the model name, local model path,
  disk space, cached model availability, and network access for first download.
- **Invalid audio file**: confirm the saved meeting audio path exists, is a file,
  is not empty, and can be decoded.
- **Command timeout**: increase `MINUTESMITH_TRANSCRIPTION_TIMEOUT_SECS`, choose a
  smaller model, or verify hardware acceleration settings.
