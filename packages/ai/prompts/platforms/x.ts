import { z } from "zod";
import { systemPrompt, TAGGED_PEOPLE_RULE, target, type PlaybookTargets } from "../shared-rules";
import type { Playbook } from "../types";

export const PROMPT_VERSION = "x-2";

export const XOutputSchema = z.object({ post: z.string(), hashtags: z.array(z.string()) });

const base = (t: PlaybookTargets) => [
  `- post + hashtags together: ${target(t, "post")}.`,
  "- Hook first, then one or two concrete facts from the brief. Every character must carry meaning.",
  `- hashtags: ${t.hashtags}. Code appends them at the end (each costs its length + 2).`,
  "- No links unless they appear in the brief.",
  TAGGED_PEOPLE_RULE,
];

const video = (t: PlaybookTargets) => systemPrompt("You write one X post that accompanies a video.", base(t));
const image = (t: PlaybookTargets) => systemPrompt("You write one X post that accompanies one image (see brief.slides).", base(t));
const carousel = (t: PlaybookTargets) =>
  systemPrompt("You write one X post that accompanies up to 4 images (see brief.slides, in order).", [...base(t), "- The post introduces the set of images as a whole."]);

export const xPlaybooks: Playbook[] = [
  { platform: "x", postType: "video", version: PROMPT_VERSION, schema: XOutputSchema, schemaName: "x_video", system: video },
  { platform: "x", postType: "image", version: PROMPT_VERSION, schema: XOutputSchema, schemaName: "x_image", system: image },
  { platform: "x", postType: "carousel", version: PROMPT_VERSION, schema: XOutputSchema, schemaName: "x_carousel", system: carousel },
];
