import { downloadObjectAsBuffer, getDownloadUrl, headObject, uploadObject } from "@repo/s3";
import { orientationOf } from "@repo/services/media/model";
import { probeMedia } from "@repo/services/media/probe";
import { parseSocialPackage } from "@repo/services/media/social-package";
import { InvalidSubtitleError, subtitleFormat, summarizeSubtitles } from "@repo/services/media/subtitles";
import { refreshFolderSuggestion } from "@repo/services/media/suggestions";
import { generateThumbnail, thumbnailKeyFor } from "@repo/services/media/thumbnail";
import {
  expireStaleUpload,
  findStaleUploads,
  getMediaForProcessing,
  markMediaFailed,
  markMediaProcessing,
  markMediaReady,
  setMediaThumbnail,
  type ReadyUpdate,
} from "@repo/services/media/uploads";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import { inngest } from "../client";
import { mediaUploadCompleted, mediaUploadFailed, notificationCreate } from "../events";

const label = (name: string | null | undefined) => name || "Your file";

const READY_TITLE = {
  video: "Video ready",
  image: "Image ready",
  subtitle: "Subtitles ready",
  json: "JSON ready",
  other: "File ready",
} as const;

/** Reads a small text object (subtitles / JSON are capped at 1 MB on upload). */
async function readText(key: string, bucket: string): Promise<string> {
  const buffer = await downloadObjectAsBuffer(key, { bucket });
  if (!buffer) throw new NonRetriableError("Uploaded file was not found in storage");
  return buffer.toString("utf8");
}

/**
 * media/upload.completed → analyse by type, mark ready, notify.
 * - video/image: ffprobe over a presigned GET (+ orientation)
 * - subtitle: SRT/VTT parse → segments + duration
 * - json: parse; social-package JSON → folder suggestion + "Create folder?" notification
 * Invalid files fail without retries (NonRetriableError → onFailure). Max 2 per user.
 */
export const processMedia = inngest.createFunction(
  {
    id: "process-media",
    triggers: [mediaUploadCompleted],
    concurrency: { limit: 2, key: "event.data.userId" },
    retries: 3,
    onFailure: async ({ event, error, step }) => {
      const original = z
        .object({ mediaId: z.uuid(), userId: z.uuid() })
        .safeParse(event.data.event.data);
      if (!original.success) return;
      const { mediaId, userId } = original.data;
      const message = error.message || "Processing failed";
      const row = await step.run("mark-failed", async () => {
        const failed = await markMediaFailed(mediaId, message);
        return { name: failed?.name ?? null };
      });
      await step.sendEvent(
        "notify-failed",
        notificationCreate.create({
          userId,
          type: "upload_failed",
          title: "Upload failed",
          body: `${label(row.name)} could not be processed: ${message}`,
          link: `/media/${mediaId}`,
          mediaId,
          data: { error: message },
        }),
      );
    },
  },
  async ({ event, step }) => {
    const { mediaId, userId } = event.data;

    const media = await step.run("mark-processing", async () => {
      const row = await markMediaProcessing(mediaId);
      if (!row) {
        const current = await getMediaForProcessing(mediaId);
        // Already done (event replayed) or gone: nothing to do.
        if (!current || current.status === "ready" || current.status === "failed") return null;
        throw new Error(`Media ${mediaId} is ${current.status}`);
      }
      return {
        type: row.type,
        name: row.name,
        s3Key: row.s3Key,
        s3Bucket: row.s3Bucket,
        filename: row.originalFilename,
        mimeType: row.mimeType,
      };
    });
    if (!media) return { skipped: true };

    await step.run("head-object", async () => {
      const head = await headObject(media.s3Key, { bucket: media.s3Bucket });
      if (!head) throw new NonRetriableError("Uploaded file was not found in storage");
      return { contentLength: head.contentLength, contentType: head.contentType };
    });

    const analysis = await step.run("analyze", async (): Promise<ReadyUpdate & { socialPackage: boolean }> => {
      if (media.type === "video" || media.type === "image") {
        const url = await getDownloadUrl(media.s3Key, {
          bucket: media.s3Bucket,
          internal: true,
          expiresIn: 15 * 60,
        });
        const probe = await probeMedia(url, media.type);
        const orientation = orientationOf(probe.width, probe.height);
        return {
          width: probe.width,
          height: probe.height,
          durationSeconds: probe.durationSeconds,
          metadata: {
            ...(probe.codec ? { codec: probe.codec } : {}),
            ...(probe.fps ? { fps: probe.fps } : {}),
            ...(orientation ? { orientation } : {}),
          },
          socialPackage: false,
        };
      }

      if (media.type === "subtitle") {
        const text = await readText(media.s3Key, media.s3Bucket);
        try {
          const subtitle = summarizeSubtitles(text, subtitleFormat(media.filename, media.mimeType));
          return {
            durationSeconds: Math.round(subtitle.durationMs / 10) / 100,
            metadata: { subtitle },
            socialPackage: false,
          };
        } catch (error) {
          if (error instanceof InvalidSubtitleError) throw new NonRetriableError(error.message);
          throw error;
        }
      }

      if (media.type === "json") {
        let json: unknown;
        try {
          json = JSON.parse((await readText(media.s3Key, media.s3Bucket)).replace(/^\uFEFF/, ""));
        } catch (error) {
          if (error instanceof NonRetriableError) throw error;
          throw new NonRetriableError(`Invalid JSON: ${(error as Error).message}`);
        }
        const pkg = parseSocialPackage(json);
        return {
          metadata: pkg
            ? { jsonSchema: "social_package", socialPackage: { video: pkg.video, files: pkg.files as Record<string, string | string[]> } }
            : { jsonSchema: null },
          socialPackage: Boolean(pkg),
        };
      }

      return { socialPackage: false };
    });

    const { socialPackage, ...update } = analysis;
    await step.run("mark-ready", async () => {
      await markMediaReady(mediaId, update);
    });

    // Best effort and after "ready": a failed thumbnail must never fail or delay an upload.
    if (media.type === "video" || media.type === "image") {
      await step.run("thumbnail", async () => {
        try {
          const url = await getDownloadUrl(media.s3Key, { bucket: media.s3Bucket, internal: true, expiresIn: 15 * 60 });
          const jpeg = await generateThumbnail(url, media.type as "video" | "image", update.durationSeconds);
          const key = thumbnailKeyFor(media.s3Key);
          await uploadObject(key, jpeg, { bucket: media.s3Bucket, contentType: "image/jpeg", cacheControl: "private, max-age=31536000" });
          await setMediaThumbnail(mediaId, key);
          return { thumbnailKey: key };
        } catch (error) {
          return { thumbnailKey: null, error: (error as Error).message.slice(0, 200) };
        }
      });
    }

    await step.sendEvent(
      "notify-succeeded",
      notificationCreate.create({
        userId,
        type: "upload_succeeded",
        title: READY_TITLE[media.type],
        body: `${label(media.name)} finished processing.`,
        link: `/media/${mediaId}`,
        mediaId,
      }),
    );

    if (socialPackage) {
      const suggestion = await step.run("suggest-folder", async () => {
        const row = await getMediaForProcessing(mediaId);
        if (!row) return null;
        const refreshed = await refreshFolderSuggestion(row);
        return refreshed.metadata?.folderSuggestion ?? null;
      });
      if (suggestion) {
        await step.sendEvent(
          "notify-folder-suggestion",
          notificationCreate.create({
            userId,
            type: "upload_succeeded",
            title: `Create folder ‘${suggestion.folderName}’?`,
            body: `Review the files ${label(media.name)} lists and group them into a folder.`,
            link: `/media/folders/new?fromJson=${mediaId}`,
            mediaId,
            data: { kind: "folder_suggestion" },
          }),
        );
      }
    }
    return { mediaId, status: "ready", type: media.type };
  },
);

/** media/upload.failed (cancel / client error) → notify. */
export const onUploadFailed = inngest.createFunction(
  { id: "on-upload-failed", triggers: [mediaUploadFailed], retries: 3 },
  async ({ event, step }) => {
    const { mediaId, userId, error } = event.data;
    const row = await step.run("load-media", async () => {
      const current = await getMediaForProcessing(mediaId);
      return { filename: current?.name ?? null };
    });
    await step.sendEvent(
      "notify-failed",
      notificationCreate.create({
        userId,
        type: "upload_failed",
        title: "Upload failed",
        body: `${label(row.filename)} was not uploaded: ${error}`,
        link: "/media",
        mediaId,
        data: { error },
      }),
    );
  },
);

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Every 30 min: uploads stuck in "uploading" for 24 h → abort, fail, notify. */
export const cleanupStaleUploads = inngest.createFunction(
  { id: "cleanup-stale-uploads", triggers: [{ cron: "*/30 * * * *" }], retries: 3 },
  async ({ step }) => {
    const stale = await step.run("find-stale", async () => {
      const rows = await findStaleUploads(new Date(Date.now() - STALE_AFTER_MS));
      return rows.map((row) => ({ id: row.id, userId: row.userId, filename: row.name }));
    });

    let expired = 0;
    for (const item of stale) {
      const changed = await step.run(`expire-${item.id}`, () =>
        expireStaleUpload(item.id, "Upload interrupted"),
      );
      if (!changed) continue;
      expired += 1;
      await step.sendEvent(
        `notify-${item.id}`,
        notificationCreate.create({
          userId: item.userId,
          type: "upload_failed",
          title: "Upload interrupted",
          body: `${label(item.filename)} did not finish uploading and was cancelled.`,
          link: "/media",
          mediaId: item.id,
        }),
      );
    }
    return { checked: stale.length, expired };
  },
);
