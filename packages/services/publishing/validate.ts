import { z } from "zod";
import type { MediaRow } from "../media/model";
import { effectiveSchedule, scheduleTimeIssue } from "../scheduling/effective";
import type { ComposeMediaType, PublishBatchInput, ValidationIssue } from "./model";
import { isManualPost, PLATFORMS, platformForProvider, type Platform } from "./platforms";

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
  /** The platform has no API for this post: stored for the user to publish by hand. */
  manual: boolean;
};

const UserTagsSchema = z.array(z.object({ mediaIndex: z.number(), username: z.string(), x: z.number().optional(), y: z.number().optional() })).catch([]);

/** Media tags vs the media they sit on (the field shapes themselves are checked by the compose schema). */
function tagIssues(platform: Platform, mediaType: ComposeMediaType, mediaCount: number, input: Record<string, unknown>): { field: string; message: string }[] {
  const { capabilities: cap, label } = PLATFORMS[platform];
  const mode = mediaType === "video" ? cap.tagging.video : cap.tagging.image;
  const tags = UserTagsSchema.parse(input.userTags ?? []);
  if (tags.length === 0) return [];
  if (mode === "none") return [{ field: "tags", message: `${label} can't tag people on ${mediaType === "video" ? "videos" : "photos"}` }];
  const issues = new Set<string>();
  const perMedia = new Map<number, string[]>();
  for (const tag of tags) {
    if (tag.mediaIndex >= mediaCount) issues.add("A tag points at a photo that isn't in this post");
    const positioned = tag.x !== undefined && tag.y !== undefined;
    if (mode === "positioned" && !positioned) issues.add(`@${tag.username} needs a position on the photo`);
    if (mode === "list" && (tag.x !== undefined || tag.y !== undefined)) issues.add(`Tags on ${mediaType === "video" ? "videos" : "this platform"} can't have a position`);
    const names = perMedia.get(tag.mediaIndex) ?? [];
    if (names.includes(tag.username.toLowerCase())) issues.add(`@${tag.username} is tagged twice on the same ${mediaType === "video" ? "video" : "photo"}`);
    perMedia.set(tag.mediaIndex, [...names, tag.username.toLowerCase()]);
  }
  for (const [index, names] of perMedia) {
    if (names.length > cap.tagging.max) issues.add(`${label} allows at most ${cap.tagging.max} tags per ${mediaType === "video" ? "video" : "photo"} (${mediaType === "video" ? "this one" : `photo ${index + 1}`} has ${names.length})`);
  }
  return [...issues].map((message) => ({ field: "tags", message }));
}

const MB = 1024 * 1024;
const size = (bytes: number) => (bytes >= 1024 * MB ? `${Math.round(bytes / (1024 * MB))} GB` : `${Math.round(bytes / MB)} MB`);

const mimeLabel = (mime: string) => (mime === "image/jpeg" ? "JPEG" : mime === "image/png" ? "PNG" : mime === "video/mp4" ? "MP4" : mime === "video/quicktime" ? "MOV" : mime);

/** 0.8 → "4:5", 1.91 → "1.91:1". */
function ratioLabel(value: number): string {
  for (let h = 1; h <= 20; h++) {
    const w = value * h;
    if (Math.abs(w - Math.round(w)) < 1e-6) return `${Math.round(w)}:${h}`;
  }
  return `${value}:1`;
}

/** Shape outside the platform's range. Same text as the publish-time error (e.g. Instagram 2207009). */
export function aspectMessage(label: string, range: { min: number; max: number }): string {
  return `${label} only accepts images between ${ratioLabel(range.min)} and ${ratioLabel(range.max)}. Fannout won't crop your image: pick another image or remove ${label}`;
}

/**
 * Media rules for one platform. Media may still be uploading/processing:
 * posts can be created before their files are ready (publish-post waits for
 * them), so only "failed" media is rejected here; rules that need processed
 * metadata (duration) apply once it is known — publish-post re-runs this
 * check after every file is ready.
 */
export function mediaIssues(
  platform: Platform,
  mediaType: ComposeMediaType,
  media: MediaRow[],
  thumbnail: MediaRow | null | undefined,
  thumbnailRequested: boolean,
): { field: string; message: string }[] {
  const { capabilities: cap, label } = PLATFORMS[platform];
  const rules = cap.mediaRules;
  const issues: { field: string; message: string }[] = [];
  const failed = media.filter((m) => m.status === "failed");
  if (failed.length) issues.push({ field: "media", message: `${failed.map((m) => m.name).join(", ")} failed to upload. Remove it or pick it again` });

  if (mediaType === "video") {
    if (!cap.supportsVideo) return [{ field: "media", message: `${label} doesn't support video posts` }];
    if (media.length !== 1 || media[0]!.type !== "video") {
      issues.push({ field: "media", message: "Pick exactly one video" });
    } else {
      const video = media[0]!;
      if (rules.maxVideoBytes && (video.sizeBytes ?? 0) > rules.maxVideoBytes) {
        issues.push({ field: "media", message: `${label} videos can be at most ${size(rules.maxVideoBytes)}` });
      }
      if (rules.videoMimeTypes && !rules.videoMimeTypes.includes(video.mimeType)) {
        issues.push({ field: "media", message: `${label} accepts ${rules.videoMimeTypes.map(mimeLabel).join(" or ")} videos only` });
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
      else if (thumbnail.status === "failed") issues.push({ field: "thumbnail", message: "The thumbnail failed to upload. Pick it again" });
      else {
        // A cover slot rule means Fannout converts it (format and bytes): no format/size error. Any shape is allowed.
        // Otherwise the platform's thumbnail rules win; without them the photo rules apply.
        const converted = Boolean(cap.imageFormats?.cover);
        const mimeTypes = converted ? undefined : (cap.thumbnailRules?.mimeTypes ?? rules.imageMimeTypes);
        const maxBytes = converted ? undefined : (cap.thumbnailRules?.maxBytes ?? rules.maxImageBytes);
        if (mimeTypes && !mimeTypes.includes(thumbnail.mimeType)) {
          issues.push({ field: "thumbnail", message: `${label} thumbnails must be ${mimeTypes.map(mimeLabel).join(" or ")} (${thumbnail.name} isn't)` });
        }
        if (maxBytes && (thumbnail.sizeBytes ?? 0) > maxBytes) {
          issues.push({ field: "thumbnail", message: `${label} thumbnails can be at most ${size(maxBytes)} (${thumbnail.name} is larger)` });
        }
      }
    }
    return issues;
  }

  const manual = isManualPost(platform, mediaType, media.length);
  if (!cap.supportsPhotos && !manual) {
    return [{ field: "media", message: cap.carouselMode === "manual" ? `${label} image posts need at least 2 photos` : `${label} doesn't support photo posts` }];
  }
  if (manual) {
    if (media.some((m) => m.type !== "image")) issues.push({ field: "media", message: "Photo posts can only contain images" });
    if (media.length > cap.carouselMax) issues.push({ field: "media", message: `${label} allows at most ${cap.carouselMax} photos (you picked ${media.length})` });
    return issues;
  }
  if (thumbnailRequested) issues.push({ field: "thumbnail", message: "Thumbnails are only for video posts" });
  if (media.some((m) => m.type !== "image")) issues.push({ field: "media", message: "Photo posts can only contain images" });
  if (media.length > cap.maxPhotos) {
    issues.push({ field: "media", message: `${label} allows at most ${cap.maxPhotos} photos (you picked ${media.length})` });
  }
  if (media.length < Math.max(1, cap.minCarousel)) {
    issues.push({ field: "media", message: `${label} needs at least ${Math.max(1, cap.minCarousel)} photo${cap.minCarousel > 1 ? "s" : ""}` });
  }
  // A slot rule (capabilities.imageFormats) means Fannout converts the format and fits the byte limit
  // itself (ensureFormat), so only shape is checked: images are never cropped, padded or stretched.
  const slotRule = cap.imageFormats?.[media.length > 1 ? "carouselImage" : "image"];
  if (slotRule) {
    const range = slotRule.aspectRatio;
    if (range && media.some((m) => m.width && m.height && (m.width / m.height < range.min || m.width / m.height > range.max))) {
      issues.push({ field: "media", message: aspectMessage(label, range) });
    }
    return issues;
  }
  if (rules.imageMimeTypes && media.some((m) => !rules.imageMimeTypes!.includes(m.mimeType))) {
    issues.push({ field: "media", message: `${label} accepts ${rules.imageMimeTypes.map(mimeLabel).join(" or ")} images only` });
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

    const ids = input.mediaType === "photos" && target.mediaIds ? target.mediaIds : input.mediaIds;
    const definition = PLATFORMS[platform];
    const manual = isManualPost(platform, input.mediaType, ids.length);
    // A manual post only has its own fields (e.g. the text); the video fields don't apply.
    const schema = manual && definition.manualFields
      ? definition.schema.pick(Object.fromEntries(definition.manualFields.map((name) => [name, true])) as Record<string, true>)
      : definition.schema;
    const parsed = schema.safeParse(target.input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        // Tags are edited outside the generic fields: show their errors in one place.
        const field = String(issue.path[0] ?? "input");
        issues.push({ socialConnectionId: id, field: field === "userTags" || field === "taggedUsers" ? "tags" : field, message: issue.message });
      }
    } else {
      const data = parsed.data as Record<string, unknown>;
      for (const issue of tagIssues(platform, input.mediaType, ids.length, data)) issues.push({ socialConnectionId: id, ...issue });
      const cap = definition.capabilities;
      const tagged = Array.isArray(data.taggedUsers) ? data.taggedUsers.length : 0;
      if (tagged && (input.mediaType === "video" ? cap.tagging.video : cap.tagging.image) === "none") {
        issues.push({ socialConnectionId: id, field: "tags", message: `${definition.label} can't tag people on this post` });
      }
    }

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

    // A manual post is never published by Fannout, so it has no schedule.
    const schedule = manual ? null : effectiveSchedule(target, input.scheduleAll);
    const timeIssue = schedule ? scheduleTimeIssue(schedule.at, now) : null;
    if (timeIssue) issues.push({ socialConnectionId: id, field: "schedule", message: timeIssue });

    if (parsed.success) {
      targets.push({ socialConnectionId: id, platform, input: parsed.data as Record<string, unknown>, mediaIds: ids, thumbnailId, schedule, manual });
    }
  }
  return { issues, targets: issues.length ? [] : targets };
}
