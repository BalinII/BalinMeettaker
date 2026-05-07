import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircleIcon,
  BrainCircuitIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ClockIcon,
  HeadphonesIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  RadioIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@/components";
import { PageLayout } from "@/layouts";
import { useApp } from "@/contexts";
import { cn } from "@/lib/utils";
import {
  createMeeting,
  deleteTranscriptSegments,
  getMeetingDetail,
  listMeetings,
  listTranscriptionRuns,
  saveTranscriptSegments,
  updateMeetingAudioPath,
  updateMeetingStatus,
  upsertTranscriptionRun,
} from "@/lib/database";
import {
  DEFAULT_OLLAMA_SUMMARY_MODEL,
  checkOllamaHealth,
  summarizeMeetingWithOllama,
} from "@/lib/summarization";
import {
  DEFAULT_FASTER_WHISPER_MODEL,
  FasterWhisperTranscriptionProvider,
} from "@/lib/transcription";
import type { Meeting, TranscriptionRun } from "@/types";

type CaptureState = "idle" | "recording" | "stopping";

type AudioDevice = {
  id: string;
  name: string;
  is_default: boolean;
};

type CapturedMeetingAudio = {
  meetingId: string;
  audioPath: string;
  sampleRate: number;
  sampleCount: number;
  durationMs: number;
};

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, remainingSeconds]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  }

  return [minutes, remainingSeconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
};

const formatMeetingTime = (timestamp?: number | null) => {
  if (!timestamp) return "Not started";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
};

const statusTone: Record<Meeting["status"], string> = {
  scheduled: "bg-muted text-muted-foreground border-border",
  recording: "bg-red-500/10 text-red-600 border-red-500/20",
  processing: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  cancelled: "bg-muted text-muted-foreground border-border",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
};

const Dashboard = () => {
  const { selectedAudioDevices } = useApp();
  const [meetingTitle, setMeetingTitle] = useState("Untitled meeting");
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [activeAudioPath, setActiveAudioPath] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recentMeetings, setRecentMeetings] = useState<Meeting[]>([]);
  const [transcriptionRuns, setTranscriptionRuns] = useState<
    TranscriptionRun[]
  >([]);
  const [ollamaModel, setOllamaModel] = useState(DEFAULT_OLLAMA_SUMMARY_MODEL);
  const [whisperModel, setWhisperModel] = useState(DEFAULT_FASTER_WHISPER_MODEL);
  const [transcriptionLanguage, setTranscriptionLanguage] = useState("en");
  const [summarizingMeetingIds, setSummarizingMeetingIds] = useState<
    Set<string>
  >(() => new Set());
  const [transcribingMeetingIds, setTranscribingMeetingIds] = useState<
    Set<string>
  >(() => new Set());
  const [devices, setDevices] = useState<{
    input: AudioDevice[];
    output: AudioDevice[];
  }>({ input: [], output: [] });
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [error, setError] = useState("");
  const [ollamaStatus, setOllamaStatus] = useState("");
  const [manualMeetingId, setManualMeetingId] = useState("");
  const [manualAudioPath, setManualAudioPath] = useState("");

  const isRecording = captureState === "recording";
  const isActive = captureState === "recording";

  const titleValue = meetingTitle.trim() || "Untitled meeting";

  const selectedMicName =
    selectedAudioDevices.input.name ||
    devices.input.find((device) => device.is_default)?.name ||
    "Default microphone";
  const selectedSystemAudioName =
    selectedAudioDevices.output.name ||
    devices.output.find((device) => device.is_default)?.name ||
    "Default system output";

  const captureLabel = useMemo(() => {
    if (error) return "Needs attention";
    if (captureState === "recording") return "Capturing meeting audio";
    if (captureState === "stopping") return "Stopping capture";
    return "Ready to capture";
  }, [captureState, error]);

  const refreshMeetings = useCallback(async () => {
    try {
      const [meetings, runs] = await Promise.all([
        listMeetings(),
        listTranscriptionRuns(),
      ]);
      setRecentMeetings(meetings.slice(0, 6));
      setTranscriptionRuns(runs);
    } catch (meetingError) {
      console.error("Failed to load meetings:", meetingError);
    }
  }, []);

  const transcriptionRunByMeetingId = useMemo(
    () =>
      new Map(transcriptionRuns.map((run) => [run.meetingId, run] as const)),
    [transcriptionRuns],
  );

  const transcribeMeetingAudio = useCallback(
    async (meeting: Meeting, audioPath: string) => {
      const trimmedAudioPath = audioPath.trim();
      if (!trimmedAudioPath) {
        setError("No saved meeting audio path is available for transcription.");
        return;
      }

      setError("");
      setTranscribingMeetingIds((current) => {
        const next = new Set(current);
        next.add(meeting.id);
        return next;
      });

      const transcriptionProvider = new FasterWhisperTranscriptionProvider(
        whisperModel.trim() || DEFAULT_FASTER_WHISPER_MODEL,
        transcriptionLanguage.trim() || undefined,
      );

      try {
        await upsertTranscriptionRun({
          meetingId: meeting.id,
          audioPath: trimmedAudioPath,
          provider: transcriptionProvider.id,
          status: "running",
          incrementAttempts: true,
          lastStartedAt: Date.now(),
        });
        await updateMeetingStatus(meeting.id, "processing");
        await refreshMeetings();

        const segments = await transcriptionProvider.transcribeAudioFile(
          meeting.id,
          trimmedAudioPath,
        );
        await deleteTranscriptSegments(meeting.id);
        await saveTranscriptSegments(meeting.id, segments);
        await upsertTranscriptionRun({
          meetingId: meeting.id,
          audioPath: trimmedAudioPath,
          provider: transcriptionProvider.id,
          status: "completed",
          completedAt: Date.now(),
        });
        await updateMeetingStatus(
          meeting.id,
          "completed",
          meeting.endedAt ?? Date.now(),
        );
      } catch (transcriptionError) {
        const message =
          transcriptionError instanceof Error
            ? transcriptionError.message
            : String(transcriptionError);
        await upsertTranscriptionRun({
          meetingId: meeting.id,
          audioPath: trimmedAudioPath,
          provider: transcriptionProvider.id,
          status: "failed",
          error: message,
        }).catch(() => undefined);
        await updateMeetingStatus(
          meeting.id,
          "failed",
          meeting.endedAt ?? Date.now(),
        ).catch(() => undefined);
        setError(message);
      } finally {
        setTranscribingMeetingIds((current) => {
          const next = new Set(current);
          next.delete(meeting.id);
          return next;
        });
        await refreshMeetings();
      }
    },
    [refreshMeetings, transcriptionLanguage, whisperModel],
  );

  const loadAudioDevices = useCallback(async () => {
    setIsLoadingDevices(true);
    try {
      const [inputDevices, outputDevices] = await Promise.all([
        invoke<AudioDevice[]>("get_input_devices"),
        invoke<AudioDevice[]>("get_output_devices"),
      ]);
      setDevices({ input: inputDevices, output: outputDevices });
    } catch (deviceError) {
      console.error("Failed to load audio devices:", deviceError);
    } finally {
      setIsLoadingDevices(false);
    }
  }, []);

  const startAudioCapture = useCallback(
    async (meetingId: string) => {
      if (captureState !== "idle") {
        throw new Error(
          "Capture already running. Stop the current meeting before starting another one.",
        );
      }

      const outputDevices = await invoke<AudioDevice[]>("get_output_devices");
      if (outputDevices.length === 0) {
        throw new Error(
          "No audio input found. MinuteSmith could not find a system audio output device to capture.",
        );
      }
      setDevices((current) => ({ ...current, output: outputDevices }));

      const hasAccess = await invoke<boolean>("check_system_audio_access");

      if (!hasAccess) {
        throw new Error(
          "System audio permission is required before MinuteSmith can capture a meeting.",
        );
      }

      return invoke<CapturedMeetingAudio>("start_meeting_audio_capture", {
        meetingId,
        deviceId:
          selectedAudioDevices.output.id &&
          selectedAudioDevices.output.id !== "default"
            ? selectedAudioDevices.output.id
            : null,
      });
    },
    [captureState, selectedAudioDevices.output.id],
  );

  const handleStartMeeting = async () => {
    let createdMeeting: Meeting | null = null;

    try {
      setError("");
      const now = Date.now();
      const meeting = await createMeeting({
        title: titleValue,
        status: "recording",
        startedAt: now,
      });
      createdMeeting = meeting;
      const capture = await startAudioCapture(meeting.id);

      setActiveMeeting(meeting);
      setActiveAudioPath(capture.audioPath);
      setStartedAt(now);
      setElapsedSeconds(0);
      setCaptureState("recording");
      await refreshMeetings();
    } catch (startError) {
      const message =
        startError instanceof Error ? startError.message : String(startError);
      setError(message);
      if (createdMeeting) {
        await updateMeetingStatus(
          createdMeeting.id,
          "failed",
          Date.now(),
        ).catch(() => undefined);
        await refreshMeetings();
      }
      setActiveAudioPath("");
      setCaptureState("idle");
    }
  };

  const handlePause = async () => {
    setError(
      "Pause is not available while durable meeting WAV capture is active. Stop the meeting to finalise audio and transcribe.",
    );
  };

  const handleStop = async () => {
    if (!activeMeeting) {
      setError("Stop called when no meeting capture is running.");
      return;
    }

    try {
      setCaptureState("stopping");
      setError("");
      const capturedAudio = await invoke<CapturedMeetingAudio>(
        "stop_meeting_audio_capture",
        { meetingId: activeMeeting.id },
      );
      const endedAt = Date.now();
      await updateMeetingAudioPath(activeMeeting.id, capturedAudio.audioPath);
      const completedMeeting = await updateMeetingStatus(
        activeMeeting.id,
        "processing",
        endedAt,
      );
      await upsertTranscriptionRun({
        meetingId: activeMeeting.id,
        audioPath: capturedAudio.audioPath,
        provider: "faster-whisper",
        status: "queued",
      });
      setCaptureState("idle");
      setActiveMeeting(null);
      setActiveAudioPath("");
      setStartedAt(null);
      setElapsedSeconds(0);
      setMeetingTitle("Untitled meeting");
      await refreshMeetings();

      if (completedMeeting) {
        await transcribeMeetingAudio(completedMeeting, capturedAudio.audioPath);
      }
    } catch (stopError) {
      const message =
        stopError instanceof Error ? stopError.message : String(stopError);
      setError(message);
      await updateMeetingStatus(activeMeeting.id, "failed", Date.now()).catch(
        () => undefined,
      );
      const run = transcriptionRunByMeetingId.get(activeMeeting.id);
      const audioPath = run?.audioPath || activeAudioPath;
      if (audioPath) {
        await upsertTranscriptionRun({
          meetingId: activeMeeting.id,
          audioPath,
          provider: "faster-whisper",
          status: "failed",
          error: message,
        }).catch(() => undefined);
      }
      setActiveMeeting(null);
      setActiveAudioPath("");
      setStartedAt(null);
      setElapsedSeconds(0);
      setCaptureState("idle");
      await refreshMeetings();
    }
  };

  const summarizeMeeting = useCallback(
    async (meeting: Meeting) => {
      setError("");
      setOllamaStatus("Checking Ollama...");
      setSummarizingMeetingIds((current) => {
        const next = new Set(current);
        next.add(meeting.id);
        return next;
      });

      try {
        const health = await checkOllamaHealth({ model: ollamaModel });
        if (!health.ok) {
          throw new Error(
            health.error ||
              `Ollama is not available at ${health.baseUrl} with model ${health.model}.`,
          );
        }

        const detail = await getMeetingDetail(meeting.id);
        if (!detail || detail.transcriptSegments.length === 0) {
          throw new Error(
            "No transcript segments are available. Transcribe the meeting before summarising.",
          );
        }

        setOllamaStatus("Summarising transcript with Ollama...");
        const result = await summarizeMeetingWithOllama({
          meetingId: meeting.id,
          transcriptSegments: detail.transcriptSegments,
          model: ollamaModel,
        });

        setOllamaStatus(
          `Saved summary (${result.chunkCount} chunk${
            result.chunkCount === 1 ? "" : "s"
          }) with ${result.model}.`,
        );
        await refreshMeetings();
      } catch (summaryError) {
        const message =
          summaryError instanceof Error
            ? summaryError.message
            : String(summaryError);
        setError(message);
        setOllamaStatus("Summarisation failed.");
      } finally {
        setSummarizingMeetingIds((current) => {
          const next = new Set(current);
          next.delete(meeting.id);
          return next;
        });
      }
    },
    [ollamaModel, refreshMeetings],
  );

  const handleRetryTranscription = (meeting: Meeting) => {
    const run = transcriptionRunByMeetingId.get(meeting.id);
    transcribeMeetingAudio(meeting, run?.audioPath || meeting.audioPath || "");
  };

  const handleManualTranscription = async () => {
    const meetingId = manualMeetingId.trim();
    const audioPath = manualAudioPath.trim();
    if (!meetingId || !audioPath) {
      setError(
        "Advanced transcription requires a meeting id and local audio path.",
      );
      return;
    }

    const meeting = await getMeetingDetail(meetingId);
    if (!meeting) {
      setError("No meeting found for the advanced transcription meeting id.");
      return;
    }

    await updateMeetingAudioPath(meeting.id, audioPath);
    await transcribeMeetingAudio({ ...meeting, audioPath }, audioPath);
  };

  useEffect(() => {
    refreshMeetings();
    loadAudioDevices();
  }, [loadAudioDevices, refreshMeetings]);

  useEffect(() => {
    if (!manualMeetingId && recentMeetings[0]) {
      setManualMeetingId(recentMeetings[0].id);
    }
  }, [manualMeetingId, recentMeetings]);

  useEffect(() => {
    if (!startedAt || !isActive) return;

    const updateTimer = () => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    };

    updateTimer();
    const timerId = window.setInterval(updateTimer, 1000);

    return () => window.clearInterval(timerId);
  }, [isActive, startedAt]);

  return (
    <PageLayout
      title="Meeting Capture"
      description="Start a meeting, monitor capture health, transcribe locally, and generate local Ollama summaries."
    >
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden border-primary/10 bg-gradient-to-br from-card via-card to-primary/5">
          <CardHeader className="gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="text-2xl">Capture dashboard</CardTitle>
                <CardDescription>
                  Control recording, transcription, and local Ollama
                  summarisation.
                </CardDescription>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "border px-3 py-1",
                  isRecording && "border-red-500/20 bg-red-500/10 text-red-600",
                  captureState === "idle" &&
                    "border-emerald-500/20 bg-emerald-500/10 text-emerald-600",
                )}
              >
                <RadioIcon
                  className={cn("size-3", isRecording && "animate-pulse")}
                />
                {captureLabel}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="meeting-title">
                Meeting title
              </label>
              <Input
                id="meeting-title"
                value={meetingTitle}
                onChange={(event) => setMeetingTitle(event.target.value)}
                disabled={isActive}
                placeholder="Weekly product sync"
                className="h-12 text-lg"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 rounded-2xl border bg-background/70 p-4">
                <p className="text-sm font-medium">Meeting audio file</p>
                <p className="text-xs text-muted-foreground">
                  Start Meeting creates meetings/&lt;meetingId&gt;/audio/,
                  transcript/, and summary/ under local app data. Stop finalises
                  audio/system-audio.wav, stores that path on the meeting, and
                  starts local transcription automatically.
                </p>
                <p className="truncate text-xs font-medium text-foreground">
                  {activeAudioPath || "No active audio file yet"}
                </p>
              </div>
              <div className="space-y-2 rounded-2xl border bg-background/70 p-4">
                <label className="text-sm font-medium" htmlFor="whisper-model">
                  faster-whisper model
                </label>
                <Input
                  id="whisper-model"
                  value={whisperModel}
                  onChange={(event) => setWhisperModel(event.target.value)}
                  placeholder={DEFAULT_FASTER_WHISPER_MODEL}
                  className="h-11"
                />
                <label className="text-sm font-medium" htmlFor="whisper-language">
                  Language (optional)
                </label>
                <Input
                  id="whisper-language"
                  value={transcriptionLanguage}
                  onChange={(event) =>
                    setTranscriptionLanguage(event.target.value)
                  }
                  placeholder="en, es, fr, or blank for auto-detect"
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">
                  Runs locally through Python/faster-whisper and saves timestamped
                  segments to SQLite. Blank language enables model auto-detect.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="ollama-model">
                  Ollama summary model
                </label>
                <Input
                  id="ollama-model"
                  value={ollamaModel}
                  onChange={(event) => setOllamaModel(event.target.value)}
                  placeholder={DEFAULT_OLLAMA_SUMMARY_MODEL}
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">
                  Uses local Ollama at 127.0.0.1:11434, validates JSON schema,
                  then saves summary, actions, and decisions locally.
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border bg-background/70 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <ClockIcon className="size-4" /> Duration
                </div>
                <div className="font-mono text-4xl font-semibold tracking-tight">
                  {formatDuration(elapsedSeconds)}
                </div>
              </div>
              <div className="rounded-2xl border bg-background/70 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <MicIcon className="size-4" /> Microphone
                </div>
                <p className="truncate text-sm font-medium">
                  {selectedMicName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {devices.input.length > 0
                    ? "Ready for meeting notes"
                    : "Using system default"}
                </p>
              </div>
              <div className="rounded-2xl border bg-background/70 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <HeadphonesIcon className="size-4" /> System audio
                </div>
                <p className="truncate text-sm font-medium">
                  {selectedSystemAudioName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isRecording ? "Capturing output audio" : "Ready"}
                </p>
              </div>
            </div>

            {ollamaStatus ? (
              <div className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm text-primary">
                <BrainCircuitIcon className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-medium">Ollama summarisation</p>
                  <p className="text-primary/80">{ollamaStatus}</p>
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-medium">Capture issue</p>
                  <p className="text-destructive/80">{error}</p>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                size="lg"
                onClick={handleStartMeeting}
                disabled={isActive || captureState === "stopping"}
                className="h-12 flex-1"
              >
                <PlayIcon className="size-4" /> Start Meeting
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={handlePause}
                disabled={!activeMeeting || captureState === "stopping"}
                className="h-12 flex-1"
              >
                <PauseIcon className="size-4" />
                Pause unavailable
              </Button>
              <Button
                size="lg"
                variant="destructive"
                onClick={handleStop}
                disabled={!activeMeeting || captureState === "stopping"}
                className="h-12 flex-1"
              >
                <SquareIcon className="size-4" /> Stop
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Capture status</CardTitle>
            <CardDescription>
              Current meeting state and audio readiness.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant="outline">{captureLabel}</Badge>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Recording</span>
                <span className="text-sm font-medium">
                  {isRecording ? "recording" : "not recording"}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Started</span>
                <span className="text-sm font-medium">
                  {startedAt ? formatMeetingTime(startedAt) : "Not active"}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Audio file</span>
                <span className="max-w-[190px] truncate text-right text-sm font-medium">
                  {activeAudioPath
                    ? captureState === "recording"
                      ? "writing WAV safely"
                      : activeAudioPath
                    : "not created"}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  Transcription
                </span>
                <span className="text-sm font-medium capitalize">
                  {activeMeeting
                    ? (transcriptionRunByMeetingId.get(activeMeeting.id)
                        ?.status ?? "starts after stop")
                    : "idle"}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-2xl border p-3">
                <CheckCircle2Icon className="size-4 text-emerald-600" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Mic status</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {selectedMicName}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border p-3">
                <CheckCircle2Icon
                  className={cn(
                    "size-4",
                    isRecording ? "text-red-600" : "text-emerald-600",
                  )}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">System audio status</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {selectedSystemAudioName} ·{" "}
                    {isRecording ? "capturing" : "ready"}
                  </p>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              onClick={loadAudioDevices}
              disabled={isLoadingDevices}
              className="w-full"
            >
              {isLoadingDevices
                ? "Refreshing audio devices..."
                : "Refresh audio status"}
            </Button>

            <details className="rounded-2xl border bg-muted/20 p-4 text-sm">
              <summary className="cursor-pointer font-medium">
                Advanced/dev: transcribe a local audio path manually
              </summary>
              <div className="mt-4 space-y-3">
                <label
                  className="text-xs font-medium"
                  htmlFor="manual-meeting-id"
                >
                  Meeting id
                </label>
                <Input
                  id="manual-meeting-id"
                  value={manualMeetingId}
                  onChange={(event) => setManualMeetingId(event.target.value)}
                  placeholder="Existing meeting id"
                />
                <label
                  className="text-xs font-medium"
                  htmlFor="manual-audio-path"
                >
                  Local audio path
                </label>
                <Input
                  id="manual-audio-path"
                  value={manualAudioPath}
                  onChange={(event) => setManualAudioPath(event.target.value)}
                  placeholder="/path/to/meeting.wav"
                />
                <Button
                  variant="outline"
                  onClick={handleManualTranscription}
                  disabled={!manualMeetingId.trim() || !manualAudioPath.trim()}
                  className="w-full"
                >
                  Transcribe manual path
                </Button>
                <p className="text-xs text-muted-foreground">
                  This bypass is only for recovery and provider development;
                  normal meetings use the saved audio artefact automatically.
                </p>
              </div>
            </details>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Recent meetings</CardTitle>
              <CardDescription>
                Latest meeting captures stored locally.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={refreshMeetings}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {recentMeetings.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No meetings captured yet. Start a meeting to create the first
              entry.
            </div>
          ) : (
            <div className="divide-y rounded-2xl border">
              {recentMeetings.map((meeting) => {
                const transcriptionRun = transcriptionRunByMeetingId.get(
                  meeting.id,
                );
                const isTranscribing = transcribingMeetingIds.has(meeting.id);
                const isSummarizing = summarizingMeetingIds.has(meeting.id);
                const transcriptionStatus = transcriptionRun?.status ?? "idle";

                return (
                  <div
                    key={meeting.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <CalendarClockIcon className="size-4 text-muted-foreground" />
                        <Link
                          to={`/meetings/${meeting.id}`}
                          className="truncate font-medium hover:text-primary hover:underline"
                        >
                          {meeting.title}
                        </Link>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatMeetingTime(meeting.startedAt)}
                        {meeting.endedAt
                          ? ` · ${formatDuration(Math.floor((meeting.endedAt - (meeting.startedAt ?? meeting.createdAt)) / 1000))}`
                          : ""}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        Transcription:{" "}
                        <span className="capitalize">
                          {transcriptionStatus}
                        </span>
                        {transcriptionRun?.attempts
                          ? ` · ${transcriptionRun.attempts} attempt${transcriptionRun.attempts === 1 ? "" : "s"}`
                          : ""}
                        {transcriptionRun?.audioPath || meeting.audioPath
                          ? ` · ${transcriptionRun?.audioPath ?? meeting.audioPath}`
                          : ""}
                        {isSummarizing ? " · summarising with Ollama" : ""}
                      </p>
                      {transcriptionRun?.error ? (
                        <p className="mt-1 text-xs text-destructive">
                          {transcriptionRun.error}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/meetings/${meeting.id}`}>Review</Link>
                      </Button>
                      <Badge
                        variant="outline"
                        className={cn("capitalize", statusTone[meeting.status])}
                      >
                        {meeting.status}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRetryTranscription(meeting)}
                        disabled={
                          isTranscribing ||
                            !(transcriptionRun?.audioPath || meeting.audioPath)
                        }
                      >
                        <RotateCcwIcon
                          className={cn(
                            "size-3",
                            isTranscribing && "animate-spin",
                          )}
                        />
                        {transcriptionStatus === "failed"
                          ? "Retry"
                          : "Transcribe"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => summarizeMeeting(meeting)}
                        disabled={
                          isSummarizing || transcriptionStatus !== "completed"
                        }
                      >
                        <BrainCircuitIcon
                          className={cn(
                            "size-3",
                            isSummarizing && "animate-pulse",
                          )}
                        />
                        Summarise
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </PageLayout>
  );
};

export default Dashboard;
