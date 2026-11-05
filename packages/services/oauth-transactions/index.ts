import { and, db, eq, gt, lt, oauthTransactions } from "@repo/database";
import {
  CreateOAuthTransactionInputSchema,
  OAuthTransactionRowSchema,
  type CreateOAuthTransactionInput,
  type OAuthTransactionRow,
  type OAuthTransactionStore,
} from "./model";

function parse(row: unknown): OAuthTransactionRow {
  return OAuthTransactionRowSchema.parse(row);
}

export async function createOAuthTransaction(
  input: CreateOAuthTransactionInput,
): Promise<OAuthTransactionRow> {
  const [row] = await db
    .insert(oauthTransactions)
    .values(CreateOAuthTransactionInputSchema.parse(input))
    .returning();
  if (!row) throw new Error("Failed to create OAuth transaction");
  return parse(row);
}

/**
 * Single-use consumption. The conditional UPDATE is atomic in Postgres, so of
 * two concurrent callbacks with the same state only one gets the row back.
 */
export async function consumeOAuthTransaction(
  stateHash: string,
  now: Date,
): Promise<OAuthTransactionRow | null> {
  const [row] = await db
    .update(oauthTransactions)
    .set({ status: "consumed", consumedAt: now })
    .where(
      and(
        eq(oauthTransactions.stateHash, stateHash),
        eq(oauthTransactions.status, "pending"),
        gt(oauthTransactions.expiresAt, now),
      ),
    )
    .returning();
  return row ? parse(row) : null;
}

export async function findOAuthTransactionByStateHash(
  stateHash: string,
): Promise<OAuthTransactionRow | null> {
  const [row] = await db
    .select()
    .from(oauthTransactions)
    .where(eq(oauthTransactions.stateHash, stateHash))
    .limit(1);
  return row ? parse(row) : null;
}

export async function markOAuthTransactionAwaitingSelection(
  id: string,
  payloadEncrypted: string,
  expiresAt: Date,
): Promise<void> {
  await db
    .update(oauthTransactions)
    .set({ status: "awaiting_selection", pendingPayloadEncrypted: payloadEncrypted, expiresAt })
    .where(and(eq(oauthTransactions.id, id), eq(oauthTransactions.status, "consumed")));
}

export async function getAwaitingOAuthSelection(
  id: string,
  userId: string,
  now: Date,
): Promise<OAuthTransactionRow | null> {
  const [row] = await db
    .select()
    .from(oauthTransactions)
    .where(
      and(
        eq(oauthTransactions.id, id),
        eq(oauthTransactions.userId, userId),
        eq(oauthTransactions.status, "awaiting_selection"),
        gt(oauthTransactions.expiresAt, now),
      ),
    )
    .limit(1);
  return row ? parse(row) : null;
}

export async function completeOAuthSelection(
  id: string,
  userId: string,
  now: Date,
): Promise<OAuthTransactionRow | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(oauthTransactions)
      .set({ status: "completed" })
      .where(
        and(
          eq(oauthTransactions.id, id),
          eq(oauthTransactions.userId, userId),
          eq(oauthTransactions.status, "awaiting_selection"),
          gt(oauthTransactions.expiresAt, now),
        ),
      )
      .returning();
    if (!row) return null;
    // Encrypted tokens are no longer needed once handed to the caller.
    await tx
      .update(oauthTransactions)
      .set({ pendingPayloadEncrypted: null })
      .where(eq(oauthTransactions.id, id));
    return parse(row);
  });
}

export async function deleteExpiredOAuthTransactions(before: Date): Promise<void> {
  await db.delete(oauthTransactions).where(lt(oauthTransactions.expiresAt, before));
}

export const dbOAuthTransactionStore: OAuthTransactionStore = {
  create: createOAuthTransaction,
  consume: consumeOAuthTransaction,
  findByStateHash: findOAuthTransactionByStateHash,
  markAwaitingSelection: markOAuthTransactionAwaitingSelection,
  getAwaitingSelection: getAwaitingOAuthSelection,
  completeSelection: completeOAuthSelection,
  deleteExpired: deleteExpiredOAuthTransactions,
};
