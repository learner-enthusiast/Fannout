import { errors } from "@repo/errors";
import { z } from "zod";

/**
 * Pagination for EVERY list endpoint (docs/conventions/api.md).
 * Cursor-based only — no offsets. Default and max page size: 10.
 */
export const PAGE_SIZE_MAX = 10;

export const PaginationInputSchema = z.object({
  cursor: z.string().min(1).max(300).nullish().describe("Opaque cursor from the previous page's nextCursor; omit for the first page."),
  limit: z.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_MAX).describe(`Items per page (max ${PAGE_SIZE_MAX}).`),
});
export type PaginationInput = z.input<typeof PaginationInputSchema>;

/** { items, nextCursor } for any item schema. */
export const paginatedOutput = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item).describe("This page of results, newest first unless the endpoint says otherwise."),
    nextCursor: z.string().nullable().describe("Pass as cursor to get the next page; null when there are no more items."),
  });
export type PaginatedOutput<T> = { items: T[]; nextCursor: string | null };

/**
 * Generic key cursor: base64url("sortKey|id"). Use for lists sorted by
 * something other than created_at (e.g. folder items by role + position).
 * Time-sorted lists use lib/cursor (exact microsecond created_at).
 */
export function encodeKeyCursor(sortKey: string, id: string): string {
  return Buffer.from(`${sortKey}|${id}`, "utf8").toString("base64url");
}

export function decodeKeyCursor(value: string): { sortKey: string; id: string } {
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  const index = decoded.lastIndexOf("|");
  const sortKey = decoded.slice(0, index);
  const id = decoded.slice(index + 1);
  if (index <= 0 || !z.uuid().safeParse(id).success) return errors.badRequest("Invalid cursor");
  return { sortKey, id };
}

/** Trims the limit+1 probe row and builds nextCursor from the last kept row. */
export function toKeyPage<T>(rows: T[], limit: number, keyOf: (row: T) => { sortKey: string; id: string }): PaginatedOutput<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  if (rows.length <= limit || !last) return { items, nextCursor: null };
  const { sortKey, id } = keyOf(last);
  return { items, nextCursor: encodeKeyCursor(sortKey, id) };
}

export { afterCursor, cursorTimestamp, decodeCursor, encodeCursor, toPage } from "../lib/cursor";
