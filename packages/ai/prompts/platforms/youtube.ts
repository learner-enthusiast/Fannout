import { z } from "zod";
import { systemPrompt, target, type PlaybookTargets } from "../shared-rules";
import type { Playbook } from "../types";

export const PROMPT_VERSION = "youtube-2";

/**
 * `description` holds parts 1–3; `faq` and `keyTerms` are separate so code can
 * insert the timestamped chapters block between them and, when the total runs
 * over the limit, shorten FAQ / key terms first — never the chapters.
 */
export const YouTubeOutputSchema = z.object({
  title: z.string(),
  description: z.string().describe("Opening lines, the 'What you'll learn' bullets and the expanding paragraphs. No chapters, FAQ, key terms or hashtags."),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })).describe("3–5 Q&As from brief.faqs; empty for Shorts or when the brief has none."),
  keyTerms: z.array(z.object({ term: z.string(), meaning: z.string() })).describe("Short glossary from secondaryKeywords the video explains; empty for Shorts."),
  tags: z.array(z.string()),
  hashtags: z.array(z.string()),
  chapters: z.array(z.object({ cueId: z.string(), label: z.string() })).describe("Cue ids only, never timestamps. Empty for Shorts or without chapterCandidates."),
});

const video = (t: PlaybookTargets) =>
  systemPrompt("You write the YouTube title, description and tags for one long-form video.", [
    `- title: ${target(t, "title")}. Keyword + specific outcome in the first 60 characters; the rest adds a secondary keyword or qualifier. No clickbait the video doesn't deliver, no ALL CAPS sentences, no < or >.`,
    `- The whole description (your description + chapters + FAQ + key terms + hashtags, assembled by code) must total ${target(t, "description")}. Write these parts:`,
    `  1) description starts with 2 lines (~${t.visibleChars ?? 150} characters, shown in search) that hold the primaryKeyword and what the viewer gets, and make sense on their own.`,
    "  2) then a \"What you'll learn\" heading with 5–8 bullets from keyPoints.",
    "  3) then 2–4 paragraphs expanding the key points with facts and examples.",
    "  4) chapters: pick cue ids from brief.chapterCandidates, one per real topic change (prefer more when the content supports it), each with a 3–7 word keyword-rich label; no \"Intro\" unless it really is one. Return cue ids only — code writes the timestamps. No chapterCandidates = empty array.",
    "  5) faq: 3–5 Q&As from brief.faqs (helps search match questions).",
    "  6) keyTerms: a short glossary of secondaryKeywords the video explains.",
    "  When the prompt has a WATCH NEXT video, code adds a \"Watch next: <title> <link>\" line just above the hashtags; it counts toward the total, so leave room for it and never write that line or any link to it yourself.",
    `  7) hashtags: ${t.hashtags} (YouTube shows the first 3 above the title). Code puts them on the last line.`,
    `- tags: 15–25 search phrases, ${target(t, "tags")}. No #.`,
    "- No < or > anywhere. Links only if they appear in the brief.",
  ]);

const short = (t: PlaybookTargets) =>
  systemPrompt("You write the title and description for one YouTube Short (vertical, under 3 minutes).", [
    `- title: ${target(t, "shorts_title")}. Hook-style, primaryKeyword early, no ALL CAPS sentences, no < or >.`,
    `- description: 2–4 short lines saying what the viewer gets (${target(t, "shorts_description")}).`,
    `- hashtags: ${t.hashtags}, one of them the topic.`,
    `- tags: 15–25 search phrases, ${target(t, "tags")}. No #.`,
    "- chapters, faq and keyTerms: empty arrays (Shorts have none).",
  ]);

/** An image post (2–10 photos). YouTube has no API for these: the user publishes it by hand. */
export const YouTubeCarouselOutputSchema = z.object({ post: z.string(), hashtags: z.array(z.string()) });

const carousel = (t: PlaybookTargets) =>
  systemPrompt("You write the text of a YouTube image post (a swipeable set of photos on the channel; see brief.slides, in order).", [
    `- post + hashtags together: ${target(t, "community_post")}. YouTube documents no limit; stay in the band.`,
    "- First line: a hook that holds the primaryKeyword and makes sense on its own (the feed cuts the post after a couple of lines).",
    "- Then 3–6 short lines of value from the brief (keyPoints, concrete facts).",
    "- Then slide-by-slide teasers: one short line per slide, in order, saying what it shows.",
    "- End with ONE question that invites comments.",
    `- hashtags: ${t.hashtags}. Code appends them at the end; none is fine.`,
    "- No links unless they appear in the brief.",
  ]);

export const youtubePlaybooks: Playbook[] = [
  { platform: "youtube", postType: "video", version: PROMPT_VERSION, schema: YouTubeOutputSchema, schemaName: "youtube_video", system: video },
  { platform: "youtube", postType: "short", version: PROMPT_VERSION, schema: YouTubeOutputSchema, schemaName: "youtube_short", system: short },
  { platform: "youtube", postType: "carousel", version: PROMPT_VERSION, schema: YouTubeCarouselOutputSchema, schemaName: "youtube_carousel", system: carousel },
];
