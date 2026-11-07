import { sql, type AnyColumn, type SQL } from "@repo/database";
import { errors } from "@repo/errors";
import { z } from "zod";

/**
 * Keyset pagination over (created_at DESC, id DESC).
 *
 * Cursor = base64url("<created_at>|<id>"). The timestamp is Postgres's own
 * microsecond-precision text (JS Dates only keep milliseconds, which would
 * skip or repeat rows created within the same millisecond).
 */
const CursorSchema = z.object({
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  id: z.uuid(),
});
export type Cursor = z.infer<typeof CursorSchema>;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeCursor(value: string): Cursor {
  const [createdAt, id, ...rest] = Buffer.from(value, "base64url").toString("utf8").split("|");
  const parsed = CursorSchema.safeParse({ createdAt, id });
  if (!parsed.success || rest.length > 0) return errors.badRequest("Invalid cursor");
  return parsed.data;
}

/** Selects created_at as exact UTC text, for building the next cursor. */
export function cursorTimestamp(createdAt: AnyColumn): SQL<string> {
  return sql<string>`to_char(${createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** WHERE clause for "rows after this cursor" in (created_at DESC, id DESC) order. */
export function afterCursor(createdAt: AnyColumn, id: AnyColumn, cursor: string | undefined) {
  if (!cursor) return undefined;
  const { createdAt: ts, id: cursorId } = decodeCursor(cursor);
  return sql`(${createdAt}, ${id}) < (${ts}::timestamptz, ${cursorId}::uuid)`;
}

/** Trims the limit+1 probe row and builds nextCursor from the last row kept. */
export function toPage<T extends { id: string; cursorTs: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last ? encodeCursor({ createdAt: last.cursorTs, id: last.id }) : null,
  };
}
