import { z } from "zod";
import { systemPrompt, TAGGED_PEOPLE_RULE, target, type PlaybookTargets } from "../shared-rules";
import type { Playbook } from "../types";

export const PROMPT_VERSION = "instagram-2";

export const InstagramOutputSchema = z.object({
  caption: z.string(),
  hashtags: z.array(z.string()),
  altTexts: z.array(z.string()).describe("One per slide, in slide order; empty for reels."),
});

const base = (t: PlaybookTargets) => [
  `- caption + hashtags together: ${target(t, "caption")}.`,
  `- The first line (~${t.visibleChars ?? 125} characters, shown before "more") is the hook and holds the primaryKeyword (caption text is searchable).`,
  "- Body: 6–10 short lines or a mini list of value from keyPoints/facts, then ONE specific call to action (save it, share it with someone who…, comment a word).",
  `- hashtags: ${t.hashtags}, niche + topic. Code appends them at the end.`,
  "- No links (they are not clickable). @mentions only for accounts named in the brief or listed under TAGGED PEOPLE.",
  TAGGED_PEOPLE_RULE,
];

const reel = (t: PlaybookTargets) =>
  systemPrompt("You write the Instagram caption for one Reel.", [...base(t), "- altTexts: empty array (reels have none)."]);
const image = (t: PlaybookTargets) =>
  systemPrompt("You write the Instagram caption and alt text for one photo (see brief.slides).", [
    ...base(t),
    `- altTexts: one entry describing the photo for someone who can't see it: ${target(t, "altText")}.`,
  ]);
const carousel = (t: PlaybookTargets) =>
  systemPrompt("You write the Instagram caption and alt texts for a carousel (see brief.slides, in order).", [
    ...base(t),
    "- Carousel: the hook promises what the slides deliver, then a \"swipe\" cue, then slide-by-slide teasers (one short line per slide) before the call to action.",
    `- altTexts: one entry per slide, in slide order, each ${target(t, "altText")}, describing what the slide shows.`,
  ]);

export const instagramPlaybooks: Playbook[] = [
  { platform: "instagram", postType: "short", version: PROMPT_VERSION, schema: InstagramOutputSchema, schemaName: "instagram_reel", system: reel },
  { platform: "instagram", postType: "image", version: PROMPT_VERSION, schema: InstagramOutputSchema, schemaName: "instagram_image", system: image },
  { platform: "instagram", postType: "carousel", version: PROMPT_VERSION, schema: InstagramOutputSchema, schemaName: "instagram_carousel", system: carousel },
];
