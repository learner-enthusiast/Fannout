import { z } from "zod";
import { ReturnToSchema, SocialProviderSchema } from "../oauth/model";

export const OAuthTransactionStatusSchema = z.enum([
  "pending",
  "consumed",
  "awaiting_selection",
  "completed",
]);
export type OAuthTransactionStatus = z.infer<typeof OAuthTransactionStatusSchema>;

export const OAuthTransactionRowSchema = z.object({
  id: z.uuid(),
  stateHash: z.string().min(1),
  userId: z.uuid(),
  provider: SocialProviderSchema,
  status: OAuthTransactionStatusSchema,
  codeVerifierEncrypted: z.string().min(1),
  nonce: z.string().nullable(),
  browserBindingHash: z.string().min(1),
  returnTo: ReturnToSchema,
  pendingPayloadEncrypted: z.string().nullable(),
  expiresAt: z.date(),
  consumedAt: z.date().nullable(),
  createdAt: z.date(),
});
export type OAuthTransactionRow = z.infer<typeof OAuthTransactionRowSchema>;

export const CreateOAuthTransactionInputSchema = OAuthTransactionRowSchema.pick({
  stateHash: true,
  userId: true,
  provider: true,
  codeVerifierEncrypted: true,
  nonce: true,
  browserBindingHash: true,
  returnTo: true,
  expiresAt: true,
});
export type CreateOAuthTransactionInput = z.infer<typeof CreateOAuthTransactionInputSchema>;

/** Storage contract the OAuth service depends on (DB in prod, in-memory in tests). */
export interface OAuthTransactionStore {
  create(input: CreateOAuthTransactionInput): Promise<OAuthTransactionRow>;
  /** Atomically pending → consumed, only if not expired. Single use. */
  consume(stateHash: string, now: Date): Promise<OAuthTransactionRow | null>;
  findByStateHash(stateHash: string): Promise<OAuthTransactionRow | null>;
  markAwaitingSelection(id: string, payloadEncrypted: string, expiresAt: Date): Promise<void>;
  getAwaitingSelection(id: string, userId: string, now: Date): Promise<OAuthTransactionRow | null>;
  /** Atomically awaiting_selection → completed. Returns the payload once, then clears it. */
  completeSelection(id: string, userId: string, now: Date): Promise<OAuthTransactionRow | null>;
  /** Housekeeping: drop rows that expired before `before`. */
  deleteExpired(before: Date): Promise<void>;
}
