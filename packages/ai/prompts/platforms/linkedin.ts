import { z } from "zod";
import { systemPrompt, target, type PlaybookTargets } from "../shared-rules";
import type { Playbook } from "../types";

export const PROMPT_VERSION = "linkedin-1";

export const LinkedInOutputSchema = z.object({ post: z.string(), hashtags: z.array(z.string()) });

const base = (t: PlaybookTargets) => [
  `- post + hashtags together: ${target(t, "post")}.`,
  `- Lines 1–2 are the hook shown before "see more" (~${t.visibleChars ?? 210} characters): a specific result, mistake or contrarian insight from the brief.`,
  "- Then: a short story or context (from examples), a 4–7 item takeaway list (each item with a concrete detail), one \"what most people get wrong\" paragraph if the source supports it, then the lesson in 1–2 lines.",
  "- Short paragraphs (1–2 lines) with a blank line between them. Professional first person, no hype.",
  "- End with ONE specific question that invites comments.",
  `- hashtags: ${t.hashtags}. Code appends them after the question.`,
  "- No external links in the body.",
];

const video = (t: PlaybookTargets) => systemPrompt("You write a LinkedIn post that accompanies a video.", base(t));
const image = (t: PlaybookTargets) => systemPrompt("You write a LinkedIn post that accompanies one image (see brief.slides).", base(t));
const carousel = (t: PlaybookTargets) =>
  systemPrompt("You write a LinkedIn post that accompanies a multi-image carousel (see brief.slides, in order).", [
    ...base(t),
    "- Carousel: after the hook, give a slide-by-slide summary (one line per slide, in order), then a call to swipe through before the closing question.",
  ]);

export const linkedinPlaybooks: Playbook[] = [
  { platform: "linkedin", postType: "video", version: PROMPT_VERSION, schema: LinkedInOutputSchema, schemaName: "linkedin_video", system: video },
  { platform: "linkedin", postType: "image", version: PROMPT_VERSION, schema: LinkedInOutputSchema, schemaName: "linkedin_image", system: image },
  { platform: "linkedin", postType: "carousel", version: PROMPT_VERSION, schema: LinkedInOutputSchema, schemaName: "linkedin_carousel", system: carousel },
];
