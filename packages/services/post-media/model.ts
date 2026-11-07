import { z } from "zod";
import { MediaRowSchema } from "../media/model";

/** primary/attachment (existing) + video/image (composer batches); thumbnail is shared. */
export const PostMediaRoleSchema = z.enum(["primary", "thumbnail", "attachment", "video", "image"]);
export type PostMediaRole = z.infer<typeof PostMediaRoleSchema>;

export const PostMediaRowSchema = z.object({
  id: z.uuid(),
  postId: z.uuid(),
  mediaId: z.uuid(),
  role: PostMediaRoleSchema,
  position: z.number().int().nonnegative(),
  createdAt: z.date(),
});

export type PostMediaRow = z.infer<typeof PostMediaRowSchema>;

export const PostMediaWithMediaSchema = PostMediaRowSchema.extend({
  media: MediaRowSchema,
});

export type PostMediaWithMedia = z.infer<typeof PostMediaWithMediaSchema>;

export const AddPostMediaInputSchema = z.object({
  postId: z.uuid(),
  mediaId: z.uuid(),
  role: PostMediaRoleSchema.optional(),
  position: z.number().int().nonnegative().optional(),
});

export type AddPostMediaInput = z.input<typeof AddPostMediaInputSchema>;

export const UpdatePostMediaInputSchema = z
  .object({
    role: PostMediaRoleSchema,
    position: z.number().int().nonnegative(),
  })
  .partial();

export type UpdatePostMediaInput = z.input<typeof UpdatePostMediaInputSchema>;

export const ReorderPostMediaInputSchema = z.object({
  postId: z.uuid(),
  /** post_media ids in their new order; position = array index. */
  orderedIds: z.array(z.uuid()).min(1),
});

export type ReorderPostMediaInput = z.input<typeof ReorderPostMediaInputSchema>;
