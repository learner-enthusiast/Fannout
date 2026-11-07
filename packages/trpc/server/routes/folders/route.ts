import {
  addFolderItems,
  createFolder,
  createFolderFromSuggestion,
  deleteFolder,
  getFolder,
  listFolderItems,
  listFolders,
  removeFolderItem,
  reorderFolderRole,
  updateFolder,
  updateFolderItem,
} from "@repo/services/media-folders";
import {
  AddItemsInputSchema,
  CreateFolderInputSchema,
  FolderDetailSchema,
  FolderIdInputSchema,
  FolderItemPageSchema,
  FolderItemsInputSchema,
  FolderPageSchema,
  FromSuggestionInputSchema,
  ListFoldersInputSchema,
  RemoveItemInputSchema,
  ReorderInputSchema,
  UpdateFolderInputSchema,
  UpdateItemInputSchema,
} from "@repo/services/media-folders/model";
import { z } from "zod";
import { router, scoped } from "../../trpc";

export const foldersRouter = router({
  create: scoped("media:write")
    .meta({ openapi: { method: "POST", path: "/folders", summary: "Create a folder", protect: true } })
    .input(CreateFolderInputSchema)
    .output(FolderDetailSchema)
    .mutation(({ ctx, input }) => createFolder(ctx.dbUserId, input)),

  update: scoped("media:write")
    .meta({ openapi: { method: "PATCH", path: "/folders/{folderId}", summary: "Update a folder", protect: true } })
    .input(UpdateFolderInputSchema)
    .output(FolderDetailSchema)
    .mutation(({ ctx, input }) => updateFolder(ctx.dbUserId, input)),

  /** Deletes the folder and its links; the media stays in the library. */
  delete: scoped("media:write")
    .meta({ openapi: { method: "DELETE", path: "/folders/{folderId}", summary: "Delete a folder (media stays in the library)", protect: true } })
    .input(FolderIdInputSchema)
    .output(z.object({ deleted: z.literal(true).describe("Always true; media in the folder stays in the library (idempotent).") }))
    .mutation(async ({ ctx, input }) => {
      await deleteFolder(ctx.dbUserId, input.folderId);
      return { deleted: true as const };
    }),

  list: scoped("media:read")
    .meta({ openapi: { method: "GET", path: "/folders", summary: "List folders", protect: true } })
    .input(ListFoldersInputSchema)
    .output(FolderPageSchema)
    .query(({ ctx, input }) => listFolders(ctx.dbUserId, input)),

  get: scoped("media:read")
    .meta({ openapi: { method: "GET", path: "/folders/{folderId}", summary: "Get a folder's details", protect: true } })
    .input(FolderIdInputSchema)
    .output(FolderDetailSchema)
    .query(({ ctx, input }) => getFolder(ctx.dbUserId, input.folderId)),

  /** A folder's items, 10 at a time (role → position). folders.get is metadata only. */
  items: scoped("media:read")
    .meta({ openapi: { method: "GET", path: "/folders/{folderId}/items", summary: "List a folder's items", protect: true } })
    .input(FolderItemsInputSchema)
    .output(FolderItemPageSchema)
    .query(({ ctx, input }) => listFolderItems(ctx.dbUserId, input)),

  addItems: scoped("media:write")
    .meta({ openapi: { method: "POST", path: "/folders/{folderId}/items", summary: "Add media to a folder", protect: true } })
    .input(AddItemsInputSchema)
    .output(FolderDetailSchema)
    .mutation(({ ctx, input }) => addFolderItems(ctx.dbUserId, input)),

  removeItem: scoped("media:write")
    .meta({ openapi: { method: "DELETE", path: "/folders/{folderId}/items/{mediaId}", summary: "Remove media from a folder", protect: true } })
    .input(RemoveItemInputSchema)
    .output(FolderDetailSchema)
    .mutation(({ ctx, input }) => removeFolderItem(ctx.dbUserId, input)),

  updateItem: scoped("media:write")
    .meta({ openapi: { method: "PATCH", path: "/folders/{folderId}/items/{mediaId}", summary: "Change a folder item's role, label, primary flag or position", protect: true } })
    .input(UpdateItemInputSchema)
    .output(FolderDetailSchema)
    .mutation(({ ctx, input }) => updateFolderItem(ctx.dbUserId, input)),

  /** Sets the order of one role's items. */
  reorder: scoped("media:write")
    .meta({ openapi: { method: "PUT", path: "/folders/{folderId}/order", summary: "Reorder a role's items in a folder", protect: true } })
    .input(ReorderInputSchema)
    .output(FolderDetailSchema)
    .mutation(({ ctx, input }) => reorderFolderRole(ctx.dbUserId, input)),

  /** Creates a folder from a social-package JSON's stored suggestion. */
  fromSuggestion: scoped("media:write")
    .meta({ openapi: { method: "POST", path: "/folders/from-suggestion", summary: "Create a folder from a social JSON's suggestion", protect: true } })
    .input(FromSuggestionInputSchema)
    .output(FolderDetailSchema)
    .mutation(({ ctx, input }) => createFolderFromSuggestion(ctx.dbUserId, input)),
});
