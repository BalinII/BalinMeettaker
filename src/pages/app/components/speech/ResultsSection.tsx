import { useMemo, useState, type ReactNode } from "react";
import { ChatConversation } from "@/types";
import { Markdown, Switch, CopyButton, Badge, Button, Textarea } from "@/components";
import {
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  FileWarningIcon,
  HeadphonesIcon,
  Loader2,
  PencilIcon,
  SparklesIcon,
  XCircleIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  lastTranscription: string;
  lastAIResponse: string;
  isAIProcessing: boolean;
  conversation: ChatConversation;
  conversationMode: boolean;
  setConversationMode: (mode: boolean) => void;
};

type ReviewState = "generated" | "accepted" | "edited" | "rejected";

const STATE_STYLES: Record<
  ReviewState,
  {
    badge: string;
    label: string;
    icon: ReactNode;
  }
> = {
  generated: {
    badge: "bg-sky-500/10 text-sky-700 border-sky-500/30 dark:text-sky-300",
    label: "Generated",
    icon: <SparklesIcon className="h-3 w-3" />,
  },
  accepted: {
    badge:
      "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
    label: "Accepted",
    icon: <CheckCircle2Icon className="h-3 w-3" />,
  },
  edited: {
    badge:
      "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300",
    label: "Edited",
    icon: <PencilIcon className="h-3 w-3" />,
  },
  rejected: {
    badge: "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300",
    label: "Rejected",
    icon: <XCircleIcon className="h-3 w-3" />,
  },
};

const UNCERTAINTY_PATTERNS = [
  /\b(maybe|might|possibly|potentially|unclear|uncertain|probably|likely)\b/gi,
  /\b(not sure|cannot confirm|can't confirm|needs verification)\b/gi,
];

const detectUncertainty = (text: string) => {
  if (!text) return [] as string[];

  const matches = new Set<string>();
  UNCERTAINTY_PATTERNS.forEach((pattern) => {
    const found = text.match(pattern) || [];
    found.forEach((match) => matches.add(match.toLowerCase()));
  });

  return Array.from(matches);
};

export const ResultsSection = ({
  lastTranscription,
  lastAIResponse,
  isAIProcessing,
  conversation,
  conversationMode,
  setConversationMode,
}: Props) => {
  const hasResponse = lastAIResponse || isAIProcessing;
  const hasHistory = conversation.messages.length > 2;

  const [aiReviewState, setAIReviewState] = useState<ReviewState>("generated");
  const [systemReviewState, setSystemReviewState] =
    useState<ReviewState>("generated");
  const [isEditingAI, setIsEditingAI] = useState(false);
  const [isEditingSystem, setIsEditingSystem] = useState(false);
  const [editedAIResponse, setEditedAIResponse] = useState("");
  const [editedSystemResponse, setEditedSystemResponse] = useState("");
  const [showEvidence, setShowEvidence] = useState(false);

  const aiContent = isEditingAI ? editedAIResponse : lastAIResponse;
  const systemContent = isEditingSystem ? editedSystemResponse : lastTranscription;

  const uncertaintySignals = useMemo(
    () => detectUncertainty(aiContent),
    [aiContent]
  );

  if (!hasResponse && !lastTranscription) {
    return null;
  }

  const isMac = navigator.platform.toLowerCase().includes("mac");
  const modKey = isMac ? "⌘" : "Ctrl";

  const setState = (
    section: "ai" | "system",
    state: ReviewState,
    editing?: boolean
  ) => {
    if (section === "ai") {
      setAIReviewState(state);
      if (editing !== undefined) setIsEditingAI(editing);
      if (state === "edited" && !editedAIResponse) {
        setEditedAIResponse(lastAIResponse);
      }
      return;
    }

    setSystemReviewState(state);
    if (editing !== undefined) setIsEditingSystem(editing);
    if (state === "edited" && !editedSystemResponse) {
      setEditedSystemResponse(lastTranscription);
    }
  };

  const renderStateButtons = (section: "ai" | "system") => (
    <div className="flex items-center gap-1 flex-wrap">
      {(["generated", "accepted", "edited", "rejected"] as ReviewState[]).map(
        (state) => (
          <Button
            key={`${section}-${state}`}
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10px]"
            onClick={() =>
              setState(
                section,
                state,
                state === "edited"
                  ? true
                  : section === "ai"
                    ? isEditingAI
                    : isEditingSystem
              )
            }
          >
            {STATE_STYLES[state].label}
          </Button>
        )
      )}
    </div>
  );

  const renderStatus = (state: ReviewState) => (
    <Badge
      variant="outline"
      className={cn("gap-1 border text-[10px] px-2 py-0.5", STATE_STYLES[state].badge)}
    >
      {STATE_STYLES[state].icon}
      {STATE_STYLES[state].label}
    </Badge>
  );

  const evidenceMessages = conversation.messages.slice(2).sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <SparklesIcon className="w-3.5 h-3.5 text-primary" />
          <h4 className="text-xs font-medium">
            {conversationMode ? "Conversation Review" : "Response Review"}
          </h4>
        </div>
        <div className="flex items-center gap-2 select-none">
          <span className="text-[9px] text-muted-foreground/50 bg-muted/50 px-1 rounded">
            {modKey}+K
          </span>
          <Switch
            checked={conversationMode}
            onCheckedChange={setConversationMode}
            className="scale-75"
          />
        </div>
      </div>

      {!conversationMode && (
        <div className="space-y-3">
          {lastTranscription && (
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <HeadphonesIcon className="h-3.5 w-3.5 text-violet-500" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                    Transcript Source
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {renderStatus(systemReviewState)}
                  <CopyButton content={systemContent} copyMessage="Transcript copied" />
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-muted-foreground">{systemContent}</p>
              {renderStateButtons("system")}
            </div>
          )}

          {hasResponse && (
            <div className="rounded-lg border border-sky-500/20 bg-background/70 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <BotIcon className="h-3.5 w-3.5 text-sky-500" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                    Generated Notes
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {renderStatus(aiReviewState)}
                  {aiContent && <CopyButton content={aiContent} copyMessage="Notes copied" />}
                </div>
              </div>

              {isAIProcessing && !lastAIResponse ? (
                <div className="flex items-center gap-2 py-1">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Generating notes...</span>
                </div>
              ) : (
                <>
                  {isEditingAI ? (
                    <Textarea
                      rows={5}
                      className="text-xs"
                      value={editedAIResponse}
                      onChange={(e) => setEditedAIResponse(e.target.value)}
                    />
                  ) : (
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <Markdown>{aiContent}</Markdown>
                    </div>
                  )}

                  {uncertaintySignals.length > 0 && (
                    <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-200">
                      <div className="flex items-center gap-1.5 font-medium mb-1">
                        <FileWarningIcon className="h-3.5 w-3.5" />
                        Uncertainty detected
                      </div>
                      <p>
                        This note includes uncertain language: {uncertaintySignals.slice(0, 5).join(", ")}
                        . Verify before accepting.
                      </p>
                    </div>
                  )}

                  {renderStateButtons("ai")}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {conversationMode && (
        <div className="space-y-3">
          <div className="rounded-md border border-border/50 bg-background/60">
            <button
              type="button"
              className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-medium"
              onClick={() => setShowEvidence((prev) => !prev)}
            >
              <span className="uppercase tracking-wide text-muted-foreground">
                Evidence ({evidenceMessages.length})
              </span>
              {showEvidence ? (
                <ChevronUpIcon className="h-3.5 w-3.5" />
              ) : (
                <ChevronDownIcon className="h-3.5 w-3.5" />
              )}
            </button>

            {showEvidence && (
              <div className="border-t border-border/50 p-2 space-y-2 max-h-52 overflow-y-auto">
                {hasHistory ? (
                  evidenceMessages.map((message, index) => (
                    <div
                      key={message.id || index}
                      className={cn(
                        "p-2 rounded-md text-[11px]",
                        message.role === "user"
                          ? "bg-primary/5 border-l-2 border-primary/30"
                          : "bg-muted/40 border border-border/40"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[8px] font-medium text-muted-foreground uppercase tracking-wide">
                          {message.role === "user" ? "Transcript Evidence" : "AI Evidence"}
                        </span>
                        <CopyButton content={message.content} copyMessage="Evidence copied" />
                      </div>
                      <div className="text-muted-foreground leading-relaxed">
                        <Markdown>{message.content}</Markdown>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-[11px] text-muted-foreground p-1">
                    No previous evidence yet.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
