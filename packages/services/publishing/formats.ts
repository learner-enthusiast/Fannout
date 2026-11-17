import { imageFormatOf, type ComposeImageSlotRule, type ImageSlot } from "@repo/providers";
import { DerivativeError, ensureFormat, originalFits, recordedDerivative, type DerivableFormat } from "../media/derivatives";
import type { MediaRow } from "../media/model";
import { getMediaForProcessing } from "../media/uploads";
import { PermanentPublishError } from "./errors";
import type { ComposeMediaType } from "./model";
import { PLATFORMS, type Platform } from "./platforms";
import type { PublishContext } from "./publishers/types";
import type { PrepareStep } from "./upload/progress";

/**
 * Generic format layer: every image a publisher sends is checked against the platform's
 * capabilities.imageFormats for its slot; when it doesn't fit, ensureFormat builds a converted copy
 * (one Inngest prepare step per image, before the publisher runs) and the publisher gets a row that
 * points at it. Publishers keep using urlSource / streamSource unchanged.
 */

type Need = { row: MediaRow; slot: ImageSlot; rule: ComposeImageSlotRule; format: DerivableFormat };

function slotOf(mediaType: ComposeMediaType, count: number): ImageSlot {
  return mediaType === "photos" && count > 1 ? "carouselImage" : "image";
}

/** The conversion target: JPEG (the only one ensureFormat builds) when the platform accepts it. */
function targetFor(rule: ComposeImageSlotRule): DerivableFormat | null {
  return rule.acceptedImageFormats.includes("jpeg") ? "jpeg" : null;
}

function needs(platform: Platform, ctx: Pick<PublishContext, "media" | "mediaType" | "thumbnail">): Need[] {
  const rules = PLATFORMS[platform].capabilities.imageFormats;
  if (!rules) return [];
  const out: Need[] = [];
  const add = (row: MediaRow, slot: ImageSlot) => {
    const rule = rules[slot];
    if (!rule || row.type !== "image" || originalFits(row, rule.acceptedImageFormats, rule.maxImageBytes)) return;
    const format = targetFor(rule);
    if (!format) {
      const from = imageFormatOf(row.mimeType) ?? row.mimeType;
      throw new PermanentPublishError("VALIDATION", `${PLATFORMS[platform].label} can't take ${from} images (${row.name})`);
    }
    out.push({ row, slot, rule, format });
  };
  if (ctx.mediaType === "photos") for (const row of ctx.media) add(row, slotOf(ctx.mediaType, ctx.media.length));
  if (ctx.mediaType === "video" && ctx.thumbnail) add(ctx.thumbnail, "cover");
  return out;
}

/** The row a publisher should send: same media, pointing at the derivative. */
function asDerived(row: MediaRow, format: DerivableFormat, maxBytes: number): MediaRow | null {
  const d = recordedDerivative(row, format, maxBytes);
  if (!d) return null;
  return { ...row, s3Key: d.key, mimeType: "image/jpeg", sizeBytes: d.bytes, width: d.width, height: d.height };
}

async function convert(need: Need) {
  try {
    await ensureFormat(need.row.id, need.format, need.rule.maxImageBytes);
  } catch (error) {
    if (error instanceof DerivativeError) throw new PermanentPublishError("VALIDATION", error.message);
    throw error;
  }
}

/**
 * prepare: converts the next image that needs it and returns a step (so each conversion is its own
 * Inngest step, before any container/upload). Once nothing is left, swaps the rows in ctx and
 * returns null so the publisher runs.
 * finalize: converts inline if a derivative is somehow missing, then swaps.
 */
export async function applyImageFormats(platform: Platform, ctx: PublishContext, phase: "prepare" | "finalize"): Promise<PrepareStep | null> {
  const list = needs(platform, ctx);
  for (const need of list) {
    if (asDerived(need.row, need.format, need.rule.maxImageBytes)) continue;
    const label = need.format.toUpperCase();
    await ctx.save({}, `Converting ${need.row.name} to ${label}`);
    await convert(need);
    if (phase === "prepare") return { done: false, next: `convert-${need.row.id}-${need.format}` };
  }
  if (!list.length) return null;
  // Rows were loaded before the conversion in finalize: re-read the recorded derivatives.
  const fresh = phase === "finalize" ? await reload(list) : new Map<string, MediaRow>();
  const swap = (row: MediaRow) => {
    const need = list.find((n) => n.row.id === row.id);
    if (!need) return row;
    const derived = asDerived(fresh.get(row.id) ?? row, need.format, need.rule.maxImageBytes);
    if (!derived) throw new Error(`The converted copy of ${row.name} isn't ready yet`);
    return derived;
  };
  ctx.media = ctx.media.map(swap);
  if (ctx.thumbnail) ctx.thumbnail = swap(ctx.thumbnail);
  return null;
}

async function reload(list: Need[]): Promise<Map<string, MediaRow>> {
  const rows = await Promise.all(list.map((n) => getMediaForProcessing(n.row.id)));
  return new Map(rows.filter((r): r is MediaRow => Boolean(r)).map((r) => [r.id, r]));
}
