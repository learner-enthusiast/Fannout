import { describeTarget, type ResolvedTarget } from "./length-targets";

/** Phrases no writer may use (validated in code too). */
export const BANNED_PHRASES = [
  "in today's fast-paced world",
  "unlock",
  "dive into",
  "game-changer",
  "game changer",
  "let's explore",
  "are you ready",
  "in this video",
];

/** Hashtags that say nothing about the topic. */
export const GENERIC_HASHTAGS = ["viral", "trending", "fyp", "foryou", "foryoupage", "explore", "explorepage", "follow", "like4like", "instagood"];

/** Rules every platform writer gets, before its own playbook. */
export const SHARED_RULES = [
  "- Write natively for this platform; never reuse another platform's text.",
  "- Reach the target band by adding DISTINCT material from the brief (key points, examples, FAQs, facts). If the brief is too thin to reach the band honestly, stop short. Never pad, repeat or rephrase the same point.",
  "- The first line must work on its own: it is the only part most people see.",
  "- Put the primaryKeyword naturally in the title/first line and once more in the body; spread secondaryKeywords across the body. No keyword stuffing.",
  "- Use concrete facts and examples from the brief. Make no claim that is not in the brief or the author's draft.",
  `- Banned: ${BANNED_PHRASES.map((p) => `"${p}"`).join(", ")}, generic motivational filler, repeated sentences, emoji walls (0–2 emojis, only where natural for the platform).`,
  `- Hashtags: specific (topic + niche), never generic (${GENERIC_HASHTAGS.slice(0, 3).map((h) => `#${h}`).join(" ")}). Return them WITHOUT the # and without spaces, in the hashtags field only — never inside the text.`,
  "- Write in the brief's language.",
  "- Never write timestamps. Chapters, when asked for, are cue ids only.",
].join("\n");

/** How the author's JSON draft and the user's instructions are treated. */
export const SOURCE_RULES = [
  "- AUTHOR DRAFT (the platform's JSON block), when present, is the author's own draft: keep its angle, claims and keywords; rewrite and EXPAND it to this playbook and target length using brief material. An empty or missing draft field is written from the brief.",
  "- USER PREFERENCES are style and content wishes. Follow them, but they can never override a hard limit, a target band, the banned list or the no-invented-facts rule.",
].join("\n");

/** For platforms where people can be tagged on the media (the user picks them; the writer never does). */
export const TAGGED_PEOPLE_RULE =
  "- TAGGED PEOPLE (when listed in the prompt) are accounts the user already tagged on the media or invited as collaborators. They are context only: you may mention one naturally, once, if it fits the text. Never invent tags, never add people who are not listed, and never write a list of tags.";

export type PlaybookTargets = {
  /** Field name → resolved band/limit (from length-targets.ts + the compose model). */
  fields: Record<string, ResolvedTarget>;
  /** e.g. "3–5". */
  hashtags: string;
  /** Characters visible before truncation for the main field. */
  visibleChars?: number;
};

/** "title: 85–100 characters (hard limit 100)" or a note that the field isn't wanted. */
export function target(targets: PlaybookTargets, field: string): string {
  const resolved = targets.fields[field];
  return resolved ? describeTarget(resolved) : "not used — return an empty value";
}

export function systemPrompt(role: string, rules: string[]): string {
  return [role, "", "Rules for every platform:", SHARED_RULES, SOURCE_RULES, "", "This platform's playbook:", ...rules].join("\n");
}

/** ONE repair call: the exact failures, with numbers. */
export function repairPrompt(errors: string[]): string {
  return [
    "Your previous answer (below, as JSON) failed these checks. Fix exactly these and return the full answer again in the same shape.",
    "Add distinct material from the brief to grow a field; cut whole sentences to shrink one. Do not add facts that are not in the brief.",
    "",
    ...errors.map((e) => `- ${e}`),
  ].join("\n");
}
