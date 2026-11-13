import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MediaType } from "./model";

const run = promisify(execFile);

/** Longest edge of a library thumbnail. Pickers and lists show these, never the original. */
export const THUMBNAIL_WIDTH = 320;

/** Sibling object next to the original, so deleting/moving the original can clean it up by key. */
export const thumbnailKeyFor = (s3Key: string) => `${s3Key}.thumb.jpg`;

/**
 * One JPEG frame, at most THUMBNAIL_WIDTH px wide (system ffmpeg, override with FFMPEG_PATH).
 * Images: the image itself. Videos: a frame ~1 s in (or the middle of very short clips).
 */
export async function generateThumbnail(
  input: string,
  type: Extract<MediaType, "image" | "video">,
  durationSeconds?: number | null,
): Promise<Buffer> {
  const seek = type === "video" ? ["-ss", String(Math.max(0, Math.min(1, (durationSeconds ?? 2) / 2)))] : [];
  const { stdout } = await run(
    process.env.FFMPEG_PATH || "ffmpeg",
    [
      "-v", "error",
      ...seek,
      "-i", input,
      "-frames:v", "1",
      "-vf", `scale='min(${THUMBNAIL_WIDTH},iw)':-2`,
      "-q:v", "5",
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "pipe:1",
    ],
    { timeout: 120_000, maxBuffer: 8 * 1024 * 1024, encoding: "buffer" },
  );
  if (stdout.length === 0) throw new Error("ffmpeg produced no thumbnail");
  return stdout;
}
