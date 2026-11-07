import { errors } from "@repo/errors";
import type { MediaType } from "../media/model";
import { ROLE_MEDIA_TYPE, type FolderRole } from "./roles";

/**
 * Pure folder rules (unit-tested). DB code loads rows, then calls these.
 */

export type OwnedMedia = { id: string; userId: string; type: MediaType };
export type Link = {
  mediaId: string;
  role: FolderRole;
  label: string | null;
  position: number;
  isPrimary: boolean;
};

const ROLE_TYPE_LABEL: Record<string, string> = {
  video: "a video",
  image: "an image",
  subtitle: "a subtitle file",
  json: "a JSON file",
};

/** main_* / trailer_* → video, thumbnail → image, subtitles → subtitle, social_json → json, other → any (label required). */
export function assertRoleFits(role: FolderRole, type: MediaType, label?: string | null): void {
  const wanted = ROLE_MEDIA_TYPE[role];
  if (wanted && wanted !== type) {
    errors.badRequest(`The ${role} role needs ${ROLE_TYPE_LABEL[wanted]}`);
  }
  if (role === "other" && !label?.trim()) errors.badRequest("Items with the other role need a label");
}

/** Folder and every media must belong to the user; roles must fit the media types. */
export function validateFolderItems(params: {
  userId: string;
  folderUserId: string | null;
  media: OwnedMedia[];
  items: { mediaId: string; role: FolderRole; label?: string | null }[];
  existingMediaIds?: Iterable<string>;
}): void {
  const { userId, folderUserId, media, items } = params;
  if (folderUserId !== null && folderUserId !== userId) errors.notFound("Folder");

  const byId = new Map(media.map((row) => [row.id, row]));
  const seen = new Set(params.existingMediaIds ?? []);
  for (const item of items) {
    const row = byId.get(item.mediaId);
    if (!row || row.userId !== userId) errors.notFound("Media");
    if (seen.has(item.mediaId)) errors.conflict("That media is already in this folder");
    seen.add(item.mediaId);
    assertRoleFits(item.role, row!.type, item.label);
  }
}

/**
 * Positions and primaries for new links: each goes to the end of its role;
 * the first item in an empty role becomes primary; an explicit isPrimary
 * takes over the role. Returns the new links and the roles whose existing
 * primary must be cleared first (one primary per role).
 */
export function planAdditions(
  existing: Link[],
  additions: { mediaId: string; role: FolderRole; label?: string | null; isPrimary?: boolean }[],
): { inserts: Link[]; clearPrimaryRoles: FolderRole[] } {
  const all: Link[] = existing.map((link) => ({ ...link }));
  const inserts: Link[] = [];
  const clear = new Set<FolderRole>();

  for (const addition of additions) {
    const inRole = all.filter((link) => link.role === addition.role);
    const position = inRole.length ? Math.max(...inRole.map((link) => link.position)) + 1 : 0;
    let isPrimary = !inRole.some((link) => link.isPrimary);
    if (addition.isPrimary) {
      for (const link of inRole) {
        if (link.isPrimary && existing.some((e) => e.mediaId === link.mediaId)) clear.add(addition.role);
        link.isPrimary = false;
      }
      isPrimary = true;
    } else if (addition.isPrimary === false) {
      isPrimary = false;
    }
    const link: Link = {
      mediaId: addition.mediaId,
      role: addition.role,
      label: addition.label?.trim() || null,
      position,
      isPrimary,
    };
    all.push(link);
    inserts.push(link);
  }
  // Earlier inserts may have lost primary to a later explicit one.
  for (const insert of inserts) {
    const current = all.find((link) => link.mediaId === insert.mediaId);
    if (current) insert.isPrimary = current.isPrimary;
  }
  return { inserts, clearPrimaryRoles: [...clear] };
}

/** Lowercase keyword guess for a role, used to pre-fill pickers. */
export function guessRole(media: {
  type: MediaType;
  orientation?: "portrait" | "landscape" | "square" | null;
  name?: string | null;
  originalFilename?: string | null;
}): FolderRole {
  const text = `${media.name ?? ""} ${media.originalFilename ?? ""}`.toLowerCase();
  if (media.type === "image") return "thumbnail";
  if (media.type === "subtitle") return "subtitles";
  if (media.type === "json") return "social_json";
  if (media.type !== "video") return "other";
  const portrait = media.orientation === "portrait" || /9x16|vertical|portrait|short|reel/.test(text);
  const trailer = /trailer|teaser|promo|clip/.test(text);
  if (trailer) return portrait ? "trailer_portrait" : "trailer_landscape";
  return portrait ? "main_portrait" : "main_landscape";
}
