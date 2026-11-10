import {
  createMentionContact,
  deleteMentionContact,
  searchMentionContacts,
  updateMentionContact,
} from "@repo/services/mentions";
import {
  CreateMentionInputBaseSchema,
  MentionContactPageSchema,
  MentionContactViewSchema,
  MentionIdInputSchema,
  SearchMentionsInputSchema,
  UpdateMentionInputSchema,
  UpdatedMentionSchema,
} from "@repo/services/mentions/model";
import { router, scoped } from "../../trpc";

export const mentionsRouter = router({
  search: scoped("posts:read")
    .meta({ openapi: { method: "GET", path: "/mentions/search", summary: "Search saved mention contacts; seeds your own connected accounts", protect: true } })
    .input(SearchMentionsInputSchema)
    .output(MentionContactPageSchema)
    .query(({ ctx, input }) => searchMentionContacts(ctx.dbUserId, input)),

  create: scoped("posts:write")
    .meta({ openapi: { method: "POST", path: "/mentions", summary: "Save an X/Threads handle, LinkedIn URN or Facebook Page mention contact", protect: true } })
    .input(CreateMentionInputBaseSchema)
    .output(MentionContactViewSchema)
    .mutation(({ ctx, input }) => createMentionContact(ctx.dbUserId, input)),

  update: scoped("posts:write")
    .meta({ openapi: { method: "PATCH", path: "/mentions/{id}", summary: "Rename or correct a mention contact", protect: true } })
    .input(UpdateMentionInputSchema)
    .output(MentionContactViewSchema)
    .mutation(({ ctx, input }) => updateMentionContact(ctx.dbUserId, input)),

  delete: scoped("posts:write")
    .meta({ openapi: { method: "DELETE", path: "/mentions/{id}", summary: "Delete a saved mention contact", protect: true } })
    .input(MentionIdInputSchema)
    .output(UpdatedMentionSchema)
    .mutation(({ ctx, input }) => deleteMentionContact(ctx.dbUserId, input.id)),
});