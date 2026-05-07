# MinuteSmith

MinuteSmith is a local-first meeting notes app prototype forked from the original Tauri/React desktop app.

The app is focused on local meeting capture and note-taking workflows:

- Tauri desktop shell with React routing.
- SQLite-backed local chat and system-prompt storage.
- Global shortcuts for opening the dashboard, screenshots, and capture controls.
- Audio device settings and system audio capture commands.
- Local settings for themes, shortcuts, screenshots, responses, and custom providers.
- Configurable custom AI and speech-to-text providers supplied by the user.

Hosted licensing, hosted model/prompt fetching, activity/error reporting, PostHog analytics, and branded updater endpoints have been disabled so this prototype can run without the original remote services.

## Development

```bash
npm install
npm run build
npm run tauri dev
```

For AI or speech-to-text features, add your own provider curl commands in Dev Space. Provider credentials are stored locally in app storage.
