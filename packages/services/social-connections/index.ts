import { and, db, desc, eq, socialConnections } from "@repo/database";
import { errors } from "@repo/errors";
import { z } from "zod";
import { afterCursor, cursorTimestamp, PaginationInputSchema, toPage } from "../common/pagination";
import {
  ListSocialConnectionsInputSchema,
  SocialConnectionRowSchema,
  SocialConnectionViewSchema,
  UpdateSocialConnectionInputSchema,
  UpsertSocialConnectionInputSchema,
  type ListSocialConnectionsInput,
  type SocialConnectionRow,
  type SocialConnectionView,
  type UpdateSocialConnectionInput,
  type UpsertSocialConnectionInput,
} from "./model";

const UuidSchema = z.uuid();

/** Insert, or refresh tokens/profile when the same provider account is reconnected. */
export async function upsertSocialConnection(
  input: UpsertSocialConnectionInput,
): Promise<SocialConnectionRow> {
  const data = UpsertSocialConnectionInputSchema.parse(input);
  // Same fields minus the conflict key (zod strips userId/provider/providerAccountId).
  const rest = UpdateSocialConnectionInputSchema.parse(data);
  const [row] = await db
    .insert(socialConnections)
    .values(data)
    .onConflictDoUpdate({
      target: [
        socialConnections.userId,
        socialConnections.provider,
        socialConnections.providerAccountId,
      ],
      set: { ...rest, isActive: data.isActive ?? true, updatedAt: new Date() },
    })
    .returning();

  if (!row) return errors.internal("Failed to upsert social connection");
  return SocialConnectionRowSchema.parse(row);
}

export async function getSocialConnectionById(
  userId: string,
  id: string,
): Promise<SocialConnectionRow | null> {
  const [row] = await db
    .select()
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.id, UuidSchema.parse(id)),
        eq(socialConnections.userId, UuidSchema.parse(userId)),
      ),
    )
    .limit(1);
  return row ? SocialConnectionRowSchema.parse(row) : null;
}

export async function getSocialConnectionByProviderAccount(
  userId: string,
  provider: string,
  providerAccountId: string,
): Promise<SocialConnectionRow | null> {
  const [row] = await db
    .select()
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.userId, UuidSchema.parse(userId)),
        eq(socialConnections.provider, provider),
        eq(socialConnections.providerAccountId, providerAccountId),
      ),
    )
    .limit(1);
  return row ? SocialConnectionRowSchema.parse(row) : null;
}

export async function listSocialConnectionsByUserId(
  userId: string,
  options: ListSocialConnectionsInput = {},
): Promise<SocialConnectionRow[]> {
  const { provider, isActive, limit, offset } = ListSocialConnectionsInputSchema.parse(options);
  const rows = await db
    .select()
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.userId, UuidSchema.parse(userId)),
        provider ? eq(socialConnections.provider, provider) : undefined,
        isActive === undefined ? undefined : eq(socialConnections.isActive, isActive),
      ),
    )
    .orderBy(desc(socialConnections.createdAt))
    .limit(limit)
    .offset(offset);
  return z.array(SocialConnectionRowSchema).parse(rows);
}

export async function updateSocialConnection(
  userId: string,
  id: string,
  input: UpdateSocialConnectionInput,
): Promise<SocialConnectionRow> {
  const data = UpdateSocialConnectionInputSchema.parse(input);
  const [row] = await db
    .update(socialConnections)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(socialConnections.id, UuidSchema.parse(id)),
        eq(socialConnections.userId, UuidSchema.parse(userId)),
      ),
    )
    .returning();

  if (!row) return errors.notFound("Social connection");
  return SocialConnectionRowSchema.parse(row);
}

/** Disconnect without deleting history: marks inactive and clears tokens. */
export async function deactivateSocialConnection(
  userId: string,
  id: string,
): Promise<SocialConnectionRow> {
  return updateSocialConnection(userId, id, {
    isActive: false,
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    accessExpiry: null,
    refreshExpiry: null,
  });
}

export async function deleteSocialConnection(userId: string, id: string): Promise<void> {
  const [row] = await db
    .delete(socialConnections)
    .where(
      and(
        eq(socialConnections.id, UuidSchema.parse(id)),
        eq(socialConnections.userId, UuidSchema.parse(userId)),
      ),
    )
    .returning({ id: socialConnections.id });

  if (!row) errors.notFound("Social connection");
}

/**
 * Client-safe projection. "reconnect" when the stored access token is gone,
 * or expired with no refresh token to renew it.
 */
export function toSocialConnectionView(
  row: SocialConnectionRow,
  now: Date = new Date(),
): SocialConnectionView {
  let status: SocialConnectionView["status"] = "connected";
  if (!row.isActive) status = "disconnected";
  else if (
    !row.accessTokenEncrypted ||
    (!row.refreshTokenEncrypted && row.accessExpiry && row.accessExpiry <= now)
  ) {
    status = "reconnect";
  }
  return SocialConnectionViewSchema.parse({ ...row, status });
}

/** Connections newest first, 10 per page (created_at DESC, id DESC). */
export async function listSocialConnectionsPage(
  userId: string,
  input: { cursor?: string | null; limit?: number; provider?: string } = {},
) {
  const { cursor, limit } = PaginationInputSchema.parse(input);
  const provider = input.provider;
  const rows = await db
    .select({ row: socialConnections, cursorTs: cursorTimestamp(socialConnections.createdAt) })
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.userId, UuidSchema.parse(userId)),
        provider ? eq(socialConnections.provider, provider) : undefined,
        afterCursor(socialConnections.createdAt, socialConnections.id, cursor ?? undefined),
      ),
    )
    .orderBy(desc(socialConnections.createdAt), desc(socialConnections.id))
    .limit(limit + 1);
  const page = toPage(rows.map(({ row, cursorTs }) => ({ id: row.id, cursorTs, row })), limit);
  const now = new Date();
  return {
    items: page.items.map((item) => toSocialConnectionView(SocialConnectionRowSchema.parse(item.row), now)),
    nextCursor: page.nextCursor,
  };
}
