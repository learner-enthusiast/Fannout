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
export const ComposeFieldKindSchema = z.enum(["text", "textarea", "select", "toggle", "tags", "playlist", "radio"]);
export type ComposeFieldKind = z.infer<typeof ComposeFieldKindSchema>;

export const ComposeCountModeSchema = z.enum(["chars", "bytes", "weighted"]);
export type ComposeCountMode = z.infer<typeof ComposeCountModeSchema>;

export type ComposeFieldOption = { value: string | boolean; label: string };

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
  /** Platform downloads media from a public URL (Threads). */
  requiresPublicUrl?: boolean;
  /** Each post costs money (X API pay-per-use). */
  billed?: boolean;
};

export type ComposeCapabilities = {
  supportsVideo: boolean;
  supportsPhotos: boolean;
  maxPhotos: number;
  /** Fewest photos per post when photos are supported. */
  minCarousel: number;
  supportsThumbnail: boolean;
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
