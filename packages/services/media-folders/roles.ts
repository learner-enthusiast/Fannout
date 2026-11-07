import { z } from "zod";

/** Where a media item sits in a folder. Order here = display order of sections. */
export const FOLDER_ROLES = [
  "main_landscape",
  "main_portrait",
  "trailer_landscape",
  "trailer_portrait",
  "thumbnail",
  "subtitles",
  "social_json",
  "other",
] as const;

export const FolderRoleSchema = z.enum(FOLDER_ROLES);
export type FolderRole = z.infer<typeof FolderRoleSchema>;

/** Media type each role accepts; null = any type. */
export const ROLE_MEDIA_TYPE: Record<FolderRole, "video" | "image" | "subtitle" | "json" | null> = {
  main_landscape: "video",
  main_portrait: "video",
  trailer_landscape: "video",
  trailer_portrait: "video",
  thumbnail: "image",
  subtitles: "subtitle",
  social_json: "json",
  other: null,
};
