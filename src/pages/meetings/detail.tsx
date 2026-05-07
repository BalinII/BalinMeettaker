import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FileAudioIcon,
  FileTextIcon,
  HelpCircleIcon,
  ListChecksIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  deleteTranscriptSegments,
  getMeetingDetail,
  saveTranscriptSegments,
  updateMeetingStatus,
  upsertTranscriptionRun,
} from "@/lib/database";
import {
  DEFAULT_OLLAMA_SUMMARY_MODEL,
  summarizeMeetingWithOllama,
} from "@/lib/summarization";
import {
  DEFAULT_FASTER_WHISPER_MODEL,
  FasterWhisperTranscriptionProvider,
} from "@/lib/transcription";
import type {
  ActionItem,
  Decision,
  Meeting,
  MeetingDetail,
  Summary,
  TranscriptSegment,
  TranscriptionStatus,
} from "@/types";

type SummaryJson = {
  executive_summary?: unknown;
  key_topics?: unknown;
  decisions?: unknown;
  action_items?: unknown;
  risks_or_blockers?: unknown;
  follow_up_questions?: unknown;
  clean_notes?: unknown;
  metadata?: unknown;
};

const statusTone: Record<Meeting["status"], string> = {
  scheduled: "bg-muted text-muted-foreground border-border",
  recording: "bg-red-500/10 text-red-600 border-red-500/20",
  processing: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  cancelled: "bg-muted text-muted-foreground border-border",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
};

const transcriptionTone: Record<TranscriptionStatus, string> = {
  idle: "bg-muted text-muted-foreground border-border",
  queued: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  running: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
};

const formatDateTime = (timestamp?: number | null) => {
  if (!timestamp) return "Not recorded";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
};

const formatDurationFromMs = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return [hours, minutes, remainingSeconds]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  }

  return [minutes, remainingSeconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
};

const formatSegmentTime = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
};

const asString = (value: unknown) => (typeof value === "string" ? value : "");

const asStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const latestSummary = (detail: MeetingDetail) => detail.summaries[0] ?? null;

const getSummaryJson = (summary: Summary | null): SummaryJson =>
  summary ? (summary.structuredJson as SummaryJson) : {};

const getRelevantActions = (detail: MeetingDetail, summary: Summary | null) => {
  if (!summary) return detail.actions;
  const scoped = detail.actions.filter((action) => action.summaryId === summary.id);
  return scoped.length > 0 ? scoped : detail.actions;
};

const getRelevantDecisions = (detail: MeetingDetail, summary: Summary | null) => {
  if (!summary) return detail.decisions;
  const scoped = detail.decisions.filter(
    (decision) => decision.summaryId === summary.id,
  );
  return scoped.length > 0 ? scoped : detail.decisions;
};

const buildTranscriptMarkdown = (segments: TranscriptSegment[]) =>
  segments
    .map(
      (segment) =>
        `- [${formatSegmentTime(segment.startMs)}-${formatSegmentTime(
          segment.endMs,
        )}] ${segment.speakerLabel || "Speaker"}: ${segment.text}`,
    )
    .join("\n");

const buildListMarkdown = (items: string[]) =>
  items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "_None captured._";

const buildDecisionsMarkdown = (decisions: Decision[]) =>
  decisions.length > 0
    ? decisions
        .map(
          (decision) =>
            `- ${decision.title}${decision.description ? ` — ${decision.description}` : ""}`,
        )
        .join("\n")
    : "_None captured._";

const buildActionsMarkdown = (actions: ActionItem[]) =>
  actions.length > 0
    ? actions
        .map((action) => {
          const details = [
            action.owner ? `Owner: ${action.owner}` : null,
            action.dueAt ? `Due: ${formatDateTime(action.dueAt)}` : null,
            `Status: ${action.status.replace(/_/g, " ")}`,
          ]
            .filter(Boolean)
            .join("; ");
          return `- ${action.description}${details ? ` (${details})` : ""}`;
        })
        .join("\n")
    : "_None captured._";

const SectionList = ({ emptyLabel, items }: { emptyLabel: string; items: string[] }) => {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-2 text-sm">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="rounded-xl border bg-background/70 p-3">
          {item}
        </li>
      ))}
    </ul>
  );
};

const MeetingDetailPage = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [whisperModel, setWhisperModel] = useState(DEFAULT_FASTER_WHISPER_MODEL);
  const [transcriptionLanguage, setTranscriptionLanguage] = useState("en");
  const [ollamaModel, setOllamaModel] = useState(DEFAULT_OLLAMA_SUMMARY_MODEL);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadMeeting = useCallback(async () => {
    if (!meetingId) return;
    setIsLoading(true);
    try {
      const meetingDetail = await getMeetingDetail(meetingId);
      setDetail(meetingDetail);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    loadMeeting();
  }, [loadMeeting]);

  const summary = useMemo(() => (detail ? latestSummary(detail) : null), [detail]);
  const summaryJson = useMemo(() => getSummaryJson(summary), [summary]);
  const decisions = useMemo(
    () => (detail ? getRelevantDecisions(detail, summary) : []),
    [detail, summary],
  );
  const actions = useMemo(
    () => (detail ? getRelevantActions(detail, summary) : []),
    [detail, summary],
  );

  const transcriptionStatus = detail?.transcriptionRun?.status ?? "idle";
  const duration = detail?.endedAt
    ? formatDurationFromMs(detail.endedAt - (detail.startedAt ?? detail.createdAt))
    : "In progress / unknown";
  const savedAudioPath = detail?.audioPath || detail?.transcriptionRun?.audioPath || "";
  const audioStatus = savedAudioPath ? "Saved" : "Missing";
  const summaryStatus = summary ? "Generated" : "Not generated";

  const handleRetryTranscription = async () => {
    if (!detail) return;
    const audioPath = (detail.transcriptionRun?.audioPath || detail.audioPath || "").trim();
    if (!audioPath) {
      setError("No saved audio path is available for this meeting.");
      return;
    }

    const provider = new FasterWhisperTranscriptionProvider(
      whisperModel.trim() || DEFAULT_FASTER_WHISPER_MODEL,
      transcriptionLanguage.trim() || undefined,
    );

    setError("");
    setNotice("Running local transcription...");
    setIsTranscribing(true);
    try {
      await upsertTranscriptionRun({
        meetingId: detail.id,
        audioPath,
        provider: provider.id,
        status: "running",
        incrementAttempts: true,
        lastStartedAt: Date.now(),
      });
      await updateMeetingStatus(detail.id, "processing");
      await loadMeeting();

      const segments = await provider.transcribeAudioFile(detail.id, audioPath);
      await deleteTranscriptSegments(detail.id);
      await saveTranscriptSegments(detail.id, segments);
      await upsertTranscriptionRun({
        meetingId: detail.id,
        audioPath,
        provider: provider.id,
        status: "completed",
        completedAt: Date.now(),
      });
      await updateMeetingStatus(detail.id, "completed", detail.endedAt ?? Date.now());
      setNotice("Transcription completed and saved to SQLite.");
      await loadMeeting();
    } catch (transcriptionError) {
      const message =
        transcriptionError instanceof Error
          ? transcriptionError.message
          : String(transcriptionError);
      await upsertTranscriptionRun({
        meetingId: detail.id,
        audioPath,
        provider: provider.id,
        status: "failed",
        error: message,
      }).catch(() => undefined);
      await updateMeetingStatus(detail.id, "failed", detail.endedAt ?? Date.now()).catch(
        () => undefined,
      );
      setError(message);
      setNotice("");
      await loadMeeting();
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleGenerateSummary = async () => {
    if (!detail) return;
    if (detail.transcriptSegments.length === 0) {
      setError("Transcribe the meeting before generating a summary.");
      return;
    }

    setError("");
    setNotice("Generating local Ollama summary...");
    setIsSummarizing(true);
    try {
      const result = await summarizeMeetingWithOllama({
        meetingId: detail.id,
        transcriptSegments: detail.transcriptSegments,
        model: ollamaModel,
      });
      setNotice(
        `Summary saved with ${result.model} from ${result.chunkCount} transcript chunk${
          result.chunkCount === 1 ? "" : "s"
        }.`,
      );
      await loadMeeting();
    } catch (summaryError) {
      setError(summaryError instanceof Error ? summaryError.message : String(summaryError));
      setNotice("");
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleExportMarkdown = () => {
    if (!detail) return;
    const topics = asStringArray(summaryJson.key_topics);
    const risks = asStringArray(summaryJson.risks_or_blockers);
    const questions = asStringArray(summaryJson.follow_up_questions);
    const markdown = `# ${detail.title}\n\n` +
      `- Date/time: ${formatDateTime(detail.startedAt)}\n` +
      `- Duration: ${duration}\n` +
      `- Status: ${detail.status}\n` +
      `- Audio file: ${audioStatus}${savedAudioPath ? ` (${savedAudioPath})` : ""}\n` +
      `- Transcription: ${transcriptionStatus}\n` +
      `- Summary: ${summaryStatus}\n\n` +
      `## Executive summary\n\n${asString(summaryJson.executive_summary) || "_Not generated._"}\n\n` +
      `## Key topics\n\n${buildListMarkdown(topics)}\n\n` +
      `## Decisions\n\n${buildDecisionsMarkdown(decisions)}\n\n` +
      `## Action items\n\n${buildActionsMarkdown(actions)}\n\n` +
      `## Risks / blockers\n\n${buildListMarkdown(risks)}\n\n` +
      `## Follow-up questions\n\n${buildListMarkdown(questions)}\n\n` +
      `## Clean notes\n\n${asString(summaryJson.clean_notes) || "_Not generated._"}\n\n` +
      `## Transcript\n\n${buildTranscriptMarkdown(detail.transcriptSegments) || "_No transcript available._"}\n`;

    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${detail.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${detail.id}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <PageLayout title="Meeting detail" description="Loading meeting detail..." allowBackButton>
        <Card>
          <CardContent className="flex items-center gap-3 p-8 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Loading meeting from SQLite...
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  if (!detail) {
    return (
      <PageLayout title="Meeting not found" description="No local meeting exists for this id." allowBackButton>
        <Card>
          <CardContent className="space-y-4 p-8">
            <p className="text-sm text-muted-foreground">
              The requested meeting could not be loaded from SQLite.
            </p>
            <Button asChild variant="outline">
              <Link to="/dashboard">
                <ArrowLeftIcon className="size-4" /> Back to dashboard
              </Link>
            </Button>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  const topics = asStringArray(summaryJson.key_topics);
  const risks = asStringArray(summaryJson.risks_or_blockers);
  const questions = asStringArray(summaryJson.follow_up_questions);

  return (
    <PageLayout
      title={detail.title}
      description="Review transcript, summary, decisions, and action items saved locally."
      allowBackButton
      rightSlot={
        <Button variant="outline" size="sm" onClick={handleExportMarkdown}>
          <DownloadIcon className="size-4" /> Export Markdown
        </Button>
      }
    >
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Date/time</CardDescription>
            <CardTitle className="text-base">{formatDateTime(detail.startedAt)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Duration</CardDescription>
            <CardTitle className="font-mono text-base">{duration}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Meeting status</CardDescription>
            <Badge variant="outline" className={cn("capitalize", statusTone[detail.status])}>
              {detail.status}
            </Badge>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Summary status</CardDescription>
            <Badge variant="outline" className={summary ? transcriptionTone.completed : transcriptionTone.idle}>
              {summaryStatus}
            </Badge>
          </CardHeader>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle>Transcript</CardTitle>
                <CardDescription>
                  Timestamped segments with a placeholder speaker label column. Diarisation is not enabled yet.
                </CardDescription>
              </div>
              <Badge variant="outline" className={cn("capitalize", transcriptionTone[transcriptionStatus])}>
                {transcriptionStatus}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {transcriptionStatus === "failed" ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-5 text-sm text-destructive">
                <div className="flex items-center gap-2 font-medium">
                  <AlertCircleIcon className="size-4" /> Transcription failed
                </div>
                <p className="mt-2 text-destructive/80">
                  {detail.transcriptionRun?.error || "No error message was saved for this run."}
                </p>
              </div>
            ) : detail.transcriptSegments.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                <MessageSquareTextIcon className="mx-auto mb-3 size-8" />
                Transcript has not run yet. Use Retry transcription after audio is saved.
              </div>
            ) : (
              <div className="max-h-[560px] overflow-y-auto rounded-2xl border">
                <div className="sticky top-0 grid grid-cols-[96px_128px_minmax(0,1fr)] gap-3 border-b bg-muted/80 p-3 text-xs font-medium text-muted-foreground backdrop-blur">
                  <span>Time</span>
                  <span>Speaker</span>
                  <span>Text</span>
                </div>
                <div className="divide-y">
                  {detail.transcriptSegments.map((segment) => (
                    <div
                      key={segment.id}
                      className="grid grid-cols-[96px_128px_minmax(0,1fr)] gap-3 p-3 text-sm"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatSegmentTime(segment.startMs)}
                      </span>
                      <span className="truncate text-xs font-medium text-muted-foreground">
                        {segment.speakerLabel || "Speaker"}
                      </span>
                      <p className="leading-6">{segment.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Meeting artefacts</CardTitle>
              <CardDescription>Status for audio, transcription, and summary.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-start gap-3 rounded-2xl border p-3">
                <FileAudioIcon className="mt-0.5 size-4 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="font-medium">Audio file: {audioStatus}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {savedAudioPath || "No audio path saved"}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-2xl border p-3">
                <span>Transcription</span>
                <Badge variant="outline" className={cn("capitalize", transcriptionTone[transcriptionStatus])}>
                  {transcriptionStatus}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-2xl border p-3">
                <span>Summary</span>
                <Badge variant="outline" className={summary ? transcriptionTone.completed : transcriptionTone.idle}>
                  {summaryStatus}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
              <CardDescription>Run local processing again from this meeting.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2">
                <label className="text-xs font-medium" htmlFor="detail-whisper-model">
                  faster-whisper model
                </label>
                <Input
                  id="detail-whisper-model"
                  value={whisperModel}
                  onChange={(event) => setWhisperModel(event.target.value)}
                />
                <label className="text-xs font-medium" htmlFor="detail-whisper-language">
                  Language
                </label>
                <Input
                  id="detail-whisper-language"
                  value={transcriptionLanguage}
                  onChange={(event) => setTranscriptionLanguage(event.target.value)}
                  placeholder="en, es, fr, or blank"
                />
              </div>
              <Button
                variant="outline"
                onClick={handleRetryTranscription}
                disabled={isTranscribing || !savedAudioPath}
                className="w-full"
              >
                <RefreshCwIcon className={cn("size-4", isTranscribing && "animate-spin")} />
                Retry transcription
              </Button>
              <div className="grid gap-2 pt-2">
                <label className="text-xs font-medium" htmlFor="detail-ollama-model">
                  Ollama summary model
                </label>
                <Input
                  id="detail-ollama-model"
                  value={ollamaModel}
                  onChange={(event) => setOllamaModel(event.target.value)}
                />
              </div>
              <Button
                onClick={handleGenerateSummary}
                disabled={isSummarizing || detail.transcriptSegments.length === 0}
                className="w-full"
              >
                <BrainCircuitIcon className={cn("size-4", isSummarizing && "animate-pulse")} />
                {summary ? "Regenerate summary" : "Generate summary"}
              </Button>
              <Button variant="outline" onClick={handleExportMarkdown} className="w-full">
                <DownloadIcon className="size-4" /> Export Markdown
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {notice ? (
        <div className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm text-primary">
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
          <p>{notice}</p>
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
          <CardDescription>
            Latest generated summary, actions, and decisions loaded from SQLite.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 xl:grid-cols-2">
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileTextIcon className="size-4" /> Executive summary
            </div>
            <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6">
              {asString(summaryJson.executive_summary) || "No summary generated yet."}
            </div>
          </section>
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MessageSquareTextIcon className="size-4" /> Key topics
            </div>
            <SectionList emptyLabel="No key topics captured yet." items={topics} />
          </section>
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2Icon className="size-4" /> Decisions
            </div>
            {decisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No decisions captured yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {decisions.map((decision) => (
                  <li key={decision.id} className="rounded-xl border bg-background/70 p-3">
                    <p className="font-medium">{decision.title}</p>
                    {decision.description ? (
                      <p className="mt-1 text-muted-foreground">{decision.description}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ListChecksIcon className="size-4" /> Action items
            </div>
            {actions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No action items captured yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {actions.map((action) => (
                  <li key={action.id} className="rounded-xl border bg-background/70 p-3">
                    <p className="font-medium">{action.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {action.owner ? `Owner: ${action.owner} · ` : ""}
                      {action.dueAt ? `Due: ${formatDateTime(action.dueAt)} · ` : ""}
                      Status: {action.status.replace(/_/g, " ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldAlertIcon className="size-4" /> Risks / blockers
            </div>
            <SectionList emptyLabel="No risks or blockers captured yet." items={risks} />
          </section>
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <HelpCircleIcon className="size-4" /> Follow-up questions
            </div>
            <SectionList emptyLabel="No follow-up questions captured yet." items={questions} />
          </section>
          <section className="space-y-3 xl:col-span-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileTextIcon className="size-4" /> Clean notes
            </div>
            <div className="whitespace-pre-wrap rounded-2xl border bg-muted/20 p-4 text-sm leading-6">
              {asString(summaryJson.clean_notes) || "No clean notes generated yet."}
            </div>
          </section>
        </CardContent>
      </Card>
    </PageLayout>
  );
};

export default MeetingDetailPage;
