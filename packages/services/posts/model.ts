import { z } from "zod";
import { MediaRowSchema } from "../media/model";

export const PostStatusSchema = z.enum(["draft", "scheduled", "publishing", "published", "failed"]);
export type PostStatus = z.infer<typeof PostStatusSchema>;

export const PostRowSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  socialConnectionId: z.uuid(),
  caption: z.string().nullable(),
  config: z.record(z.string(), z.unknown()).nullable(),
  status: PostStatusSchema,
  externalPostId: z.string().nullable(),
  postUrl: z.string().nullable(),
  postMediaId: z.uuid().nullable(),
  publishedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type PostRow = z.infer<typeof PostRowSchema>;

export const PostMediaItemSchema = z.object({
  id: z.uuid(),
  role: z.string(),
  position: z.number().int(),
  media: MediaRowSchema,
});

export const PostWithMediaSchema = PostRowSchema.extend({
  media: z.array(PostMediaItemSchema),
});

export type PostWithMedia = z.infer<typeof PostWithMediaSchema>;

export const CreatePostInputSchema = z.object({
  userId: z.uuid(),
  socialConnectionId: z.uuid(),
  caption: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  status: PostStatusSchema.optional(),
});

export type CreatePostInput = z.input<typeof CreatePostInputSchema>;

export const UpdatePostInputSchema = z
  .object({
    socialConnectionId: z.uuid(),
    caption: z.string().nullable(),
    config: z.record(z.string(), z.unknown()).nullable(),
    status: PostStatusSchema,
    postMediaId: z.uuid().nullable(),
  })
  .partial();

export type UpdatePostInput = z.input<typeof UpdatePostInputSchema>;

export const MarkPostPublishedInputSchema = z.object({
  externalPostId: z.string().min(1),
  postUrl: z.string().nullable().optional(),
  publishedAt: z.coerce.date().optional(),
});

export type MarkPostPublishedInput = z.input<typeof MarkPostPublishedInputSchema>;

export const ListPostsInputSchema = z.object({
  status: PostStatusSchema.optional(),
  socialConnectionId: z.uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export type ListPostsInput = z.input<typeof ListPostsInputSchema>;
