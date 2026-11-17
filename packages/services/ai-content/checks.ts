import { BANNED_PHRASES, GENERIC_HASHTAGS, type ResolvedTarget } from "@repo/ai/prompts/length-targets-api";
import { measure } from "./model";

/** Code-side checks for AI copy. Pure functions; every limit is measured in the platform's own unit. */

export const unitWord = (unit: ResolvedTarget["unit"]) => (unit === "bytes" ? "bytes" : unit === "weighted" ? "weighted chars" : "chars");
export const num = (n: number) => n.toLocaleString("en-US");
export const bandText = (t: ResolvedTarget) => `${num(t.min)}–${num(t.max)} ${unitWord(t.unit)}`;

/** Strip #, spaces and punctuation; dedupe (case-insensitive); drop generic tags. */
export function normalizeHashtags(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const tag = raw.replace(/[^\p{L}\p{N}_]/gu, "");
    const key = tag.toLowerCase();
    if (!tag || seen.has(key) || GENERIC_HASHTAGS.includes(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export const hashtagLine = (tags: string[]) => tags.map((t) => `#${t}`).join(" ");

/** Hashtags the model left inside the text (they belong in the hashtags field). */
export const stripInlineHashtagLine = (text: string) => text.replace(/\n+(?:\s*#[\p{L}\p{N}_]+)+\s*$/u, "").trimEnd();

const straight = (text: string) => text.replace(/[’‘]/g, "'").toLowerCase();
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function bannedPhrasesIn(text: string): string[] {
  const haystack = straight(text);
  return BANNED_PHRASES.filter((phrase) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(phrase)}`, "u").test(haystack));
}

const sentences = (text: string) =>
  text
    .split(/(?<=[.!?…।])\s+|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);

/** Sentences (25+ characters) that appear more than once. */
export function repeatedSentences(text: string): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const sentence of sentences(text)) {
    const key = straight(sentence).replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ");
    if (key.length < 25) continue;
    if (seen.has(key)) repeated.add(sentence);
    seen.add(key);
  }
  return [...repeated];
}

/** The keyword itself, or every significant word of it, appears in the text. */
export function hasKeyword(text: string, keyword: string): boolean {
  const haystack = straight(text);
  const needle = straight(keyword).trim();
  if (!needle) return true;
  if (haystack.includes(needle)) return true;
  const words = needle.split(/\s+/).filter((w) => [...w].length >= 4);
  return words.length > 0 && words.every((w) => haystack.includes(w));
}

/**
 * The slice people see before "more" must make sense alone: within the first
 * `chars` characters a sentence or line has to end (not before 40% of the slice).
 */
export function visibleSliceOk(text: string, chars: number): boolean {
  const points = [...text];
  if (points.length <= chars) return true;
  const slice = points.slice(0, chars + 1).join("");
  let last = -1;
  for (const match of slice.matchAll(/[.!?…।:\n]/gu)) last = match.index;
  return last >= chars * 0.4;
}

/** Longest prefix within the limit, cut at a sentence end when one is close, else at a word. */
export function trimToLimit(value: string, limit: number, unit: ResolvedTarget["unit"]): string {
  if (measure(value, unit) <= limit) return value;
  const points = [...value];
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(points.slice(0, mid).join(""), unit) <= limit) lo = mid;
    else hi = mid - 1;
  }
  const hard = points.slice(0, lo).join("");
  let sentenceEnd = -1;
  for (const match of hard.matchAll(/[.!?…।](?=\s|$)|\n/gu)) sentenceEnd = match.index + (match[0] === "\n" ? 0 : 1);
  if (sentenceEnd > hard.length * 0.6) return hard.slice(0, sentenceEnd).trimEnd();
  const word = hard.search(/\s\S*$/);
  return (word > hard.length * 0.5 ? hard.slice(0, word) : hard).replace(/[\s,;:–—-]+$/u, "");
}

export const firstLineOf = (text: string) => text.trimStart().split("\n")[0] ?? "";
