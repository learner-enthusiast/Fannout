import type { MediaType } from "./model";

/** Bytes process-media reads from the start of an upload to detect its real type. */
export const SNIFF_BYTES = 64;

export type Sniffed = { type: MediaType; mimeType: string } | { type: "text" } | null;

const ascii = (buf: Uint8Array, start: number, end: number) => String.fromCharCode(...buf.subarray(start, end));
const starts = (buf: Uint8Array, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

/**
 * Real file type from magic bytes. Never trusts the extension or the browser's
 * mime type. Returns { type: "text" } for plausible UTF-8 text (subtitles,
 * JSON) and null for anything unrecognised.
 */
export function sniffMediaType(buf: Uint8Array): Sniffed {
  if (buf.length < 4) return null;
  if (starts(buf, [0xff, 0xd8, 0xff])) return { type: "image", mimeType: "image/jpeg" };
  if (starts(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: "image", mimeType: "image/png" };
  if (ascii(buf, 0, 4) === "GIF8") return { type: "image", mimeType: "image/gif" };
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return { type: "image", mimeType: "image/webp" };
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "AVI ") return { type: "video", mimeType: "video/x-msvideo" };
  if (starts(buf, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { type: "video", mimeType: ascii(buf, 0, Math.min(buf.length, 64)).includes("webm") ? "video/webm" : "video/x-matroska" };
  }
  if (ascii(buf, 4, 8) === "ftyp") {
    const brand = ascii(buf, 8, 12);
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)) return { type: "image", mimeType: brand.startsWith("he") ? "image/heic" : "image/heif" };
    if (brand === "avif" || brand === "avis") return { type: "image", mimeType: "image/avif" };
    if (brand === "qt  ") return { type: "video", mimeType: "video/quicktime" };
    if (brand.startsWith("3g")) return { type: "video", mimeType: "video/3gpp" };
    return { type: "video", mimeType: "video/mp4" };
  }
  if (starts(buf, [0x00, 0x00, 0x01, 0xba]) || starts(buf, [0x00, 0x00, 0x01, 0xb3])) return { type: "video", mimeType: "video/mpeg" };
  if (buf[0] === 0x47 && (buf.length < 189 || buf[188] === 0x47)) return { type: "video", mimeType: "video/mp2t" };
  // Text: no NUL bytes and mostly printable (UTF-8 BOM allowed).
  const body = starts(buf, [0xef, 0xbb, 0xbf]) ? buf.subarray(3) : buf;
  const controls = body.filter((b) => b < 0x09 || (b > 0x0d && b < 0x20)).length;
  if (!body.includes(0) && controls <= body.length * 0.02) return { type: "text" };
  return null;
}

/**
 * Checks the sniffed bytes against the stored type. Returns the real mime
 * type to store (e.g. a ".jpg" that is really a PNG), or an error message.
 */
export function checkSniffed(stored: MediaType, buf: Uint8Array): { mimeType?: string } | { error: string } {
  const sniffed = sniffMediaType(buf);
  if (stored === "subtitle" || stored === "json") {
    return sniffed?.type === "text" ? {} : { error: `This file isn't a valid ${stored === "json" ? "JSON" : "subtitle"} text file` };
  }
  if (!sniffed || sniffed.type === "text") return { error: `This file isn't a supported ${stored}` };
  if (sniffed.type !== stored) return { error: `This file is really a${sniffed.type === "image" ? "n image" : " video"}, not a${stored === "image" ? "n image" : " video"}` };
  return { mimeType: sniffed.mimeType };
}
