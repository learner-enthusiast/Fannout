import { z } from "zod";

export const BRIEF_PROMPT_VERSION = "brief-1";

/**
 * Stage 1. Everything the platform writers may use. Strict structured output:
 * every key is required, "nothing found" is an empty array / empty string.
 */
export const BriefSchema = z.object({
  topic: z.string().describe("One line: what this content is about."),
  audience: z.string().describe("Who it is for."),
  language: z.string().describe("Language of the source (e.g. English, Bengali). Writers write in it."),
  primaryKeyword: z.string().describe("The phrase people would search to find this."),
  secondaryKeywords: z.array(z.string()).describe("8–15 further search phrases found in the source."),
  keyPoints: z
    .array(z.object({ point: z.string(), sourceRef: z.string().describe("JSON field name or cue id (e.g. c12) it comes from.") }))
    .describe("8–15 distinct points the source makes."),
  concreteFacts: z.array(z.string()).describe("Numbers, names, results and steps from the source."),
  examples: z.array(z.string()).describe("Stories, demos and before/after moments from the source."),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).describe("Questions the source actually answers."),
  quotes: z.array(z.string()).describe("Short, strong lines from the transcript, verbatim."),
  hookCandidates: z
    .array(
      z.object({
        type: z.enum(["surprising_fact", "bold_claim", "question", "mistake", "result_first", "contrarian"]),
        text: z.string(),
      }),
    )
    .describe("Opening lines, each backed by the source."),
  chapterCandidates: z
    .array(z.object({ cueId: z.string().describe("Cue id from the transcript, e.g. c12."), label: z.string() }))
    .describe("Real topic changes. Only from the transcript's cue ids; empty without a transcript."),
  slides: z
    .array(z.object({ index: z.number().int().describe("1-based slide number."), whatItShows: z.string(), altText: z.string() }))
    .describe("One entry per attached image, in order; empty when no images are attached."),
  gaps: z.array(z.string()).describe("What the source does not cover (writers must not fill these in)."),
});
export type Brief = z.infer<typeof BriefSchema>;

export const BRIEF_SYSTEM_PROMPT = [
  "You prepare a factual brief that social media writers will work from. They will not see the original sources.",
  "",
  "Rules:",
  "- Extract, don't invent. Every item must trace to the sources; when unsure, leave it out and note it in gaps.",
  "- Source priority: the social JSON first (the author's own wording, angle and claims), the transcript second (extra facts, the only source of cue ids), attached images for image/carousel posts.",
  "- The writers need enough REAL material to write long posts without padding: aim for 8–15 keyPoints and 8–15 secondaryKeywords, plus every concrete fact, example and answered question you can find. Fewer is correct when the source is thin.",
  "- keyPoints[].sourceRef is the JSON field name (e.g. youtube.description) or the cue id (e.g. c12) the point comes from.",
  "- quotes are verbatim transcript lines, short. No transcript = no quotes.",
  "- chapterCandidates use ONLY cue ids that appear in the transcript as [c12 03:41]. Pick the first cue of each real topic change. Never write a timestamp.",
  "- slides: one entry per attached image in the order given (index starts at 1); whatItShows says what is visible, altText describes it for someone who can't see it.",
  "- language is the language of the sources; write the brief in that language.",
].join("\n");
