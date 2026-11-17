/**
 * ONE table of length targets per platform and post type. Prompts interpolate
 * these numbers and the validators in services/ai-content read the same
 * entries, so a number is never written twice.
 *
 * `limit` is the platform's documented limit. When the platform's compose
 * model (packages/providers/<platform>/model.ts) defines a different limit or
 * unit, THE MODEL WINS: pass it to `resolveTarget` and the band scales to it.
 */
export type AiPlatform = "youtube" | "linkedin" | "instagram" | "facebook" | "x" | "threads";
export type PostType = "video" | "short" | "image" | "carousel";
export type LengthUnit = "chars" | "weighted" | "bytes";

export const POST_TYPES: PostType[] = ["video", "short", "image", "carousel"];

export type LengthSpec = {
  /** Documented limit; null = "existing" (taken from the compose model). */
  limit: number | null;
  /** Absolute band, or a share of the limit (0–1). */
  band: { min: number; max: number } | { minRatio: number; maxRatio: number };
  unit: LengthUnit;
  /** false = the band is absolute and never scales (very high limits). */
  scale?: boolean;
  /** Only for these post types (default: all the platform supports). */
  postTypes?: PostType[];
  /** Tags: the length counted is the joined list. */
  joined?: boolean;
};

export type CountSpec = { min: number; max: number };

export type PlatformTargets = {
  postTypes: PostType[];
  fields: Record<string, LengthSpec>;
  hashtags: CountSpec;
  /** Post types whose hashtag count differs from `hashtags`. */
  hashtagsByPostType?: Partial<Record<PostType, CountSpec>>;
  /** Characters shown before "more" / in search: this slice must stand alone. */
  visible?: { field: string; chars: number };
};

export const LENGTH_TARGETS: Record<AiPlatform, PlatformTargets> = {
  youtube: {
    postTypes: ["video", "short", "carousel"],
    fields: {
      // Image post published by hand (no API). YouTube documents no limit: the band is ours and easy to edit.
      community_post: { limit: null, band: { min: 600, max: 1200 }, unit: "chars", scale: false, postTypes: ["carousel"] },
      title: { limit: 100, band: { min: 85, max: 100 }, unit: "chars", postTypes: ["video"] },
      shorts_title: { limit: 100, band: { min: 80, max: 100 }, unit: "chars", postTypes: ["short"] },
      description: { limit: 5000, band: { min: 4200, max: 4950 }, unit: "chars", postTypes: ["video"] },
      // Shorts: a few lines + hashtags; only the hard limit applies.
      shorts_description: { limit: 5000, band: { min: 0, max: 4950 }, unit: "chars", postTypes: ["short"] },
      tags: { limit: 500, band: { min: 440, max: 500 }, unit: "chars", joined: true, postTypes: ["video", "short"] },
    },
    hashtags: { min: 3, max: 3 },
    hashtagsByPostType: { carousel: { min: 0, max: 3 } },
    visible: { field: "description", chars: 150 },
  },
  linkedin: {
    postTypes: ["video", "image", "carousel"],
    fields: { post: { limit: 3000, band: { min: 2600, max: 2950 }, unit: "chars" } },
    hashtags: { min: 3, max: 5 },
    visible: { field: "post", chars: 210 },
  },
  instagram: {
    postTypes: ["short", "image", "carousel"],
    fields: {
      caption: { limit: 2200, band: { min: 1850, max: 2150 }, unit: "chars" },
      altText: { limit: null, band: { min: 100, max: 250 }, unit: "chars", scale: false, postTypes: ["image", "carousel"] },
    },
    hashtags: { min: 5, max: 8 },
    visible: { field: "caption", chars: 125 },
  },
  facebook: {
    postTypes: ["video", "short", "image", "carousel"],
    fields: {
      title: { limit: null, band: { minRatio: 0.85, maxRatio: 1 }, unit: "chars", postTypes: ["video", "short"] },
      post: { limit: null, band: { min: 1800, max: 2500 }, unit: "chars", scale: false },
    },
    hashtags: { min: 2, max: 3 },
    visible: { field: "post", chars: 125 },
  },
  x: {
    postTypes: ["video", "image", "carousel"],
    fields: {
      post: { limit: 280, band: { min: 250, max: 280 }, unit: "weighted" },
      // post_long (1500–3000 weighted) and altText (150–400 chars) are added here
      // once the X compose model has those fields.
    },
    hashtags: { min: 1, max: 2 },
  },
  threads: {
    postTypes: ["video", "image", "carousel"],
    fields: { post: { limit: 500, band: { min: 440, max: 500 }, unit: "bytes" } },
    // Threads supports one topic tag per post.
    hashtags: { min: 0, max: 1 },
  },
};

export type ResolvedTarget = { limit: number; min: number; max: number; unit: LengthUnit; joined: boolean };

/** Applies the compose model's limit/unit (model wins) and scales the band to it. */
export function resolveTarget(spec: LengthSpec, model: { limit?: number; unit?: LengthUnit } = {}): ResolvedTarget | null {
  const limit = model.limit ?? spec.limit;
  if (!limit) return null;
  const unit = model.unit ?? spec.unit;
  const joined = Boolean(spec.joined);
  if ("minRatio" in spec.band) {
    return { limit, min: Math.ceil(limit * spec.band.minRatio), max: Math.floor(limit * spec.band.maxRatio), unit, joined };
  }
  const ratio = spec.scale === false || !spec.limit ? 1 : limit / spec.limit;
  return {
    limit,
    min: Math.min(limit, Math.round(spec.band.min * ratio)),
    max: Math.min(limit, Math.round(spec.band.max * ratio)),
    unit,
    joined,
  };
}

/** Post type → the playbook the platform actually has (Shorts fall back to video, etc.). */
export function postTypeFor(platform: AiPlatform, wanted: PostType): PostType {
  const supported = LENGTH_TARGETS[platform].postTypes;
  if (supported.includes(wanted)) return wanted;
  if (wanted === "short" && supported.includes("video")) return "video";
  if (wanted === "video" && supported.includes("short")) return "short";
  if (wanted === "carousel" && supported.includes("image")) return "image";
  if (wanted === "image" && supported.includes("carousel")) return "carousel";
  return supported[0]!;
}

/** The field specs that apply to one post type. */
export function fieldSpecsFor(platform: AiPlatform, postType: PostType): Record<string, LengthSpec> {
  return Object.fromEntries(
    Object.entries(LENGTH_TARGETS[platform].fields).filter(([, spec]) => !spec.postTypes || spec.postTypes.includes(postType)),
  );
}

const UNIT_LABEL: Record<LengthUnit, string> = {
  chars: "characters",
  weighted: "X-weighted characters (a URL counts 23, an emoji or CJK character counts 2)",
  bytes: "UTF-8 bytes (an emoji is 4 bytes; non-Latin letters are 2–3)",
};

/** "85–100 characters (hard limit 100)" — the only way a prompt states a length. */
export function describeTarget(target: ResolvedTarget): string {
  const subject = target.joined ? "characters in total when joined with commas" : UNIT_LABEL[target.unit];
  const band = target.min > 0 ? `${target.min}–${target.max}` : `up to ${target.max}`;
  return `${band} ${subject} (hard limit ${target.limit})`;
}

export const hashtagCountFor = (platform: AiPlatform, postType: PostType): CountSpec =>
  LENGTH_TARGETS[platform].hashtagsByPostType?.[postType] ?? LENGTH_TARGETS[platform].hashtags;

export function describeCount(count: CountSpec): string {
  if (count.min === count.max) return `exactly ${count.min}`;
  return `${count.min}–${count.max}`;
}
