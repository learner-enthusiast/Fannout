import {
  describeCount,
  fieldSpecsFor,
  hashtagCountFor,
  LENGTH_TARGETS,
  postTypeFor,
  resolveTarget,
  type PlaybookTargets,
  type PostType,
  type ResolvedTarget,
} from "@repo/ai/prompts/length-targets-api";
import { readComposeMeta } from "@repo/providers";
import type { z } from "zod";
import { PLATFORMS, type Platform } from "../publishing/platforms";

/**
 * Compose field (platform model.ts) → the length-targets entry that governs it.
 * The compose model's own limit and count mode always win over the table.
 */
const TARGET_FIELD: Record<Platform, Record<string, string>> = {
  youtube: { title: "title", description: "description", tags: "tags", communityText: "community_post" },
  linkedin: { commentary: "post" },
  instagram: { caption: "caption", altText: "altText" },
  facebook: { message: "post", title: "title" },
  x: { text: "post" },
  threads: { text: "post" },
};

/** The compose field holding the post's main text (hashtags are appended to it). */
export const MAIN_TEXT_FIELD: Record<Platform, string> = {
  youtube: "description",
  linkedin: "commentary",
  instagram: "caption",
  facebook: "message",
  x: "text",
  threads: "text",
};

export function targetFieldName(platform: Platform, postType: PostType, composeField: string): string | null {
  const name = TARGET_FIELD[platform][composeField];
  if (!name) return null;
  if (platform === "youtube" && postType === "short" && (name === "title" || name === "description")) return `shorts_${name}`;
  return name;
}

function modelLimit(platform: Platform, composeField: string) {
  const schema = (PLATFORMS[platform].schema.shape as Record<string, z.ZodType>)[composeField];
  const meta = schema ? readComposeMeta(schema) : undefined;
  return meta ? { limit: meta.maxLength, unit: meta.countMode ?? ("chars" as const) } : null;
}

/** Band + limit for one compose field, or null when AI has no target for it on this post type. */
export function aiBandFor(platform: Platform, postType: PostType, composeField: string): ResolvedTarget | null {
  if (postTypeFor(platform, postType) !== postType) return null;
  const name = targetFieldName(platform, postType, composeField);
  const spec = name ? fieldSpecsFor(platform, postType)[name] : undefined;
  const model = modelLimit(platform, composeField);
  if (!spec || !model) return null;
  return resolveTarget(spec, model);
}

/** Everything a playbook interpolates, keyed by the length-targets field names. */
export function playbookTargets(platform: Platform, postType: PostType): PlaybookTargets {
  const fields: Record<string, ResolvedTarget> = {};
  for (const composeField of Object.keys(TARGET_FIELD[platform])) {
    const name = targetFieldName(platform, postType, composeField);
    const band = aiBandFor(platform, postType, composeField);
    if (name && band) fields[name] = band;
  }
  const visible = LENGTH_TARGETS[platform].visible;
  return { fields, hashtags: describeCount(hashtagCountFor(platform, postType)), visibleChars: visible?.chars };
}
