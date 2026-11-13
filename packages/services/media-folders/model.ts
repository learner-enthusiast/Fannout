import { z } from "zod";
import {
  MediaStatusSchema,
  MediaTypeSchema,
  OrientationSchema,
  SearchQuerySchema,
} from "../media/model";
import { PaginationInputSchema, paginatedOutput } from "../common/pagination";
import { FolderRoleSchema } from "./roles";

export { FOLDER_ROLES, FolderRoleSchema, ROLE_MEDIA_TYPE, type FolderRole } from "./roles";

export const FolderNameSchema = z.string().trim().min(1).max(120);
const DescriptionSchema = z.string().trim().max(2000);
const LabelSchema = z.string().trim().min(1).max(100);

export const FolderItemInputSchema = z.object({
  mediaId: z.uuid().describe("Media ID to put in the folder; its type must fit the role."),
  role: FolderRoleSchema.describe("What the media is for in this folder."),
  /** Required when role = other. */
  label: LabelSchema.nullish().describe("Free-text label (1–100 chars); required when role is other."),
  isPrimary: z.boolean().optional().describe("Mark as the primary item of its role (e.g. the main thumbnail)."),
});
export type FolderItemInput = z.infer<typeof FolderItemInputSchema>;

export const CreateFolderInputSchema = z.object({
  name: FolderNameSchema.describe("Folder name (1–120 chars)."),
  description: DescriptionSchema.nullish().describe("Optional notes (max 2000 chars)."),
  items: z.array(FolderItemInputSchema).max(100).optional().describe("Media to add right away."),
});
export type CreateFolderInput = z.infer<typeof CreateFolderInputSchema>;

export const UpdateFolderInputSchema = z.object({
  folderId: z.uuid().describe("Folder ID."),
  name: FolderNameSchema.optional().describe("New name (1–120 chars)."),
  description: DescriptionSchema.nullable().optional().describe("New notes; null clears them."),
  coverMediaId: z.uuid().nullable().optional().describe("Image media to use as the cover; null falls back to the primary thumbnail."),
});
export type UpdateFolderInput = z.infer<typeof UpdateFolderInputSchema>;

export const FolderIdInputSchema = z.object({ folderId: z.uuid().describe("Folder ID.") });

export const ListFoldersInputSchema = PaginationInputSchema.extend({
  q: SearchQuerySchema.optional().describe("Case-insensitive search on the folder name."),
});
export type ListFoldersInput = z.input<typeof ListFoldersInputSchema>;

export const AddItemsInputSchema = z.object({
  folderId: z.uuid().describe("Folder ID."),
  items: z.array(FolderItemInputSchema.omit({ isPrimary: true })).min(1).max(100).describe("Media to add, each with its role."),
});

export const RemoveItemInputSchema = z.object({
  folderId: z.uuid().describe("Folder ID."),
  mediaId: z.uuid().describe("Media ID to remove from the folder (the media itself is kept)."),
});

export const UpdateItemInputSchema = z.object({
  folderId: z.uuid().describe("Folder ID."),
  mediaId: z.uuid().describe("Media ID of the item to change."),
  role: FolderRoleSchema.optional().describe("New role."),
  label: LabelSchema.nullable().optional().describe("New label (required when the role is other)."),
  isPrimary: z.boolean().optional().describe("Make this the primary item of its role."),
  /** 0-based position within the item's role. */
  position: z.number().int().min(0).optional().describe("0-based position within the item's role."),
});
export type UpdateItemInput = z.infer<typeof UpdateItemInputSchema>;

export const ReorderInputSchema = z.object({
  folderId: z.uuid().describe("Folder ID."),
  role: FolderRoleSchema.describe("Role whose items are reordered."),
  mediaIds: z.array(z.uuid()).min(1).max(200).describe("Media IDs of that role in the new order."),
});

export const FromSuggestionInputSchema = z.object({
  jsonMediaId: z.uuid().describe("ID of a social-package JSON media that has a folderSuggestion."),
  name: FolderNameSchema.optional().describe("Folder name; defaults to the suggested name."),
});

export const FolderSummarySchema = z.object({
  id: z.uuid().describe("Folder ID."),
  name: z.string().describe("Folder name."),
  description: z.string().nullable().describe("Folder notes."),
  itemCount: z.number().int().nonnegative().describe("Number of media items in the folder."),
  /** Cover image (or the primary thumbnail when no cover is set). */
  coverUrl: z.string().nullable().describe("Presigned cover image URL (the primary thumbnail when no cover is set)."),
  createdAt: z.date().describe("When the folder was created."),
  updatedAt: z.date().describe("When the folder last changed."),
});
export type FolderSummary = z.infer<typeof FolderSummarySchema>;

export const FolderPageSchema = paginatedOutput(FolderSummarySchema);

export const FolderItemViewSchema = z.object({
  mediaId: z.uuid().describe("Media ID."),
  role: FolderRoleSchema.describe("Role of the media in this folder."),
  label: z.string().nullable().describe("Label (set when role is other)."),
  position: z.number().int().describe("0-based position within the role."),
  isPrimary: z.boolean().describe("Whether this is the primary item of its role."),
  media: z.object({
    id: z.uuid().describe("Media ID."),
    name: z.string().describe("Display name."),
    type: MediaTypeSchema.describe("Kind of media."),
    status: MediaStatusSchema.describe("Processing state."),
    orientation: OrientationSchema.nullable().describe("Derived from width and height."),
    durationSeconds: z.number().nullable().describe("Duration in seconds (videos and subtitles)."),
    width: z.number().nullable().describe("Pixel width."),
    height: z.number().nullable().describe("Pixel height."),
    previewUrl: z.string().nullable().describe("Short-lived presigned URL for previewing the media."),
    thumbUrl: z.string().nullable().describe("Short-lived presigned URL of a small (≤ 320 px) JPEG thumbnail; null when none exists. Prefer it over previewUrl in grids."),
  }).describe("The media item."),
});
export type FolderItemView = z.infer<typeof FolderItemViewSchema>;

/** Folder metadata only — items come from the paginated folders.items. */
export const FolderDetailSchema = FolderSummarySchema.extend({
  coverMediaId: z.uuid().nullable().describe("Media ID chosen as the cover, if any."),
  /** Items per role (so the page knows which sections to show). */
  roleCounts: z.record(z.string(), z.number().int().nonnegative()).describe("Number of items per role, keyed by role."),
});
export type FolderDetail = z.infer<typeof FolderDetailSchema>;

/** Folder items, ordered by role (FOLDER_ROLES order) → position → id. */
export const FolderItemsInputSchema = PaginationInputSchema.extend({
  folderId: z.uuid().describe("Folder ID."),
  role: FolderRoleSchema.optional().describe("Only items with this role."),
});
export type FolderItemsInput = z.input<typeof FolderItemsInputSchema>;

export const FolderItemPageSchema = paginatedOutput(FolderItemViewSchema);
