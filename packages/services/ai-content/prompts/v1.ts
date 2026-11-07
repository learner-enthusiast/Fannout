import type { Platform } from "../../publishing/platforms";
import { limitText, type AiField } from "../model";
import type { Sources } from "../sources";

export const PROMPT_VERSION = "v1";

export type PromptTarget = {
  key: string;
  platform: Platform;
  platformLabel: string;
  accountName: string;
  fields: AiField[];
  isShort: boolean;
};

const STYLE: Record<Platform, string> = {
  youtube:
    "YouTube — title: specific, curiosity + main keyword, no clickbait or ALL CAPS. Description: a hook line, then bullets of what viewers will learn, links only if they appear in the sources, and 3–5 hashtags at the very end. Tags: short keyword phrases. Titles and descriptions must not contain < or >.",
  x: "X — one tight hook, 1–2 hashtags, no links unless they appear in the sources.",
  linkedin: "LinkedIn — a story-style hook, then short lines starting with →, end with a question to invite comments, then 3–5 hashtags.",
  threads: "Threads — conversational, like talking to a friend, at most 1 hashtag.",
  facebook: "Facebook — short context, a question to invite comments, then 3–4 hashtags. A video title (if asked) is short and descriptive.",
};

/** System prompt: rules + per-platform limits and style for the requested fields only. */
export function buildSystemPrompt(targets: PromptTarget[]): string {
  const platforms = [...new Set(targets.map((t) => t.platform))];
  const limits = targets
    .map((t) => {
      const fields = t.fields.map((f) => {
        const short = t.isShort && t.platform === "youtube" && f.name === "title" ? " (this is a YouTube Short: punchy Shorts title)" : "";
        return `  - ${f.name} (${f.label}): ${limitText(f) || "no hard limit"}${short}`;
      });
      return `${t.key} = ${t.platformLabel} (${t.accountName}):\n${fields.join("\n")}`;
    })
    .join("\n");

  return [
    "You write social media copy for one piece of content, adapted to each platform.",
    "",
    "Rules:",
    "- Use ONLY facts found in the sources. Never invent numbers, links, names, quotes or claims.",
    "- The social JSON is the primary source (facts, wording, hashtags). The transcript adds supporting detail; if they disagree, the JSON wins.",
    "- If the JSON already has copy for a platform, keep its voice and structure and adapt it to the limits.",
    "- Write in the same language as the sources.",
    "- Stay strictly within every limit below. Count carefully; shorter is fine.",
    "- For a YouTube Short, add #shorts among the description hashtags.",
    "",
    "Style:",
    ...platforms.map((p) => `- ${STYLE[p]}`),
    "",
    "Return a JSON object keyed by target (t1, t2, …) containing exactly the requested fields:",
    limits,
  ].join("\n");
}

export function buildUserPrompt(params: {
  sources: Sources;
  targets: PromptTarget[];
  instruction?: string;
  video?: { orientation: string | null; durationSeconds: number | null } | null;
}): string {
  const { sources, targets, instruction, video } = params;
  const parts: string[] = [];

  if (sources.json?.kind === "social") {
    parts.push("## Social JSON (primary source)");
    if (sources.json.video) parts.push(`Content: ${sources.json.video}`);
    for (const [platform, hint] of Object.entries(sources.json.platforms)) {
      parts.push(`### ${platform}\n${JSON.stringify(hint, null, 2)}`);
    }
  } else if (sources.json?.kind === "generic") {
    parts.push(`## JSON context (primary source)${sources.json.truncated ? " — truncated" : ""}\n${sources.json.text}`);
  }
  if (sources.transcript) {
    parts.push(
      `## Transcript (supporting detail, ${sources.transcript.segments} cues${sources.transcript.truncated ? ", truncated" : ""})\n${sources.transcript.text}`,
    );
  }
  if (video) {
    const minutes = video.durationSeconds ? `${Math.round(video.durationSeconds)} s` : "unknown length";
    parts.push(`## Video\n${video.orientation ?? "unknown"} orientation, ${minutes}`);
  }
  parts.push(
    "## Write",
    targets.map((t) => `${t.key}: ${t.platformLabel} → ${t.fields.map((f) => f.name).join(", ")}`).join("\n"),
  );
  if (instruction) parts.push(`## Extra instruction from the user\n${instruction}`);
  return parts.join("\n\n");
}

/** Repair prompt for fields that broke a limit: rewrite only those. */
export function buildRepairPrompt(failures: { key: string; field: AiField; value: string; problem: string }[]): string {
  return [
    "Rewrite each value below so it passes its limit. Keep the hook, the key facts and the language. Do not add new facts.",
    "",
    ...failures.map((f) => `${f.key}.${f.field.name} — ${limitText(f.field)} (${f.problem}):\n${f.value}`),
  ].join("\n");
}
