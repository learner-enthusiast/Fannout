import { X_VIDEO_SEGMENT_BYTES } from "@repo/providers/x";
import { YOUTUBE_UPLOAD_CHUNK_BYTES } from "@repo/providers/youtube";

/**
 * Large push uploads (YouTube, LinkedIn, X) run as many small Inngest steps.
 * Each step uploads chunks until STEP_BUDGET_MS has passed (then returns so
 * Inngest checkpoints), so no single HTTP request to /api/inngest — and no
 * single upload request — carries the whole file.
 */
export const UPLOAD_CONFIG = {
  /** Stop starting new chunks in a step after this long (one chunk may still take up to its own timeout). */
  STEP_BUDGET_MS: 60_000,
  /** Per chunk/part/segment request timeout. A timeout fails the step; the retry resumes the same chunk. */
  CHUNK_TIMEOUT_MS: 120_000,
  /** LinkedIn single upload (< 190 MB): the one PUT of the whole file gets this long. */
  SINGLE_PUT_TIMEOUT_MS: 15 * 60_000,
  YOUTUBE_CHUNK_BYTES: YOUTUBE_UPLOAD_CHUNK_BYTES, // 8 MiB, multiple of 256 KiB
  X_SEGMENT_BYTES: X_VIDEO_SEGMENT_BYTES, // 4 MiB, ≤ 5 MB recommended
  /** Processing caps, measured from upload completion. */
  PROCESSING_CAP_MS: { youtube: 30 * 60_000, linkedin: 20 * 60_000, x: 20 * 60_000 },
  /** Hard ceiling on prepare steps per run (Inngest allows 1 000 steps per function run). */
  MAX_PREPARE_STEPS: 900,
} as const;

/** Poll backoff: 10 s → 20 s → 30 s … capped at 60 s. */
export function pollDelaySeconds(pollCount: number): number {
  return Math.min(60, 10 * (pollCount + 1));
}
