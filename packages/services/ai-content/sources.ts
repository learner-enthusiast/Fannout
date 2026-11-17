import type { AiImage } from "@repo/ai";
import { logger } from "@repo/logger";
import { downloadObjectAsBuffer } from "@repo/s3";
import subsrt from "subsrt-ts";
import type { MediaRow } from "../media/model";
import { subtitleFormat } from "../media/subtitles";
import { thumbnailKeyFor } from "../media/thumbnail";
import { chaptersFromJson, type Chapter } from "./chapters";

/** Per-platform copy found in a social JSON (keys vary; everything optional). */
export type PlatformHint = {
  title?: string;
  description?: string;
  post?: string;
  caption?: string;
  shortsTitle?: string;
  tags?: string[];
  hashtags?: string[];
};

export type JsonSource =
  | {
      kind: "social";
      video: string | null;
      platforms: Record<string, PlatformHint>;
      /** The author's draft per platform, as written (capped), for that platform's writer. */
      blocks: Record<string, string>;
      /** Author-written YouTube timestamps, if the JSON has any (validated like cue chapters). */
      chapters: Chapter[];
    }
  | { kind: "generic"; text: string; truncated: boolean };

export type TranscriptSource = {
  /** "[c12 03:41] text" lines, one per ~25 s window. */
  text: string;
  /** Subtitle cues read. */
  segments: number;
  truncated: boolean;
  /** Cue id (the window's first cue) → its real start in ms. The ONLY source of timestamps. */
  cues: Record<string, number>;
};

export type Sources = { json: JsonSource | null; transcript: TranscriptSource | null };

/** Where a card's copy came from (shown on the card). */
export type SourceKind = "json" | "srt" | "photos";

export class SourceError extends Error {}

export const MAX_SOURCE_BYTES = 1024 * 1024;
export const GENERIC_JSON_MAX_CHARS = 12_000;
export const TRANSCRIPT_MAX_CHARS = 24_000;
export const TRANSCRIPT_WINDOW_MS = 25_000;
export const JSON_BLOCK_MAX_CHARS = 8_000;
/** Images sent to the model per call (already downscaled). */
export const MAX_AI_IMAGES = 10;
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;

const PLATFORM_KEYS = ["youtube", "instagram", "facebook", "threads", "linkedin", "x", "twitter"] as const;
const TEXT_KEYS: Record<string, keyof PlatformHint> = {
  title: "title",
  description: "description",
  post: "post",
  post_long: "post",
  text: "post",
  caption: "caption",
  shorts_title: "shortsTitle",
  shortsTitle: "shortsTitle",
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : undefined;

function hintFrom(value: unknown): PlatformHint | null {
  if (!isObject(value)) return null;
  const hint: PlatformHint = {};
  for (const [key, target] of Object.entries(TEXT_KEYS)) {
    const text = value[key];
    if (typeof text === "string" && text.trim() && !hint[target]) (hint as Record<string, unknown>)[target] = text.trim();
  }
  const tags = strings(value.tags);
  const hashtags = strings(value.hashtags);
  if (tags?.length) hint.tags = tags;
  if (hashtags?.length) hint.hashtags = hashtags;
  return Object.keys(hint).length ? hint : null;
}

/**
 * Parses the selected JSON. A social-package-like object (platform keys with
 * title/description/post/caption/tags/hashtags/shorts_title) becomes
 * per-platform hints; any other object is passed on as capped context.
 */
export function parseJsonSource(content: string): JsonSource {
  let value: unknown;
  try {
    value = JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch {
    throw new SourceError("Selected JSON isn't valid JSON");
  }
  if (!isObject(value)) throw new SourceError("Selected JSON isn't an object");

  const platforms: Record<string, PlatformHint> = {};
  const blocks: Record<string, string> = {};
  for (const key of PLATFORM_KEYS) {
    const hint = hintFrom(value[key]);
    if (!hint) continue;
    const platform = key === "twitter" ? "x" : key;
    platforms[platform] = hint;
    const raw = JSON.stringify(value[key], null, 2);
    blocks[platform] = raw.length > JSON_BLOCK_MAX_CHARS ? `${raw.slice(0, JSON_BLOCK_MAX_CHARS)}\n… [truncated]` : raw;
  }
  if (Object.keys(platforms).length > 0) {
    return {
      kind: "social",
      video: typeof value.video === "string" ? value.video : null,
      platforms,
      blocks,
      chapters: chaptersFromJson(value.youtube),
    };
  }
  const pretty = JSON.stringify(value, null, 2);
  return pretty.length > GENERIC_JSON_MAX_CHARS
    ? { kind: "generic", text: `${pretty.slice(0, GENERIC_JSON_MAX_CHARS)}\n… [JSON truncated]`, truncated: true }
    : { kind: "generic", text: pretty, truncated: false };
}

const clock = (ms: number) => {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * SRT/VTT → compressed "[c12 03:41] text" lines: cues are merged into ~25 s
 * windows that keep the first cue's id and real start time. Over the cap:
 * keep the start, the end and an evenly sampled middle (logged).
 */
export function transcriptFromSubtitles(content: string, format: "srt" | "vtt", maxChars = TRANSCRIPT_MAX_CHARS): TranscriptSource {
  const parsed = subsrt
    .parse(content.replace(/^\uFEFF/, ""), { format })
    .filter((cue): cue is typeof cue & { start: number; text: string } => cue.type === "caption" && "text" in cue);
  const windows: { id: string; start: number; text: string[] }[] = [];
  parsed.forEach((cue, index) => {
    const text = String(cue.text).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const current = windows.at(-1);
    if (current && cue.start - current.start < TRANSCRIPT_WINDOW_MS) current.text.push(text);
    else windows.push({ id: `c${index + 1}`, start: cue.start, text: [text] });
  });
  if (windows.length === 0) throw new SourceError("Selected subtitles have no cues");
  const cues = Object.fromEntries(windows.map((w) => [w.id, w.start]));
  const lines = windows.map((w) => `[${w.id} ${clock(w.start)}] ${w.text.join(" ")}`);
  const full = lines.join("\n");
  if (full.length <= maxChars) return { text: full, segments: parsed.length, truncated: false, cues };

  const budget = (share: number) => Math.floor(maxChars * share);
  const take = (source: string[], limit: number) => {
    const out: string[] = [];
    let used = 0;
    for (const line of source) {
      if (used + line.length + 1 > limit) break;
      out.push(line);
      used += line.length + 1;
    }
    return out;
  };
  const start = take(lines, budget(0.4));
  const end = take([...lines].reverse(), budget(0.2)).reverse();
  const middlePool = lines.slice(start.length, lines.length - end.length);
  const avg = Math.max(1, Math.round(full.length / lines.length));
  const want = Math.max(1, Math.floor(budget(0.35) / avg));
  const step = Math.max(1, Math.floor(middlePool.length / want));
  const middle = take(middlePool.filter((_, i) => i % step === 0), budget(0.35));
  const text = [...start, "… [transcript cut: evenly sampled middle] …", ...middle, "… [transcript cut] …", ...end].join("\n");
  logger.info("AI transcript was cut to fit", { cues: parsed.length, windows: lines.length, kept: start.length + middle.length + end.length, fromChars: full.length, toChars: text.length });
  return { text, segments: parsed.length, truncated: true, cues };
}

async function readText(row: MediaRow): Promise<string> {
  if ((row.sizeBytes ?? 0) > MAX_SOURCE_BYTES) throw new SourceError(`${row.name} is larger than 1 MB`);
  const buffer = await downloadObjectAsBuffer(row.s3Key, { bucket: row.s3Bucket });
  if (!buffer) throw new SourceError(`${row.name} is missing from storage`);
  if (buffer.byteLength > MAX_SOURCE_BYTES) throw new SourceError(`${row.name} is larger than 1 MB`);
  return buffer.toString("utf8");
}

/** JSON first (primary facts/wording/hashtags), subtitles second (supporting detail). */
export async function loadSources(params: { json?: MediaRow | null; subtitle?: MediaRow | null }): Promise<Sources> {
  const json = params.json ? parseJsonSource(await readText(params.json)) : null;
  const transcript = params.subtitle
    ? transcriptFromSubtitles(await readText(params.subtitle), subtitleFormat(params.subtitle.originalFilename, params.subtitle.mimeType))
    : null;
  return { json, transcript };
}

/**
 * Photos for the vision call, in slide order: the library's downscaled JPEG
 * (320 px) fetched server-side and sent inline. Presigned URLs never leave
 * the server. At most MAX_AI_IMAGES per call; images that can't be read are skipped.
 */
export async function loadImages(rows: MediaRow[]): Promise<{ images: AiImage[]; slideIndexes: number[] }> {
  if (rows.length > MAX_AI_IMAGES) logger.info("AI images were cut to fit", { picked: rows.length, sent: MAX_AI_IMAGES });
  const images: AiImage[] = [];
  const slideIndexes: number[] = [];
  for (const [index, row] of rows.slice(0, MAX_AI_IMAGES).entries()) {
    const small = await downloadObjectAsBuffer(thumbnailKeyFor(row.s3Key), { bucket: row.s3Bucket }).catch(() => null);
    const original =
      small || (row.sizeBytes ?? Infinity) > MAX_INLINE_IMAGE_BYTES ? null : await downloadObjectAsBuffer(row.s3Key, { bucket: row.s3Bucket }).catch(() => null);
    const buffer = small ?? original;
    if (!buffer) {
      logger.warn("AI image skipped (no downscaled copy and the original is too large or missing)", { mediaId: row.id });
      continue;
    }
    images.push({ mimeType: small ? "image/jpeg" : row.mimeType, base64: buffer.toString("base64") });
    slideIndexes.push(index + 1);
  }
  return { images, slideIndexes };
}
