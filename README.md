# MinuteSmith

MinuteSmith is a local-first meeting notes app for capturing, transcribing, and summarising meetings on your own computer. The project is designed around explicit recording controls, local processing, and user-controlled storage rather than remote services.

MinuteSmith's product direction is to:

- Capture meeting audio locally from the desktop app.
- Transcribe meeting audio locally, with local provider scaffolding in place for tools such as faster-whisper.
- Use local LLMs such as Llama through Ollama for meeting intelligence.
- Generate useful meeting outputs: summaries, decisions, action items, risks, and follow-ups.
- Store meeting recordings, transcripts, summaries, and metadata locally.

## Project direction

This repository was forked from a desktop AI assistant shell, but MinuteSmith is being transformed into a dedicated local meeting-notes product. The app should be described and developed as transparent meeting capture software with explicit recording controls and local processing.

A short attribution/history note may mention the original fork when useful, but product copy, docs, metadata, and UI should focus on MinuteSmith's local-first meeting capture and summarisation workflows.

## Local-first principles

MinuteSmith is being built around these defaults and expectations:

- No hosted transcription by default; transcription should run on the user's machine unless they explicitly configure another provider.
- No hidden telemetry; the app should not send activity, analytics, transcripts, recordings, prompts, or summaries to a hosted service without clear user action.
- No remote model fetching; users choose and install local models themselves, such as Llama models served by Ollama.
- User-controlled local storage for meeting data, settings, transcripts, summaries, and generated follow-up material.
- Clear recording state rather than stealth behaviour, so users can understand when capture is active.

## Current status

MinuteSmith is currently a prototype with the following pieces in place or underway:

- Tauri/React desktop app shell.
- Local SQLite meeting data model for meetings, transcripts, summaries, action items, decisions, risks, and follow-ups.
- Meeting dashboard for browsing locally stored meeting records and status.
- Local transcription provider scaffolding.
- Ollama summarisation scaffolding for local LLM-generated meeting outputs.
- Durable audio capture is still in progress and should be treated as an active development area.

## Planned roadmap

Near-term work is focused on making the meeting workflow reliable end to end:

- Durable audio capture.
- faster-whisper integration for local transcription.
- Meeting detail page with transcript, summary, decisions, risks, and follow-ups.
- Summary quality improvements for actionability and consistency.
- Speaker diarisation.
- Export to Markdown, DOCX, and TXT.

## Local transcription

MinuteSmith records durable meeting audio to disk and transcribes it locally with a Python `faster-whisper` runner by default. See [Local faster-whisper transcription setup](docs/local-transcription.md) for Python version, virtual environment, install, model cache, and fallback local-command provider instructions.

## Development

```bash
npm install
npm run build
npm run tauri dev
```

For local AI features, install and run Ollama with the Llama model you want to use. For local transcription development, configure or extend the local transcription provider scaffolding. Provider credentials and app settings are stored locally in app storage.

## License

MinuteSmith remains licensed under the GPL-3.0 license.
