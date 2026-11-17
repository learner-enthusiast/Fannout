import {
  createMentionContact,
  deleteMentionContact,
  lookupInstagramUser,
  resolveXUser,
  searchMentionContacts,
  updateMentionContact,
} from "@repo/services/mentions";
import {
  CreateMentionInputBaseSchema,
  InstagramUserLookupSchema,
  LookupInstagramUserInputSchema,
  MentionContactPageSchema,
  MentionContactViewSchema,
  MentionIdInputSchema,
  ResolveXUserInputSchema,
  ResolvedXUserSchema,
  SearchMentionsInputSchema,
  UpdateMentionInputSchema,
  UpdatedMentionSchema,
} from "@repo/services/mentions/model";
import { rateLimited, router, scoped } from "../../trpc";

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

  /** X tags need user ids. The X lookup is billed, so the id is saved on the contact and never fetched twice. */
  resolveX: rateLimited(scoped("posts:write"), "publish")
    .meta({ openapi: { method: "POST", path: "/mentions/x/resolve", summary: "Resolve an X username to its user ID for media tags (saved; looked up once)", protect: true } })
    .input(ResolveXUserInputSchema)
    .output(ResolvedXUserSchema)
    .mutation(({ ctx, input }) => resolveXUser(ctx.dbUserId, input)),

  /**
   * Instagram has no user search: suggestions come from saved contacts. This exact-username lookup
   * (Business Discovery, Business/Creator accounts only) is best effort; found = false means "tag as typed".
   */
  lookupInstagram: rateLimited(scoped("posts:read"), "publish")
    .meta({ openapi: { method: "GET", path: "/mentions/instagram/lookup", summary: "Look up an exact Instagram username (Business/Creator accounts; cached 24 h)", protect: true } })
    .input(LookupInstagramUserInputSchema)
    .output(InstagramUserLookupSchema)
    .query(({ ctx, input }) => lookupInstagramUser(ctx.dbUserId, input)),

  delete: scoped("posts:write")
    .meta({ openapi: { method: "DELETE", path: "/mentions/{id}", summary: "Delete a saved mention contact", protect: true } })
    .input(MentionIdInputSchema)
    .output(UpdatedMentionSchema)
    .mutation(({ ctx, input }) => deleteMentionContact(ctx.dbUserId, input.id)),
});