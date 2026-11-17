import { z } from "zod";
import { systemPrompt, target, type PlaybookTargets } from "../shared-rules";
import type { Playbook } from "../types";

export const PROMPT_VERSION = "facebook-1";

export const FacebookOutputSchema = z.object({
  title: z.string().describe("Video title; empty for photo posts."),
  post: z.string(),
  hashtags: z.array(z.string()),
});

const base = (t: PlaybookTargets) => [
  `- post + hashtags together: ${target(t, "post")}. Facebook's hard limit is far higher; aim for the band, not the limit.`,
  `- First a hook line that makes sense alone (~${t.visibleChars ?? 125} characters are shown before "See more").`,
  "- Then 3–5 conversational paragraphs with facts and examples from the brief, a short list if it helps, and a question or call to action at the end.",
  `- hashtags: ${t.hashtags}. Code appends them at the end.`,
];

const video = (t: PlaybookTargets) =>
  systemPrompt("You write the Facebook Page post that accompanies a video.", [`- title: ${target(t, "title")}. primaryKeyword first.`, ...base(t)]);
const reel = (t: PlaybookTargets) =>
  systemPrompt("You write the Facebook Page post that accompanies a short vertical video (Reel).", [
    `- title: ${target(t, "title")}. primaryKeyword first, hook-style.`,
    ...base(t),
  ]);
const image = (t: PlaybookTargets) =>
  systemPrompt("You write the Facebook Page post that accompanies one photo (see brief.slides).", [...base(t), "- title: empty string (photo posts have none)."]);
const carousel = (t: PlaybookTargets) =>
  systemPrompt("You write the Facebook Page post that accompanies several photos (see brief.slides, in order).", [
    ...base(t),
    "- Multi-photo: after the hook, one line per photo in order, then the call to action.",
    "- title: empty string (photo posts have none).",
  ]);

export const facebookPlaybooks: Playbook[] = [
  { platform: "facebook", postType: "video", version: PROMPT_VERSION, schema: FacebookOutputSchema, schemaName: "facebook_video", system: video },
  { platform: "facebook", postType: "short", version: PROMPT_VERSION, schema: FacebookOutputSchema, schemaName: "facebook_reel", system: reel },
  { platform: "facebook", postType: "image", version: PROMPT_VERSION, schema: FacebookOutputSchema, schemaName: "facebook_image", system: image },
  { platform: "facebook", postType: "carousel", version: PROMPT_VERSION, schema: FacebookOutputSchema, schemaName: "facebook_carousel", system: carousel },
];
