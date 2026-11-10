import { z } from "zod";
import { PaginationInputSchema, paginatedOutput } from "../common/pagination";

export const MentionPlatformSchema = z.enum(["x", "threads", "linkedin", "facebook"]);
export type MentionPlatform = z.infer<typeof MentionPlatformSchema>;

const handle = z.string().trim().regex(/^[A-Za-z0-9_.]+$/, "Use only letters, numbers, underscores and periods").max(100);
const linkedInUrn = z.string().trim().regex(/^urn:li:(person|organization):[^:]+$/, "Use urn:li:person:{id} or urn:li:organization:{id}");
const facebookPageId = z.string().trim().regex(/^\d+$/, "Use the numeric Facebook Page ID");

export const MentionContactViewSchema = z.object({
  id: z.uuid(),
  platform: MentionPlatformSchema,
  displayName: z.string(),
  handle: z.string().nullable(),
  platformRef: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  useCount: z.number().int().nonnegative(),
  lastUsedAt: z.date().nullable(),
  createdAt: z.date(),
});
export type MentionContactView = z.infer<typeof MentionContactViewSchema>;

export const MentionContactPageSchema = paginatedOutput(MentionContactViewSchema);

export const SearchMentionsInputSchema = PaginationInputSchema.extend({
  platform: MentionPlatformSchema.describe("Platform whose contacts to search."),
  q: z.string().trim().max(100).default("").describe("Case-insensitive display-name/handle search; empty returns most-used contacts."),
});

/** OpenAPI input (no refinements: trpc-to-openapi can't omit fields from refined objects). */
export const CreateMentionInputBaseSchema = z.object({
  platform: MentionPlatformSchema.describe("Platform this contact is for."),
  displayName: z.string().trim().min(1).max(200).describe("Label shown in the composer; must match LinkedIn exactly for LinkedIn mentions."),
  handle: handle.optional().describe("X/Threads username without @; letters, numbers, underscores and periods."),
  platformRef: z.string().trim().max(300).optional().describe("LinkedIn person/organization URN or numeric Facebook Page ID."),
  avatarUrl: z.url().optional().describe("Optional avatar URL for the contact list."),
});

function refineCreateMention(value: z.infer<typeof CreateMentionInputBaseSchema>, ctx: z.RefinementCtx) {
  if ((value.platform === "x" || value.platform === "threads") && !value.handle) {
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
  id: z.uuid(),
  displayName: z.string().trim().min(1).max(200).optional(),
  handle: handle.nullish(),
  platformRef: z.string().trim().max(300).nullish(),
  avatarUrl: z.url().nullish(),
});
export type UpdateMentionInput = z.input<typeof UpdateMentionInputSchema>;

export const MentionIdInputSchema = z.object({ id: z.uuid() });
export const UpdatedMentionSchema = z.object({ updated: z.boolean() });