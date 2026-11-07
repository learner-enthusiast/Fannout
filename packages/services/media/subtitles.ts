import subsrt from "subsrt-ts";
import type { SubtitleSummary } from "./model";

export class InvalidSubtitleError extends Error {}

/**
 * Parses SRT or WebVTT text (subsrt-ts) and returns a summary.
 * Throws InvalidSubtitleError when nothing parses as a cue.
 */
export function summarizeSubtitles(content: string, format: "srt" | "vtt"): SubtitleSummary {
  const text = content.replace(/^\uFEFF/, "");
  let captions;
  try {
    captions = subsrt.parse(text, { format });
  } catch (error) {
    throw new InvalidSubtitleError(`Not a valid ${format.toUpperCase()} file: ${(error as Error).message}`);
  }
  const cues = captions.filter(
    (cue): cue is typeof cue & { start: number; end: number } =>
      cue.type === "caption" && typeof (cue as { end?: unknown }).end === "number",
  );
  if (cues.length === 0) throw new InvalidSubtitleError(`No ${format.toUpperCase()} cues found`);
  return {
    segments: cues.length,
    durationMs: Math.max(...cues.map((cue) => cue.end)),
  };
}

export function subtitleFormat(filename: string | null, mimeType: string): "srt" | "vtt" {
  if (mimeType === "text/vtt" || filename?.toLowerCase().endsWith(".vtt")) return "vtt";
  return "srt";
}
