import { z } from "zod";
import { FolderSummarySchema } from "../media-folders/model";
import { MediaViewSchema, SearchQuerySchema } from "../media/model";

export const UnifiedSearchInputSchema = z.object({
  q: SearchQuerySchema,
  limit: z.number().int().min(1).max(25).default(10),
});

export const UnifiedSearchResultSchema = z.object({
  folders: z.array(FolderSummarySchema),
  media: z.array(MediaViewSchema),
});
export type UnifiedSearchResult = z.infer<typeof UnifiedSearchResultSchema>;
