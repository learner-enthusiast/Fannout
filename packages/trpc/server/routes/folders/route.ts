import {
  addFolderItems,
  createFolder,
  createFolderFromSuggestion,
  deleteFolder,
  getFolder,
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
  FolderPageSchema,
  FromSuggestionInputSchema,
  ListFoldersInputSchema,
  RemoveItemInputSchema,
  ReorderInputSchema,
  UpdateFolderInputSchema,
  UpdateItemInputSchema,
} from "@repo/services/media-folders/model";
import { z } from "zod";
import { protectedProcedure, router } from "../../trpc";

export const foldersRouter = router({
  create: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/folders", protect: true } })
    .input(CreateFolderInputSchema)
    .output(FolderDetailSchema)
    .mutation(({ ctx, input }) => createFolder(ctx.dbUserId, input)),

  update: protectedProcedure
    .meta({ openapi: { method: "PATCH", path: "/folders/{folderId}", protect: true } })
    .input(UpdateFolderInputSchema)
    .output(FolderDetailSchema)
    .mutation(({ ctx, input }) => updateFolder(ctx.dbUserId, input)),

  /** Deletes the folder and its links; the media stays in the library. */
  delete: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: "/folders/{folderId}", protect: true } })
    .input(FolderIdInputSchema)
    .output(z.object({ deleted: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      await deleteFolder(ctx.dbUserId, input.folderId);
      return { deleted: true as const };
    }),

  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/folders", protect: true } })
    .input(ListFoldersInputSchema)
    .output(FolderPageSchema)
    .query(({ ctx, input }) => listFolders(ctx.dbUserId, input)),

  get: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/folders/{folderId}", protect: true } })
    .input(FolderIdInputSchema)
    .output(FolderDetailSchema)
    .query(({ ctx, input }) => getFolder(ctx.dbUserId, input.folderId)),

  addItems: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/folders/{folderId}/items", protect: true } })
    .input(AddItemsInputSchema)
    .output(FolderDetailSchema)
    .mutation(({ ctx, input }) => addFolderItems(ctx.dbUserId, input)),

  removeItem: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: "/folders/{folderId}/items/{mediaId}", protect: true } })
    .input(RemoveItemInputSchema)
    .output(FolderDetailSchema)
    .mutation(({ ctx, input }) => removeFolderItem(ctx.dbUserId, input)),

  updateItem: protectedProcedure
    .meta({ openapi: { method: "PATCH", path: "/folders/{folderId}/items/{mediaId}", protect: true } })
    .input(UpdateItemInputSchema)
    .output(FolderDetailSchema)
    .mutation(({ ctx, input }) => updateFolderItem(ctx.dbUserId, input)),

  /** Sets the order of one role's items. */
  reorder: protectedProcedure
    .meta({ openapi: { method: "PUT", path: "/folders/{folderId}/order", protect: true } })
    .input(ReorderInputSchema)
    .output(FolderDetailSchema)
    .mutation(({ ctx, input }) => reorderFolderRole(ctx.dbUserId, input)),

  /** Creates a folder from a social-package JSON's stored suggestion. */
  fromSuggestion: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/folders/from-suggestion", protect: true } })
    .input(FromSuggestionInputSchema)
    .output(FolderDetailSchema)
    .mutation(({ ctx, input }) => createFolderFromSuggestion(ctx.dbUserId, input)),
});
