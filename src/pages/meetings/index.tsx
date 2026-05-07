import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClockIcon, RefreshCwIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components";
import { PageLayout } from "@/layouts";
import { listMeetings } from "@/lib/database";
import { cn } from "@/lib/utils";
import type { Meeting } from "@/types";

const statusTone: Record<Meeting["status"], string> = {
  scheduled: "bg-muted text-muted-foreground border-border",
  recording: "bg-red-500/10 text-red-600 border-red-500/20",
  processing: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  cancelled: "bg-muted text-muted-foreground border-border",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
};

const formatMeetingTime = (timestamp?: number | null) => {
  if (!timestamp) return "Not started";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
};

const Meetings = () => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshMeetings = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      setMeetings(await listMeetings());
    } catch (meetingError) {
      setError(
        meetingError instanceof Error ? meetingError.message : String(meetingError),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMeetings();
  }, [refreshMeetings]);

  return (
    <PageLayout
      title="Meetings"
      description="Review locally stored meeting captures, transcripts, summaries, actions, and decisions."
    >
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Meeting history</CardTitle>
              <CardDescription>
                Open a meeting to inspect audio paths, transcript segments, local AI summaries, action items, and decisions.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={refreshMeetings} disabled={isLoading}>
              <RefreshCwIcon className={cn("size-4", isLoading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="mb-4 rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {!isLoading && meetings.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No meetings captured yet. Start from the dashboard to create a local meeting record.
            </div>
          ) : (
            <div className="divide-y rounded-2xl border">
              {meetings.map((meeting) => (
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
                      Started {formatMeetingTime(meeting.startedAt ?? meeting.createdAt)}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {meeting.audioPath ? `Audio: ${meeting.audioPath}` : "No saved audio path yet"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/meetings/${meeting.id}`}>Review</Link>
                    </Button>
                    <Badge variant="outline" className={cn("capitalize", statusTone[meeting.status])}>
                      {meeting.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageLayout>
  );
};

export default Meetings;
