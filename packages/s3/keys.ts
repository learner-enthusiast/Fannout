import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * Build a collision-free object key: `<prefix>/<yyyy>/<mm>/<uuid>-<safe-name>`.
 * The original filename is reduced to [a-z0-9._-] so it's safe in URLs and
 * can't create extra path segments.
 */
export function buildObjectKey(prefix: string, filename: string, now = new Date()): string {
  const ext = path
    .extname(filename)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "")
    .slice(0, 10);
  const base =
    path
      .basename(filename, path.extname(filename))
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "file";
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "");
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${cleanPrefix}/${yyyy}/${mm}/${randomUUID()}-${base}${ext}`;
}

/** Rejects keys that are empty, absolute, contain `..` segments or control characters. */
export function assertSafeKey(key: string): string {
  // eslint-disable-next-line no-control-regex
  if (!key || key.length > 1024 || key.startsWith("/") || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new Error("Invalid object key");
  }
  if (key.split("/").some((segment) => segment === ".." || segment === ".")) {
    throw new Error("Invalid object key");
  }
  return key;
}
