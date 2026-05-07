import { invoke } from "@tauri-apps/api/core";
import type { TranscriptSegmentInput } from "@/types";

export const DEFAULT_FASTER_WHISPER_MODEL = "small.en";

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
  model?: string | null;
  segments: LocalTranscriptionSegment[];
}

function withProviderMetadata(
  response: LocalTranscriptionResponse,
  audioPath: string
): TranscriptSegmentInput[] {
  return response.segments.map((segment, index) => ({
    ...segment,
    speakerLabel: segment.speakerLabel ?? "Unknown",
    metadata: {
      ...(segment.metadata ?? {}),
      provider: response.provider,
      model: response.model ?? null,
      sourceAudioPath: audioPath,
      segmentIndex: index,
    },
  }));
}

export class FasterWhisperTranscriptionProvider implements TranscriptionProvider {
  readonly id = "faster-whisper";

  constructor(
    private readonly modelName = DEFAULT_FASTER_WHISPER_MODEL,
    private readonly language?: string
  ) {}

  async transcribeAudioFile(
    meetingId: string,
    audioPath: string
  ): Promise<TranscriptSegmentInput[]> {
    const response = await invoke<LocalTranscriptionResponse>(
      "transcribe_audio_file_faster_whisper",
      {
        meetingId,
        audioPath,
        modelName: this.modelName,
        language: this.language?.trim() || null,
      }
    );

    return withProviderMetadata(response, audioPath);
  }
}

export class LocalCommandTranscriptionProvider implements TranscriptionProvider {
  readonly id = "local-command";

  async transcribeAudioFile(
    meetingId: string,
    audioPath: string
  ): Promise<TranscriptSegmentInput[]> {
    const response = await invoke<LocalTranscriptionResponse>(
      "transcribe_audio_file_local_command",
      { meetingId, audioPath }
    );

    return withProviderMetadata(response, audioPath);
  }
}

export const fasterWhisperTranscriptionProvider =
  new FasterWhisperTranscriptionProvider();
export const localCommandTranscriptionProvider =
  new LocalCommandTranscriptionProvider();
export const localTranscriptionProvider = fasterWhisperTranscriptionProvider;
