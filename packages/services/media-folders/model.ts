import { z } from "zod";
import {
  MediaStatusSchema,
  MediaTypeSchema,
  OrientationSchema,
  SearchQuerySchema,
} from "../media/model";
import { FolderRoleSchema } from "./roles";

export { FOLDER_ROLES, FolderRoleSchema, ROLE_MEDIA_TYPE, type FolderRole } from "./roles";

export const FolderNameSchema = z.string().trim().min(1).max(120);
const DescriptionSchema = z.string().trim().max(2000);
const LabelSchema = z.string().trim().min(1).max(100);

export const FolderItemInputSchema = z.object({
  mediaId: z.uuid(),
  role: FolderRoleSchema,
  /** Required when role = other. */
  label: LabelSchema.nullish(),
  isPrimary: z.boolean().optional(),
});
export type FolderItemInput = z.infer<typeof FolderItemInputSchema>;

export const CreateFolderInputSchema = z.object({
  name: FolderNameSchema,
  description: DescriptionSchema.nullish(),
  items: z.array(FolderItemInputSchema).max(100).optional(),
});
export type CreateFolderInput = z.infer<typeof CreateFolderInputSchema>;

export const UpdateFolderInputSchema = z.object({
  folderId: z.uuid(),
  name: FolderNameSchema.optional(),
  description: DescriptionSchema.nullable().optional(),
  coverMediaId: z.uuid().nullable().optional(),
});
export type UpdateFolderInput = z.infer<typeof UpdateFolderInputSchema>;

export const FolderIdInputSchema = z.object({ folderId: z.uuid() });

export const ListFoldersInputSchema = z.object({
  q: SearchQuerySchema.optional(),
  cursor: z.string().min(1).max(200).nullish(),
  limit: z.number().int().min(1).max(50).default(24),
});
export type ListFoldersInput = z.input<typeof ListFoldersInputSchema>;

export const AddItemsInputSchema = z.object({
  folderId: z.uuid(),
  items: z.array(FolderItemInputSchema.omit({ isPrimary: true })).min(1).max(100),
});

export const RemoveItemInputSchema = z.object({ folderId: z.uuid(), mediaId: z.uuid() });

export const UpdateItemInputSchema = z.object({
  folderId: z.uuid(),
  mediaId: z.uuid(),
  role: FolderRoleSchema.optional(),
  label: LabelSchema.nullable().optional(),
  isPrimary: z.boolean().optional(),
  /** 0-based position within the item's role. */
  position: z.number().int().min(0).optional(),
});
export type UpdateItemInput = z.infer<typeof UpdateItemInputSchema>;

export const ReorderInputSchema = z.object({
  folderId: z.uuid(),
  role: FolderRoleSchema,
  mediaIds: z.array(z.uuid()).min(1).max(200),
});

export const FromSuggestionInputSchema = z.object({
  jsonMediaId: z.uuid(),
  name: FolderNameSchema.optional(),
});

export const FolderSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  itemCount: z.number().int().nonnegative(),
  /** Cover image (or the primary thumbnail when no cover is set). */
  coverUrl: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type FolderSummary = z.infer<typeof FolderSummarySchema>;

export const FolderPageSchema = z.object({
  items: z.array(FolderSummarySchema),
  nextCursor: z.string().nullable(),
});

export const FolderItemViewSchema = z.object({
  mediaId: z.uuid(),
  role: FolderRoleSchema,
  label: z.string().nullable(),
  position: z.number().int(),
  isPrimary: z.boolean(),
  media: z.object({
    id: z.uuid(),
    name: z.string(),
    type: MediaTypeSchema,
    status: MediaStatusSchema,
    orientation: OrientationSchema.nullable(),
    durationSeconds: z.number().nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    previewUrl: z.string().nullable(),
  }),
});
export type FolderItemView = z.infer<typeof FolderItemViewSchema>;

export const FolderDetailSchema = FolderSummarySchema.extend({
  coverMediaId: z.uuid().nullable(),
  /** Ordered by role (FOLDER_ROLES order), then position. */
  items: z.array(FolderItemViewSchema),
});
export type FolderDetail = z.infer<typeof FolderDetailSchema>;
