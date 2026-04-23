import {
  Badge,
  Card,
  Empty,
  Button,
  Markdown,
  Textarea,
  GetLicense,
  CopyButton,
} from "@/components";
import { getConversationById } from "@/lib";
import { ChatConversation } from "@/types";
import {
  Download,
  MessageCircleIcon,
  MessageCircleReplyIcon,
  Trash2,
  SparklesIcon,
  UserIcon,
  SendIcon,
  Check,
  Loader2,
  Pencil,
  Save,
  XCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { useState, useEffect } from "react";
import moment from "moment";
import { useParams, useNavigate } from "react-router-dom";
import { PageLayout } from "@/layouts";
import { useHistory, useChatCompletion } from "@/hooks";
import { useApp } from "@/contexts";
import {
  DeleteConfirmationDialog,
  ChatAudio,
  ChatScreenshot,
  ChatFiles,
  AudioRecorder,
} from ".";

type ReviewState = "pending" | "accepted" | "rejected";

type ParsedSection = {
  title: string;
  content: string;
};

const REVIEW_SECTIONS = [
  "actions",
  "decisions",
  "follow-ups",
  "follow ups",
  "followups",
  "risks",
  "open questions",
  "open question",
  "evidence",
];

const parseReviewSections = (content: string): ParsedSection[] => {
  const lines = content.split("\n");
  const sections: ParsedSection[] = [];
  let currentTitle = "";
  let currentLines: string[] = [];

  const pushCurrent = () => {
    if (!currentTitle || !currentLines.length) return;
    const normalized = currentTitle.trim().toLowerCase();
    const isRelevant = REVIEW_SECTIONS.some((name) =>
      normalized.includes(name)
    );
    if (!isRelevant) return;

    sections.push({
      title: currentTitle.replace(/[:#*]/g, "").trim(),
      content: currentLines.join("\n").trim(),
    });
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    const boldLabel = line.match(/^\*\*(.+?)\*\*\s*:?[\s-]*$/);
    if (heading || boldLabel) {
      pushCurrent();
      currentTitle = (heading?.[1] || boldLabel?.[1] || "").trim();
      currentLines = [];
      continue;
    }

    if (currentTitle) {
      currentLines.push(line);
    }
  }

  pushCurrent();
  return sections.filter((section) => section.content);
};

const getUncertaintyLabel = (text: string) => {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("high confidence") ||
    normalized.includes("confirmed")
  ) {
    return { label: "High confidence", className: "text-green-600 border-green-500/40" };
  }

  if (
    normalized.includes("low confidence") ||
    normalized.includes("uncertain") ||
    normalized.includes("unverified")
  ) {
    return { label: "Needs verification", className: "text-amber-600 border-amber-500/40" };
  }

  return null;
};

const View = () => {
  const { conversationId } = useParams();
  const { hasActiveLicense, supportsImages } = useApp();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatConversation | null>(null);
  const [reviewStates, setReviewStates] = useState<Record<string, ReviewState>>({});
  const [expandedEvidence, setExpandedEvidence] = useState<Record<string, boolean>>({});

  const {
    handleDeleteConfirm,
    confirmDelete,
    cancelDelete,
    deleteConfirm,
    handleAttachToOverlay,
    handleDownload,
    isDownloaded,
    isAttached,
  } = useHistory();

  const completion = useChatCompletion(
    conversationId as string,
    messages,
    setMessages
  );

  useEffect(() => {
    const getMessages = async () => {
      const conversation = await getConversationById(conversationId as string);
      setMessages(conversation || null);
    };
    getMessages();
  }, [conversationId]);

  useEffect(() => {
    // Scroll to bottom when messages load
    if (messages?.messages.length) {
      setTimeout(() => {
        completion.messagesEndRef.current?.scrollIntoView({
          behavior: "smooth",
        });
      }, 100);
    }
  }, [messages?.messages.length]);

  const handleDelete = async () => {
    await confirmDelete();
    navigate(-1);
  };

  return (
    <PageLayout
      isMainTitle={false}
      allowBackButton={true}
      title={messages?.title || ""}
      description={`${messages?.messages.length} messages in this conversation`}
      rightSlot={
        <div className="flex flex-row items-center gap-2">
          <Button
            variant="outline"
            title="Open this conversation in overlay"
            className="text-[10px] lg:text-sm h-6 lg:h-8"
            onClick={() =>
              conversationId && handleAttachToOverlay(conversationId)
            }
            disabled={isAttached}
          >
            {isAttached ? (
              <>
                <Check className="size-3 lg:size-4 text-green-600" />
                Attached
              </>
            ) : (
              <>
                Open in Overlay{" "}
                <MessageCircleReplyIcon className="size-3 lg:size-4" />
              </>
            )}
          </Button>
          <Button
            variant={"outline"}
            title="Download conversation as markdown"
            className="text-[10px] lg:text-sm h-6 lg:h-8"
            onClick={(e) => handleDownload(messages, e)}
            disabled={isDownloaded}
          >
            {isDownloaded ? (
              <>
                <Check className="size-3 lg:size-4 text-green-600" />
                Downloaded
              </>
            ) : (
              <>
                Download <Download className="size-3 lg:size-4" />
              </>
            )}
          </Button>
          <Button
            variant="destructive"
            title="Delete conversation"
            onClick={() =>
              conversationId && handleDeleteConfirm(conversationId)
            }
            className="text-[10px] lg:text-sm h-6 lg:h-8"
          >
            Delete <Trash2 className="size-3 lg:size-4" />
          </Button>
        </div>
      }
    >
      {messages?.messages.length === 0 ? (
        <Empty
          isLoading={false}
          icon={MessageCircleIcon}
          title="No messages found"
          description="Start a new message to get started"
        />
      ) : (
        <div className="flex flex-col gap-5 pb-24 px-2">
          {messages?.messages.map((message, index, array) => {
            const isUser = message.role === "user";
            const showDate =
              index === 0 ||
              moment(message.timestamp).format("YYYY-MM-DD") !==
                moment(array[index - 1]?.timestamp).format("YYYY-MM-DD");
            const reviewState = reviewStates[message.id || ""] || "pending";
            const sections = isUser ? [] : parseReviewSections(message.content);
            const uncertainty = getUncertaintyLabel(message.content);

            return (
              <div key={message.id}>
                {/* Date separator */}
                {showDate && (
                  <Badge
                    variant={"outline"}
                    className="flex items-center justify-center my-4 w-fit mx-auto"
                  >
                    {moment(message.timestamp).format("ddd, MMM D")}
                  </Badge>
                )}

                {/* Message */}
                <div
                  className={`flex gap-3 ${
                    isUser ? "justify-end" : "justify-start"
                  }`}
                >
                  {/* Avatar - Left side for bot */}
                  {!isUser && (
                    <div className="flex-shrink-0">
                      <div className="size-7 lg:size-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <SparklesIcon className="size-3 lg:size-4 text-primary" />
                      </div>
                    </div>
                  )}

                  {/* Message content */}
                  <div
                    className={`flex flex-col gap-2 max-w-[78%] ${
                      isUser ? "items-end" : "items-start"
                    }`}
                  >
                    <Card
                      className={`p-3 text-xs lg:text-sm transition-all shadow-none space-y-3 ${
                        isUser
                          ? "!bg-primary text-primary-foreground !border-primary rounded-tr-sm"
                          : "!bg-muted/50 dark:!bg-muted/30 rounded-tl-sm"
                      }`}
                    >
                      {!isUser && (
                        <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-[10px] bg-background/60">
                              AI Note
                            </Badge>
                            {uncertainty && (
                              <Badge variant="outline" className={`text-[10px] ${uncertainty.className}`}>
                                <AlertTriangle className="size-3 mr-1" />
                                {uncertainty.label}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <CopyButton content={message.content} />
                            <span className="text-[10px]">{moment(message.timestamp).format("hh:mm A")}</span>
                          </div>
                        </div>
                      )}

                      <Markdown>{message.content}</Markdown>

                      {!isUser && sections.length > 0 && (
                        <div className="space-y-2 border-t border-border/40 pt-3">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                              Review sections
                            </p>
                            <Badge variant="outline" className="text-[10px]">
                              {sections.length} grouped
                            </Badge>
                          </div>
                          <div className="grid gap-2 md:grid-cols-2">
                            {sections.map((section) => {
                              const evidenceKey = `${message.id}-${section.title}`;
                              const isEvidence = section.title.toLowerCase().includes("evidence");
                              const showEvidence = expandedEvidence[evidenceKey] ?? false;
                              return (
                                <div key={section.title} className="rounded-md border border-border/60 bg-background/50 p-2.5 space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-[11px] font-semibold">{section.title}</p>
                                    <CopyButton content={section.content} />
                                  </div>
                                  {isEvidence ? (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 px-1.5 text-[10px]"
                                        onClick={() =>
                                          setExpandedEvidence((prev) => ({
                                            ...prev,
                                            [evidenceKey]: !showEvidence,
                                          }))
                                        }
                                      >
                                        {showEvidence ? (
                                          <ChevronDown className="size-3 mr-1" />
                                        ) : (
                                          <ChevronRight className="size-3 mr-1" />
                                        )}
                                        {showEvidence ? "Hide evidence" : "Expand evidence"}
                                      </Button>
                                      {showEvidence && (
                                        <div className="text-[11px] text-muted-foreground leading-relaxed">
                                          <Markdown>{section.content}</Markdown>
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <div className="text-[11px] text-muted-foreground leading-relaxed max-h-28 overflow-auto pr-1">
                                      <Markdown>{section.content}</Markdown>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {!isUser && (
                        <div className="border-t border-border/40 pt-2">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                            Review actions
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button size="sm" variant="outline" className="h-7 text-[11px]">
                              <Pencil className="size-3 mr-1" />
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant={reviewState === "accepted" ? "default" : "outline"}
                              className="h-7 text-[11px]"
                              onClick={() =>
                                setReviewStates((prev) => ({
                                  ...prev,
                                  [message.id || ""]: "accepted",
                                }))
                              }
                            >
                              <CheckCircle2 className="size-3 mr-1" />
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant={reviewState === "rejected" ? "destructive" : "outline"}
                              className="h-7 text-[11px]"
                              onClick={() =>
                                setReviewStates((prev) => ({
                                  ...prev,
                                  [message.id || ""]: "rejected",
                                }))
                              }
                            >
                              <XCircle className="size-3 mr-1" />
                              Reject
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-[11px] ml-auto">
                              <Save className="size-3 mr-1" />
                              Save
                            </Button>
                          </div>
                        </div>
                      )}
                    </Card>
                    <Badge
                      variant="outline"
                      className={`text-[10px] lg:text-xs bg-transparent border-none ${
                        isUser ? "-mr-1" : "-ml-1"
                      }`}
                    >
                      {isUser
                        ? moment(message.timestamp).format("hh:mm A")
                        : `Status: ${reviewState}`}
                    </Badge>
                  </div>

                  {/* Avatar - Right side for user */}
                  {isUser && (
                    <div className="flex-shrink-0">
                      <div className="size-7 lg:size-8 rounded-full bg-primary flex items-center justify-center">
                        <UserIcon className="size-3 lg:size-4 text-primary-foreground" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={completion.messagesEndRef} />
        </div>
      )}

      {/* Sticky Footer Input */}
      <div className="absolute bottom-0 left-0 right-0 bg-background/10 backdrop-blur">
        {completion.error && (
          <div className="px-4 pt-3 pb-0">
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
              <strong>Error:</strong> {completion.error}
            </div>
          </div>
        )}

        <div className="relative flex items-start gap-2 p-4">
          {!hasActiveLicense && (
            <div className="select-none p-5 z-100 bg-primary/5 border border-primary/20 rounded-xl absolute top-4 left-4 right-4">
              <div className="max-w-sm mx-auto">
                <p className="text-sm font-medium text-center">
                  You need an active license to use this feature.
                </p>

                <GetLicense
                  buttonText="Get License"
                  buttonClassName="w-full mt-2"
                />
              </div>
            </div>
          )}
          <div className="flex-1 relative">
            {completion.isRecording ? (
              <AudioRecorder
                onTranscriptionComplete={(text) => {
                  completion.setIsRecording(false);
                  completion.submit(text);
                }}
                onCancel={() => completion.setIsRecording(false)}
              />
            ) : (
              <>
                <div className="absolute bottom-2 left-2 flex items-center gap-1 z-10">
                  <ChatFiles
                    attachedFiles={completion.attachedFiles}
                    handleFileSelect={completion.handleFileSelect}
                    removeFile={completion.removeFile}
                    onRemoveAllFiles={completion.onRemoveAllFiles}
                    isLoading={completion.isLoading}
                    isFilesPopoverOpen={completion.isFilesPopoverOpen}
                    setIsFilesPopoverOpen={completion.setIsFilesPopoverOpen}
                    disabled={!hasActiveLicense || !supportsImages}
                  />
                  <ChatAudio
                    micOpen={completion.micOpen}
                    setMicOpen={completion.setMicOpen}
                    isRecording={completion.isRecording}
                    setIsRecording={completion.setIsRecording}
                    disabled={!hasActiveLicense}
                  />
                  <ChatScreenshot
                    screenshotConfiguration={completion.screenshotConfiguration}
                    attachedFiles={completion.attachedFiles}
                    isLoading={completion.isLoading}
                    captureScreenshot={completion.captureScreenshot}
                    isScreenshotLoading={completion.isScreenshotLoading}
                    disabled={!hasActiveLicense || !supportsImages}
                  />
                </div>

                <Textarea
                  ref={completion.inputRef}
                  placeholder="Type a message..."
                  className="pr-12 pl-2 resize-none pb-12 pt-3"
                  rows={2}
                  value={completion.input}
                  onChange={(e) => completion.setInput(e.target.value)}
                  onKeyDown={completion.handleKeyPress}
                  onPaste={completion.handlePaste}
                  disabled={completion.isLoading || !hasActiveLicense}
                />
                <Button
                  size="icon"
                  className="size-7 lg:size-9 rounded-lg lg:rounded-xl absolute right-2 bottom-2"
                  title="Send message"
                  onClick={() => completion.submit()}
                  disabled={
                    completion.isLoading ||
                    !completion.input.trim() ||
                    !hasActiveLicense
                  }
                >
                  {completion.isLoading ? (
                    <Loader2 className="size-3 lg:size-4 animate-spin" />
                  ) : (
                    <SendIcon className="size-3 lg:size-4" />
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        deleteConfirm={deleteConfirm}
        cancelDelete={cancelDelete}
        confirmDelete={handleDelete}
      />
    </PageLayout>
  );
};

export default View;
