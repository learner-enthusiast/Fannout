import { z } from "zod";
import { systemPrompt, target, type PlaybookTargets } from "../shared-rules";
import type { Playbook } from "../types";

export const PROMPT_VERSION = "threads-1";

export const ThreadsOutputSchema = z.object({
  post: z.string(),
  topicTag: z.string().describe("At most ONE topic, 1–50 characters, no #, periods or ampersands; empty for none."),
});

const base = (t: PlaybookTargets) => [
  `- post: ${target(t, "post")}. Count bytes, not letters.`,
  "- Opinion or question first, then 2–3 concrete points from the brief. Conversational, with an ending people want to reply to.",
  "- No hashtags in the text. At most ONE topic tag, returned in topicTag (Threads supports one tag per post).",
];

const video = (t: PlaybookTargets) => systemPrompt("You write one Threads post that accompanies a video.", base(t));
const image = (t: PlaybookTargets) => systemPrompt("You write one Threads post that accompanies one image (see brief.slides).", base(t));
const carousel = (t: PlaybookTargets) =>
  systemPrompt("You write one Threads post that accompanies a carousel (see brief.slides, in order).", [
    ...base(t),
    "- Carousel: the hook, then one short line per slide while staying inside the byte band.",
  ]);

export const threadsPlaybooks: Playbook[] = [
  { platform: "threads", postType: "video", version: PROMPT_VERSION, schema: ThreadsOutputSchema, schemaName: "threads_video", system: video },
  { platform: "threads", postType: "image", version: PROMPT_VERSION, schema: ThreadsOutputSchema, schemaName: "threads_image", system: image },
  { platform: "threads", postType: "carousel", version: PROMPT_VERSION, schema: ThreadsOutputSchema, schemaName: "threads_carousel", system: carousel },
];
