import { z } from "zod";
import { FolderSummarySchema } from "../media-folders/model";
import { MediaViewSchema, SearchQuerySchema } from "../media/model";

export const UnifiedSearchInputSchema = z.object({
  q: SearchQuerySchema.describe("Search text (1–100 chars), matched against folder and media names."),
  /** Ranked search: at most 10 results per section (folders, media). */
  limit: z.number().int().min(1).max(10).default(10).describe("Max results per section (folders, media)."),
});

export const UnifiedSearchResultSchema = z.object({
  folders: z.array(FolderSummarySchema).describe("Matching folders, best match first."),
  media: z.array(MediaViewSchema).describe("Matching media, best match first."),
});
export type UnifiedSearchResult = z.infer<typeof UnifiedSearchResultSchema>;
