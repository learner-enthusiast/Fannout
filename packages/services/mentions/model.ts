import { z } from "zod";
import { PaginationInputSchema, paginatedOutput } from "../common/pagination";

export const MentionPlatformSchema = z.enum(["x", "threads", "instagram", "linkedin", "facebook"]);
export type MentionPlatform = z.infer<typeof MentionPlatformSchema>;

const handle = z.string().trim().regex(/^[A-Za-z0-9_.]+$/, "Use only letters, numbers, underscores and periods").max(100);
const linkedInUrn = z.string().trim().regex(/^urn:li:(person|organization):[^:]+$/, "Use urn:li:person:{id} or urn:li:organization:{id}");
const facebookPageId = z.string().trim().regex(/^\d+$/, "Use the numeric Facebook Page ID");

export const MentionContactViewSchema = z.object({
  id: z.uuid().describe("Mention contact ID."),
  platform: MentionPlatformSchema.describe("Platform the contact belongs to."),
  displayName: z.string().describe("Label shown in the composer."),
  handle: z.string().nullable().describe("X/Threads/Instagram username without @."),
  platformRef: z.string().nullable().describe("LinkedIn URN, numeric Facebook Page ID, or (X) the account's numeric user ID once it was resolved for tagging."),
  avatarUrl: z.string().nullable().describe("Optional avatar URL."),
  useCount: z.number().int().nonnegative().describe("Times this contact was used in a published post."),
  lastUsedAt: z.date().nullable().describe("When the contact was last used in a published post."),
  createdAt: z.date().describe("When the contact was created."),
});
export type MentionContactView = z.infer<typeof MentionContactViewSchema>;

export const MentionContactPageSchema = paginatedOutput(MentionContactViewSchema);

export const SearchMentionsInputSchema = PaginationInputSchema.extend({
  platform: MentionPlatformSchema.describe("Platform whose contacts to search."),
  q: z.string().trim().max(100).transform((value) => value.replace(/^@/, "")).default("").describe("Case-insensitive prefix of the handle or display name (a leading @ is ignored); empty returns the most-used, then most recently used, contacts."),
});

/** OpenAPI input (no refinements: trpc-to-openapi can't omit fields from refined objects). */
export const CreateMentionInputBaseSchema = z.object({
  platform: MentionPlatformSchema.describe("Platform this contact is for."),
  displayName: z.string().trim().min(1).max(200).describe("Label shown in the composer; must match LinkedIn exactly for LinkedIn mentions."),
  handle: handle.optional().describe("X/Threads/Instagram username without @; letters, numbers, underscores and periods."),
  platformRef: z.string().trim().max(300).optional().describe("LinkedIn person/organization URN or numeric Facebook Page ID."),
  avatarUrl: z.url().optional().describe("Optional avatar URL for the contact list."),
});

function refineCreateMention(value: z.infer<typeof CreateMentionInputBaseSchema>, ctx: z.RefinementCtx) {
  if ((value.platform === "x" || value.platform === "threads" || value.platform === "instagram") && !value.handle) {
    ctx.addIssue({ code: "custom", path: ["handle"], message: "A handle is required for this platform" });
  }
  if (value.platform === "linkedin" && !linkedInUrn.safeParse(value.platformRef).success) {
    ctx.addIssue({ code: "custom", path: ["platformRef"], message: "Use urn:li:person:{id} or urn:li:organization:{id}" });
  }
  if (value.platform === "facebook" && !facebookPageId.safeParse(value.platformRef).success) {
    ctx.addIssue({ code: "custom", path: ["platformRef"], message: "Use the numeric Facebook Page ID" });
  }
}

export const CreateMentionInputSchema = CreateMentionInputBaseSchema.superRefine(refineCreateMention);
export type CreateMentionInput = z.input<typeof CreateMentionInputSchema>;

export const UpdateMentionInputSchema = z.object({
  id: z.uuid().describe("Mention contact ID."),
  displayName: z.string().trim().min(1).max(200).optional().describe("New label."),
  handle: handle.nullish().describe("New X/Threads/Instagram username without @; null clears it."),
  platformRef: z.string().trim().max(300).nullish().describe("New LinkedIn URN or numeric Facebook Page ID; null clears it."),
  avatarUrl: z.url().nullish().describe("New avatar URL; null clears it."),
});
export type UpdateMentionInput = z.input<typeof UpdateMentionInputSchema>;

export const MentionIdInputSchema = z.object({ id: z.uuid().describe("Mention contact ID.") });
export const UpdatedMentionSchema = z.object({ updated: z.boolean().describe("Whether a contact was changed.") });

export const ResolveXUserInputSchema = z.object({
  socialConnectionId: z.uuid().describe("A connected X account (the lookup runs in its user context)."),
  username: z.string().trim().regex(/^@?[A-Za-z0-9_]{1,15}$/, "X usernames are 1–15 letters, numbers or underscores").transform((value) => value.replace(/^@/, "")).describe("X username, with or without @."),
});
export const ResolvedXUserSchema = z.object({
  username: z.string().describe("Username as X spells it."),
  xUserId: z.string().describe("Numeric X user ID to put in taggedUsers."),
  displayName: z.string().describe("Account name."),
});
export type ResolvedXUser = z.infer<typeof ResolvedXUserSchema>;

/** Instagram usernames: 1–30 letters, numbers, periods and underscores. */
export const INSTAGRAM_HANDLE_PATTERN = /^[A-Za-z0-9_.]{1,30}$/;

export const LookupInstagramUserInputSchema = z.object({
  socialConnectionId: z.uuid().describe("A connected Instagram account; the lookup runs through its Business Discovery field."),
  username: z
    .string()
    .trim()
    .regex(/^@?[A-Za-z0-9_.]{1,30}$/, "Instagram usernames are 1–30 letters, numbers, periods or underscores")
    .transform((value) => value.replace(/^@/, "").toLowerCase())
    .describe("Full Instagram username, with or without @."),
});
export const InstagramUserLookupSchema = z.object({
  found: z.boolean().describe("Whether Instagram returned a profile. False for personal accounts, unknown usernames or when the lookup isn't available; tag the username as typed instead."),
  username: z.string().describe("Username as typed (found = false) or as Instagram spells it."),
  displayName: z.string().nullable().describe("Account name, when found."),
  avatarUrl: z.string().nullable().describe("Profile picture URL, when found (Instagram CDN, expires)."),
});
export type InstagramUserLookup = z.infer<typeof InstagramUserLookupSchema>;
