import twitterText from "twitter-text";
import { z } from "zod";

/**
 * Compose metadata shared by every platform's `*ComposeInputSchema`.
 *
 * Each platform's model.ts defines one compose schema (what the composer
 * sends for that platform) and a `*_COMPOSE` capability constant. Fields carry
 * UI metadata via Zod `.meta()`, so the composer UI and the server validation
 * come from the same definition.
 */
export const ComposeFieldKindSchema = z.enum(["text", "textarea", "select", "toggle", "tags", "playlist", "radio", "relatedVideo"]);
export type ComposeFieldKind = z.infer<typeof ComposeFieldKindSchema>;

export const ComposeCountModeSchema = z.enum(["chars", "bytes", "weighted"]);
export type ComposeCountMode = z.infer<typeof ComposeCountModeSchema>;

export type ComposeFieldOption = { value: string | boolean; label: string; description?: string };

export type ComposeFieldMeta = {
  label: string;
  /** Agent-facing explanation (becomes the Zod/JSON-Schema description; docs/ai.md). Required. */
  description: string;
  kind: ComposeFieldKind;
  /** Limit shown by the counter (the schema enforces it too). */
  maxLength?: number;
  countMode?: ComposeCountMode;
  options?: ComposeFieldOption[];
  /** Options loaded from the backend (e.g. the channel's YouTube categories). */
  optionsSource?: "youtube.categories";
  /** Pre-filled value in the UI (the field stays required). */
  defaultValue?: string | boolean;
  /** Only shown for this media type. */
  mediaType?: "video" | "photos";
  helper?: string;
  /** AI can write this field (Compose shows "Generate with AI"). */
  ai?: boolean;
};

/** Attach compose metadata to a field schema (call last, after .optional()). */
export function composeField<T extends z.ZodType>(schema: T, meta: ComposeFieldMeta): T {
  return schema.meta(meta as unknown as Record<string, unknown>) as T;
}

export function readComposeMeta(schema: z.ZodType): ComposeFieldMeta | undefined {
  const meta = schema.meta() as ComposeFieldMeta | undefined;
  return meta?.kind ? meta : undefined;
}

export type ComposeMediaRules = {
  maxVideoBytes?: number;
  minVideoSeconds?: number;
  maxVideoSeconds?: number;
  maxImageBytes?: number;
  /** YouTube: vertical videos up to this length publish as Shorts. */
  shortMaxSeconds?: number;
  /** Accepted video MIME types (Instagram: mp4/mov). Omitted = no extra restriction. */
  videoMimeTypes?: string[];
  /** Accepted image MIME types, for photos and cover images (Instagram: JPEG only). */
  imageMimeTypes?: string[];
  /** Platform downloads media from a public URL (Threads, Instagram). */
  requiresPublicUrl?: boolean;
  /** Each post costs money (X API pay-per-use). */
  billed?: boolean;
};

/** What a custom video thumbnail / cover image must look like on a platform. */
export type ComposeThumbnailRules = {
  maxBytes: number;
  mimeTypes: string[];
  /** Shape the platform shows; the composer auto-assigns picked images by it. */
  aspect: "landscape" | "portrait";
  /** Recommended size, for display (e.g. "1280×720 (16:9)"). */
  recommended: string;
  note?: string;
};

/** How people are tagged on media (separate from @mentions in the text). */
export type ComposeTagging = {
  /** positioned = { username, x, y } pins on the image; list = usernames only. */
  image: "positioned" | "list" | "none";
  video: "list" | "none";
  /** Most tags per media item (Instagram) or per post (X). */
  max: number;
  /** The platform tags by user id, so usernames are resolved (and saved) first. */
  needsUserId: boolean;
};

export const NO_TAGGING: ComposeTagging = { image: "none", video: "none", max: 0, needsUserId: false };

export type ComposeCapabilities = {
  mentions: {
    supported: boolean;
    kind: "handle" | "urn" | "page" | "text_only";
    note: string;
  };
  supportsVideo: boolean;
  supportsPhotos: boolean;
  maxPhotos: number;
  /** Fewest photos per post when photos are supported. */
  minCarousel: number;
  /**
   * Multi-photo posts: api = Fannout publishes them; manual = the platform has no API for
   * them, so Fannout prepares the text + images and the user posts by hand; none = unsupported.
   */
  carouselMode: "api" | "manual" | "none";
  /** Most photos in a multi-photo post (0 when carouselMode is none). */
  carouselMax: number;
  tagging: ComposeTagging;
  /** Collaborator invites (accounts that must accept in the platform's app); null = unsupported. */
  collaborators: { max: number } | null;
  supportsThumbnail: boolean;
  /** Constraints for the custom thumbnail (only when supportsThumbnail). */
  thumbnailRules?: ComposeThumbnailRules;
  /** Photo posts: max length of an alt text per image (`altTexts`); absent = no per-image alt text. */
  perImageAltTextMax?: number;
  mediaRules: ComposeMediaRules;
  /** The platform API can delete a published post. */
  supportsDelete: boolean;
  /** Shown next to Delete (quota, cost, permissions…). */
  deleteNote: string;
  /** The platform API can edit a published post (text/settings only — media never). */
  supportsEdit: boolean;
  /** Compose field names that can change after publishing ("thumbnail" = custom thumbnail). */
  editableFields: string[];
  editNote: string;
};

/** UTF-8 length (YouTube counts description bytes). */
export const utf8Length = (value: string) => new TextEncoder().encode(value).length;

/** X weighted length (official twitter-text: URLs 23, CJK/emoji 2, …). */
export function xWeightedLength(text: string): number {
  return twitterText.parseTweet(text).weightedLength;
}
