import type { MediaRow } from "../media/model";
import { effectiveSchedule, scheduleTimeIssue } from "../scheduling/effective";
import type { ComposeMediaType, PublishBatchInput, ValidationIssue } from "./model";
import { PLATFORMS, platformForProvider, type Platform } from "./platforms";

/**
 * Pure batch validation (unit-tested). The DB layer loads the user's
 * connections and media, then calls this. Each target is checked with its
 * platform's own compose schema plus the platform's capability rules.
 */

export type ConnectionForValidation = {
  id: string;
  userId: string;
  provider: string;
  status: "connected" | "reconnect" | "disconnected";
  username?: string | null;
};

export type ValidatedTarget = {
  socialConnectionId: string;
  platform: Platform;
  input: Record<string, unknown>;
  mediaIds: string[];
  thumbnailId: string | null;
  /** null = publish now. */
  schedule: { at: Date; timezone: string } | null;
};

const MB = 1024 * 1024;
const size = (bytes: number) => (bytes >= 1024 * MB ? `${Math.round(bytes / (1024 * MB))} GB` : `${Math.round(bytes / MB)} MB`);

function mediaIssues(
  platform: Platform,
  mediaType: ComposeMediaType,
  media: MediaRow[],
  thumbnail: MediaRow | null | undefined,
  thumbnailRequested: boolean,
): { field: string; message: string }[] {
  const { capabilities: cap, label } = PLATFORMS[platform];
  const rules = cap.mediaRules;
  const issues: { field: string; message: string }[] = [];
  const notReady = media.filter((m) => m.status !== "ready");
  if (notReady.length) issues.push({ field: "media", message: `${notReady.map((m) => m.name).join(", ")} isn't ready yet` });

  if (mediaType === "video") {
    if (!cap.supportsVideo) return [{ field: "media", message: `${label} doesn't support video posts` }];
    if (media.length !== 1 || media[0]!.type !== "video") {
      issues.push({ field: "media", message: "Pick exactly one video" });
    } else {
      const video = media[0]!;
      if (rules.maxVideoBytes && (video.sizeBytes ?? 0) > rules.maxVideoBytes) {
        issues.push({ field: "media", message: `${label} videos can be at most ${size(rules.maxVideoBytes)}` });
      }
      const seconds = video.durationSeconds ?? null;
      if (seconds !== null && rules.maxVideoSeconds && seconds > rules.maxVideoSeconds) {
        issues.push({ field: "media", message: `${label} videos can be at most ${Math.round(rules.maxVideoSeconds / 60)} min long` });
      }
      if (seconds !== null && rules.minVideoSeconds && seconds < rules.minVideoSeconds) {
        issues.push({ field: "media", message: `${label} videos must be at least ${rules.minVideoSeconds} s long` });
      }
    }
    if (thumbnailRequested) {
      if (!cap.supportsThumbnail) issues.push({ field: "thumbnail", message: `${label} doesn't take a custom thumbnail` });
      else if (!thumbnail || thumbnail.type !== "image") issues.push({ field: "thumbnail", message: "The thumbnail must be one of your images" });
      else if (thumbnail.status !== "ready") issues.push({ field: "thumbnail", message: "The thumbnail isn't ready yet" });
    }
    return issues;
  }

  if (!cap.supportsPhotos) return [{ field: "media", message: `${label} doesn't support photo posts` }];
  if (thumbnailRequested) issues.push({ field: "thumbnail", message: "Thumbnails are only for video posts" });
  if (media.some((m) => m.type !== "image")) issues.push({ field: "media", message: "Photo posts can only contain images" });
  if (media.length > cap.maxPhotos) {
    issues.push({ field: "media", message: `${label} allows at most ${cap.maxPhotos} photos (you picked ${media.length})` });
  }
  if (media.length < Math.max(1, cap.minCarousel)) {
    issues.push({ field: "media", message: `${label} needs at least ${Math.max(1, cap.minCarousel)} photo${cap.minCarousel > 1 ? "s" : ""}` });
  }
  if (rules.maxImageBytes) {
    const big = media.filter((m) => (m.sizeBytes ?? 0) > rules.maxImageBytes!);
    if (big.length) issues.push({ field: "media", message: `${label} photos can be at most ${size(rules.maxImageBytes)}` });
  }
  return issues;
}

export function validateBatch(params: {
  userId: string;
  input: PublishBatchInput;
  connections: ConnectionForValidation[];
  media: MediaRow[];
  now?: Date;
}): { issues: ValidationIssue[]; targets: ValidatedTarget[] } {
  const { userId, input, connections, media, now = new Date() } = params;
  const issues: ValidationIssue[] = [];
  const targets: ValidatedTarget[] = [];
  const mediaById = new Map(media.filter((m) => m.userId === userId).map((m) => [m.id, m]));
  const connectionById = new Map(connections.filter((c) => c.userId === userId).map((c) => [c.id, c]));

  const missing = [
    ...input.mediaIds,
    ...input.targets.flatMap((t) => t.mediaIds ?? []),
    ...Object.values(input.thumbnailByConnection ?? {}),
  ].filter((id) => !mediaById.has(id));
  if (missing.length) issues.push({ field: "media", message: "Some media wasn't found in your library" });
  if (input.mediaType === "video" && input.mediaIds.length !== 1) {
    issues.push({ field: "media", message: "Pick exactly one video" });
  }

  for (const target of input.targets) {
    const id = target.socialConnectionId;
    const connection = connectionById.get(id);
    if (!connection) {
      issues.push({ socialConnectionId: id, field: "account", message: "Account not found" });
      continue;
    }
    const platform = platformForProvider(connection.provider);
    if (!platform) {
      issues.push({ socialConnectionId: id, field: "account", message: `${connection.provider} can't be published to yet` });
      continue;
    }
    if (connection.status !== "connected") {
      issues.push({ socialConnectionId: id, field: "account", message: "Reconnect this account before posting" });
    }

    const parsed = PLATFORMS[platform].schema.safeParse(target.input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({ socialConnectionId: id, field: String(issue.path[0] ?? "input"), message: issue.message });
      }
    }

    const ids = input.mediaType === "photos" && target.mediaIds ? target.mediaIds : input.mediaIds;
    if (target.mediaIds && target.mediaIds.some((mid) => !input.mediaIds.includes(mid))) {
      issues.push({ socialConnectionId: id, field: "media", message: "Per-account photos must come from the batch" });
    }
    const rows = ids.map((mid) => mediaById.get(mid)).filter((m): m is MediaRow => Boolean(m));
    const thumbnailId = input.thumbnailByConnection?.[id] ?? null;
    for (const issue of mediaIssues(
      platform,
      input.mediaType,
      rows,
      thumbnailId ? mediaById.get(thumbnailId) : null,
      Boolean(thumbnailId),
    )) {
      issues.push({ socialConnectionId: id, ...issue });
    }

    const schedule = effectiveSchedule(target, input.scheduleAll);
    const timeIssue = schedule ? scheduleTimeIssue(schedule.at, now) : null;
    if (timeIssue) issues.push({ socialConnectionId: id, field: "schedule", message: timeIssue });

    if (parsed.success) {
      targets.push({ socialConnectionId: id, platform, input: parsed.data as Record<string, unknown>, mediaIds: ids, thumbnailId, schedule });
    }
  }
  return { issues, targets: issues.length ? [] : targets };
}
