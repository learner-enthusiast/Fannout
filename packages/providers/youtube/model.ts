import { z } from "zod";

/*
 * YouTube Data API v3 schemas. Resource and method-parameter schemas are
 * generated from the official @googleapis/youtube SDK (see
 * model.generated.ts / scripts/generate-google.mjs); hand-written schemas for
 * provider-specific helpers are below.
 */
export * from "./model.generated";

export const YouTubeDownloadCaptionInputSchema = z.object({
  /** Caption track id (captions.list). */
  id: z.string().min(1),
  /** sbv | scc | srt | ttml | vtt */
  tfmt: z.enum(["sbv", "scc", "srt", "ttml", "vtt"]).optional(),
  /** ISO 639-1 language to translate into. */
  tlang: z.string().optional(),
  onBehalfOf: z.string().optional(),
  onBehalfOfContentOwner: z.string().optional(),
});
export type YouTubeDownloadCaptionInput = z.input<typeof YouTubeDownloadCaptionInputSchema>;
