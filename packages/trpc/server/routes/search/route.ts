import { unifiedSearch } from "@repo/services/search";
import { UnifiedSearchInputSchema, UnifiedSearchResultSchema } from "@repo/services/search/model";
import { protectedProcedure, router } from "../../trpc";

export const searchRouter = router({
  /** Folders + media by name (trigram-ranked), for the ⌘K box and pickers. */
  unified: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/search", protect: true } })
    .input(UnifiedSearchInputSchema)
    .output(UnifiedSearchResultSchema)
    .query(({ ctx, input }) => unifiedSearch(ctx.dbUserId, input)),
});
