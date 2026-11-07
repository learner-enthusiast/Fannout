import { downloadObjectAsBuffer } from "@repo/s3";
import subsrt from "subsrt-ts";
import type { MediaRow } from "../media/model";
import { subtitleFormat } from "../media/subtitles";

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
  | { kind: "social"; video: string | null; platforms: Record<string, PlatformHint> }
  | { kind: "generic"; text: string; truncated: boolean };

export type TranscriptSource = { text: string; segments: number; truncated: boolean };

export type Sources = { json: JsonSource | null; transcript: TranscriptSource | null };

export class SourceError extends Error {}

export const MAX_SOURCE_BYTES = 1024 * 1024;
export const GENERIC_JSON_MAX_CHARS = 12_000;
export const TRANSCRIPT_MAX_CHARS = 10_000;

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
  for (const key of PLATFORM_KEYS) {
    const hint = hintFrom(value[key]);
    if (hint) platforms[key === "twitter" ? "x" : key] = hint;
  }
  if (Object.keys(platforms).length > 0) {
    return { kind: "social", video: typeof value.video === "string" ? value.video : null, platforms };
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
 * SRT/VTT → "[mm:ss] text" lines. Over the cap: keep the start, the end and
 * an evenly sampled middle, with a truncation note.
 */
export function transcriptFromSubtitles(content: string, format: "srt" | "vtt", maxChars = TRANSCRIPT_MAX_CHARS): TranscriptSource {
  const cues = subsrt
    .parse(content.replace(/^\uFEFF/, ""), { format })
    .filter((cue): cue is typeof cue & { start: number; text: string } => cue.type === "caption" && "text" in cue);
  if (cues.length === 0) throw new SourceError("Selected subtitles have no cues");
  const lines = cues.map((cue) => `[${clock(cue.start)}] ${String(cue.text).replace(/\s+/g, " ").trim()}`).filter((l) => !/\]\s*$/.test(l));
  const full = lines.join("\n");
  if (full.length <= maxChars) return { text: full, segments: lines.length, truncated: false };

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
  const text = [...start, "… [transcript truncated: evenly sampled middle] …", ...middle, "… [transcript truncated] …", ...end].join("\n");
  return { text, segments: lines.length, truncated: true };
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
