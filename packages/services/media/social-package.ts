import { z } from "zod";
import type { FolderRole } from "../media-folders/roles";
import { ROLE_MEDIA_TYPE } from "../media-folders/roles";
import type { FolderSuggestion, MediaType } from "./model";

/**
 * "Social package" JSON: one video's copy for every platform plus the files
 * that belong to it. Shape (fixture: test/fixtures/graphql-vs-rest_social.json):
 * { video, files{main, main_portrait, trailer_landscape, trailer_portrait,
 *   subtitles, thumbnail}, linkedin, x, instagram, facebook, threads, youtube }
 */
const FileRefSchema = z.union([z.string().trim().min(1), z.array(z.string().trim().min(1))]);

export const PACKAGE_FILE_ROLES = {
  main: "main_landscape",
  main_portrait: "main_portrait",
  trailer_landscape: "trailer_landscape",
  trailer_portrait: "trailer_portrait",
  subtitles: "subtitles",
  thumbnail: "thumbnail",
} as const satisfies Record<string, FolderRole>;

type PackageFileKey = keyof typeof PACKAGE_FILE_ROLES;

const PLATFORMS = ["linkedin", "x", "instagram", "facebook", "threads", "youtube"] as const;

export const SocialPackageSchema = z.looseObject({
  video: z.string().trim().min(1),
  files: z.looseObject(
    Object.fromEntries(
      Object.keys(PACKAGE_FILE_ROLES).map((key) => [key, FileRefSchema.optional()]),
    ) as Record<PackageFileKey, z.ZodOptional<typeof FileRefSchema>>,
  ),
});
export type SocialPackage = z.infer<typeof SocialPackageSchema>;

/** True when the parsed JSON has the social-package shape (video, files, all platforms). */
export function parseSocialPackage(json: unknown): SocialPackage | null {
  const parsed = SocialPackageSchema.safeParse(json);
  if (!parsed.success) return null;
  const record = json as Record<string, unknown>;
  if (!PLATFORMS.every((platform) => platform in record)) return null;
  const hasFile = Object.keys(PACKAGE_FILE_ROLES).some((key) => parsed.data.files[key as PackageFileKey]);
  return hasFile ? parsed.data : null;
}

/** "assets/My Clip.MP4" or a URL → "my clip.mp4". */
export function fileKey(ref: string): string {
  const path = ref.split(/[?#]/)[0] ?? ref;
  return decodeURIComponent(path.replace(/^.*[\\/]/, "")).trim().toLowerCase();
}

export type SuggestionCandidate = {
  id: string;
  originalFilename: string | null;
  type: MediaType;
  createdAt: Date;
};

/**
 * Maps the package's files.* filenames to the user's uploads (by original
 * filename, case-insensitive; newest wins) and adds the JSON itself as
 * social_json. Pure — the caller loads candidates and stores the result.
 */
export function buildFolderSuggestion(
  pkg: SocialPackage,
  jsonMediaId: string,
  candidates: SuggestionCandidate[],
): FolderSuggestion {
  const byName = new Map<string, SuggestionCandidate[]>();
  for (const candidate of [...candidates].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    if (!candidate.originalFilename || candidate.id === jsonMediaId) continue;
    const key = fileKey(candidate.originalFilename);
    byName.set(key, [...(byName.get(key) ?? []), candidate]);
  }

  const used = new Set<string>([jsonMediaId]);
  const items: FolderSuggestion["items"] = [];
  for (const [fileField, role] of Object.entries(PACKAGE_FILE_ROLES) as [PackageFileKey, FolderRole][]) {
    const refs = pkg.files[fileField];
    for (const ref of Array.isArray(refs) ? refs : refs ? [refs] : []) {
      const wanted = ROLE_MEDIA_TYPE[role];
      const match = (byName.get(fileKey(ref)) ?? []).find(
        (candidate) => !used.has(candidate.id) && (!wanted || candidate.type === wanted),
      );
      if (!match) continue;
      used.add(match.id);
      items.push({ mediaId: match.id, role });
    }
  }
  items.push({ mediaId: jsonMediaId, role: "social_json" });
  return { folderName: pkg.video.trim().slice(0, 200), items };
}

/** Every filename the package references (for the candidate lookup). */
export function packageFileNames(pkg: SocialPackage): string[] {
  return Object.keys(PACKAGE_FILE_ROLES).flatMap((key) => {
    const refs = pkg.files[key as PackageFileKey];
    return (Array.isArray(refs) ? refs : refs ? [refs] : []).map(fileKey);
  });
}
