import { unifiedSearch } from "@repo/services/search";
import { UnifiedSearchInputSchema, UnifiedSearchResultSchema } from "@repo/services/search/model";
import { router, scoped } from "../../trpc";

export const searchRouter = router({
  /** Folders + media by name (trigram-ranked), for the ⌘K box and pickers. */
  unified: scoped("media:read")
    .meta({ openapi: { method: "GET", path: "/search", summary: "Search folders and media by name", protect: true } })
    .input(UnifiedSearchInputSchema)
    .output(UnifiedSearchResultSchema)
    .query(({ ctx, input }) => unifiedSearch(ctx.dbUserId, input)),
});
