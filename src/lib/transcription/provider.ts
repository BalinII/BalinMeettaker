import { invoke } from "@tauri-apps/api/core";
import type { TranscriptSegmentInput } from "@/types";

export interface TranscriptionProvider {
  readonly id: string;
  transcribeAudioFile(
    meetingId: string,
    audioPath: string
  ): Promise<TranscriptSegmentInput[]>;
}

type LocalTranscriptionSegment = Omit<TranscriptSegmentInput, "metadata"> & {
  metadata?: Record<string, unknown> | null;
};

interface LocalTranscriptionResponse {
  provider: string;
  segments: LocalTranscriptionSegment[];
}

export class LocalCommandTranscriptionProvider implements TranscriptionProvider {
  readonly id = "local-command";

  async transcribeAudioFile(
    meetingId: string,
    audioPath: string
  ): Promise<TranscriptSegmentInput[]> {
    const response = await invoke<LocalTranscriptionResponse>(
      "transcribe_audio_file_local",
      { meetingId, audioPath }
    );

    return response.segments.map((segment, index) => ({
      ...segment,
      metadata: {
        ...(segment.metadata ?? {}),
        provider: response.provider,
        sourceAudioPath: audioPath,
        segmentIndex: index,
      },
    }));
  }
}

export const localTranscriptionProvider = new LocalCommandTranscriptionProvider();
