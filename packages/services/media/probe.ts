import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { MediaType } from "./model";
import type { ProbeResult } from "./uploads";

const run = promisify(execFile);

const StreamSchema = z.looseObject({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  avg_frame_rate: z.string().optional(),
  r_frame_rate: z.string().optional(),
  duration: z.string().optional(),
});
const ProbeOutputSchema = z.object({
  streams: z.array(StreamSchema).default([]),
  format: z.looseObject({ duration: z.string().optional() }).optional(),
});

function parseRate(rate: string | undefined): number | undefined {
  if (!rate) return undefined;
  const [num, den] = rate.split("/").map(Number);
  if (!num || !den) return undefined;
  return Math.round((num / den) * 1000) / 1000;
}

function parseSeconds(value: string | undefined): number | null {
  const seconds = value ? Number(value) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) / 1000 : null;
}

/**
 * Runs ffprobe (system binary, override with FFPROBE_PATH) against a URL.
 * Videos: duration, size, codecs, fps. Images: size only.
 */
export async function probeMedia(url: string, type: MediaType): Promise<ProbeResult> {
  const { stdout } = await run(
    process.env.FFPROBE_PATH || "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", url],
    { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
  );
  const output = ProbeOutputSchema.parse(JSON.parse(stdout));
  const visual = output.streams.find((stream) => stream.codec_type === "video");
  if (!visual?.width || !visual.height) throw new Error("No image or video stream found");

  if (type === "image") return { width: visual.width, height: visual.height, durationSeconds: null };

  const audio = output.streams.find((stream) => stream.codec_type === "audio");
  return {
    width: visual.width,
    height: visual.height,
    durationSeconds: parseSeconds(output.format?.duration ?? visual.duration),
    codec: { video: visual.codec_name, ...(audio?.codec_name ? { audio: audio.codec_name } : {}) },
    fps: parseRate(visual.avg_frame_rate) ?? parseRate(visual.r_frame_rate),
  };
}
