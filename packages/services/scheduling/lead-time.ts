import { env } from "../env";
import type { ComposeMediaType } from "../publishing/model";
import type { Platform } from "../publishing/platforms";

/** We upload the bytes ourselves (time ≈ size / bandwidth). */
const PUSH_PLATFORMS = new Set<string>(["youtube", "x", "linkedin"]);
/** The platform downloads from our storage, then processes (instagram has no provider yet). */
const PULL_PLATFORMS = new Set<string>(["instagram", "facebook", "threads"]);

export type LeadTimeConfig = { uploadMbps: number; minSeconds: number; maxSeconds: number };

const defaults = (): LeadTimeConfig => ({
  uploadMbps: env.SCHEDULE_UPLOAD_MBPS,
  minSeconds: env.SCHEDULE_LEAD_MIN_SECONDS,
  maxSeconds: env.SCHEDULE_LEAD_MAX_SECONDS,
});

/**
 * How long before scheduled_at the worker should start (upload + process), so
 * the final publish call can happen on time. Clamped to [min, max].
 * - photos: 30 s
 * - push video: 60 s + size / upload speed × 1.5
 * - pull video: 120 s + 1 s per 5 MB of processing
 */
export function leadSeconds(
  platform: Platform | "instagram",
  mediaSizeBytes: number,
  mediaType: ComposeMediaType,
  config: LeadTimeConfig = defaults(),
): number {
  const bytes = Math.max(0, mediaSizeBytes || 0);
  let seconds: number;
  if (mediaType === "photos") seconds = 30;
  else if (PUSH_PLATFORMS.has(platform)) seconds = 60 + ((bytes * 8) / (config.uploadMbps * 1_000_000)) * 1.5;
  else if (PULL_PLATFORMS.has(platform)) seconds = 120 + bytes / (5 * 1_000_000);
  else seconds = 60;
  return Math.round(Math.min(config.maxSeconds, Math.max(config.minSeconds, seconds)));
}
