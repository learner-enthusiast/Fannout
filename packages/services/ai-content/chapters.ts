/**
 * YouTube chapters. The model only picks cue ids + labels; every timestamp
 * here comes from the subtitle cue (or the author's JSON). Anything that
 * doesn't validate is dropped — times are never invented.
 */
export type Chapter = { seconds: number; label: string };

export const CHAPTER_MIN_COUNT = 3;
export const CHAPTER_MIN_SECONDS = 10;

const cleanLabel = (label: string) => label.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

/** Cue ids → real start times. Unknown cue ids are skipped. */
export function chaptersFromCues(picks: { cueId: string; label: string }[], cues: Record<string, number>): Chapter[] {
  return picks.flatMap((pick) => {
    const ms = cues[pick.cueId.trim().replace(/^\[|\]$/g, "")];
    return ms === undefined ? [] : [{ seconds: Math.floor(ms / 1000), label: pick.label }];
  });
}

/**
 * First chapter at 00:00, ascending, each at least 10 s long, the last one
 * before the video ends, at least 3 in total. Returns null when that can't be met.
 */
export function validateChapters(input: Chapter[], durationSeconds: number | null): Chapter[] | null {
  const sorted = input
    .map((c) => ({ seconds: Math.max(0, Math.floor(c.seconds)), label: cleanLabel(c.label) }))
    .filter((c) => c.label && Number.isFinite(c.seconds))
    .sort((a, b) => a.seconds - b.seconds);
  if (sorted.length === 0) return null;
  // YouTube requires the first chapter at 00:00.
  sorted[0] = { ...sorted[0]!, seconds: 0 };
  const end = durationSeconds && durationSeconds > 0 ? durationSeconds : null;
  const chapters: Chapter[] = [];
  for (const chapter of sorted) {
    const previous = chapters.at(-1);
    if (previous && chapter.seconds - previous.seconds < CHAPTER_MIN_SECONDS) continue;
    if (end !== null && chapter.seconds > end - CHAPTER_MIN_SECONDS) continue;
    chapters.push(chapter);
  }
  return chapters.length >= CHAPTER_MIN_COUNT ? chapters : null;
}

const two = (n: number) => String(n).padStart(2, "0");

/** mm:ss, or h:mm:ss for videos over an hour. */
export function formatChapterTime(seconds: number, hours: boolean): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return hours ? `${h}:${two(m)}:${two(s)}` : `${two(h * 60 + m)}:${two(s)}`;
}

export function chapterBlock(chapters: Chapter[], durationSeconds: number | null): string {
  const hours = (durationSeconds ?? chapters.at(-1)?.seconds ?? 0) >= 3600;
  return ["Chapters", ...chapters.map((c) => `${formatChapterTime(c.seconds, hours)} ${c.label}`)].join("\n");
}

const TIME = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—:]?\s+(.+?)\s*$/;

function toSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(value.trim());
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

/** Author-written timestamps in a social JSON: a chapters/timestamps array, or "03:41 Label" lines in the description. */
export function chaptersFromJson(block: unknown): Chapter[] {
  if (typeof block !== "object" || block === null) return [];
  const record = block as Record<string, unknown>;
  const list = [record.chapters, record.timestamps].find(Array.isArray) as unknown[] | undefined;
  if (list) {
    return list.flatMap((item) => {
      if (typeof item === "string") {
        const match = TIME.exec(item);
        return match ? [{ seconds: Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]), label: match[4]! }] : [];
      }
      if (typeof item !== "object" || item === null) return [];
      const entry = item as Record<string, unknown>;
      const seconds = toSeconds(entry.time ?? entry.start ?? entry.timestamp ?? entry.seconds);
      const label = entry.label ?? entry.title ?? entry.name;
      return seconds !== null && typeof label === "string" ? [{ seconds, label }] : [];
    });
  }
  if (typeof record.description !== "string") return [];
  return record.description.split("\n").flatMap((line) => {
    const match = TIME.exec(line);
    return match ? [{ seconds: Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]), label: match[4]! }] : [];
  });
}

/** Removes author-written timestamp lines (code re-inserts the validated block). */
export const stripChapterLines = (text: string) =>
  text
    .split("\n")
    .filter((line) => !TIME.test(line) && !/^\s*(chapters|timestamps)\s*:?\s*$/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
