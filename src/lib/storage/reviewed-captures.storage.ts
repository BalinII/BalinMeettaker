export interface ReviewedCaptureEntry {
  reviewedAt: number;
  reviewedMessageCount: number;
}

const REVIEWED_CAPTURES_KEY = "pluely-reviewed-captures";

export function getReviewedCaptureMap(): Record<string, ReviewedCaptureEntry> {
  try {
    const raw = localStorage.getItem(REVIEWED_CAPTURES_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (error) {
    console.warn("Failed to parse reviewed captures from storage", error);
    return {};
  }
}

export function getReviewedCaptureEntry(
  captureId: string
): ReviewedCaptureEntry | null {
  const map = getReviewedCaptureMap();
  return map[captureId] || null;
}

export function markCaptureReviewed(
  captureId: string,
  reviewedMessageCount: number
): ReviewedCaptureEntry {
  const map = getReviewedCaptureMap();
  const nextEntry: ReviewedCaptureEntry = {
    reviewedAt: Date.now(),
    reviewedMessageCount,
  };

  map[captureId] = nextEntry;
  localStorage.setItem(REVIEWED_CAPTURES_KEY, JSON.stringify(map));

  return nextEntry;
}
