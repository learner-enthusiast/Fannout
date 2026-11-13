import { clerkClient } from "@clerk/express";
import { db, eq, users } from "@repo/database";
import {
  ClerkUserPayloadSchema,
  UserRowSchema,
  type ClerkUserPayload,
  type UserRow,
} from "./model";
import { cached, delKey, globalKey } from "../cache";
import { env } from "../env";

const USER_EXISTS_CACHE_TTL_MS = 5 * 60 * 1000;
/** clerkId → { internal user id, cache expiry } */
const userExistsCache = new Map<string, { id: string; expiresAt: number }>();

function getEmail(payload: ClerkUserPayload) {
  const primaryEmail = payload.primary_email_address_id
    ? payload.email_addresses.find((email) => email.id === payload.primary_email_address_id)
    : payload.email_addresses[0];

  if (!primaryEmail) {
    throw new Error(`Clerk user ${payload.id} has no primary email address`);
  }

  return primaryEmail.email_address;
}

export async function upsertUserFromClerk(input: ClerkUserPayload): Promise<UserRow> {
  const payload = ClerkUserPayloadSchema.parse(input);
  const email = getEmail(payload);
  const fullName = [payload.first_name, payload.last_name].filter(Boolean).join(" ") || null;
  const now = new Date();
  const [row] = await db
    .insert(users)
    .values({
      clerkId: payload.id,
      email,
      firstName: payload.first_name,
      lastName: payload.last_name,
      fullName,
      imageUrl: payload.image_url,
    })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: {
        email,
        firstName: payload.first_name,
        lastName: payload.last_name,
        fullName,
        imageUrl: payload.image_url,
        deletedAt: null,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) {
    throw new Error(`Failed to upsert Clerk user ${payload.id}`);
  }

  const user = UserRowSchema.parse(row);
  userExistsCache.set(payload.id, { id: user.id, expiresAt: Date.now() + USER_EXISTS_CACHE_TTL_MS });
  // Committed (single statement): drop the shared copy so the next read sees the new row.
  await delKey(globalKey("user", payload.id));
  return user;
}

export async function softDeleteUser(clerkUserId: string): Promise<void> {
  const id = zodClerkUserId(clerkUserId);
  await db
    .update(users)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.clerkId, id));
  userExistsCache.delete(id);
  await delKey(globalKey("user", id));
}

/** Makes sure the Clerk user has a row and returns its internal (uuid) id. */
export async function ensureUser(clerkUserId: string): Promise<string> {
  const id = zodClerkUserId(clerkUserId);
  const cached = userExistsCache.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.id;
  }

  const existing = await loadUserByClerkId(id);
  if (existing) {
    userExistsCache.set(id, { id: existing.id, expiresAt: Date.now() + USER_EXISTS_CACHE_TTL_MS });
    return existing.id;
  }

  if (!env.CLERK_SECRET_KEY) {
    throw new Error("CLERK_SECRET_KEY is required to fetch users from Clerk");
  }

  const clerkUser = await clerkClient.users.getUser(id);
  const user = await upsertUserFromClerk({
    id: clerkUser.id,
    email_addresses: clerkUser.emailAddresses.map(({ id: emailId, emailAddress }) => ({
      id: emailId,
      email_address: emailAddress,
    })),
    primary_email_address_id: clerkUser.primaryEmailAddressId,
    first_name: clerkUser.firstName,
    last_name: clerkUser.lastName,
    image_url: clerkUser.imageUrl,
  });
  return user.id;
}

/** Group "user": global key fn:cache:v1:user:{clerkId}. A missing user is never served from the cache. */
function loadUserByClerkId(clerkId: string): Promise<UserRow | null> {
  return cached({
    userId: null,
    group: "user",
    key: globalKey("user", clerkId),
    schema: UserRowSchema.nullable(),
    isStale: (value) => value === null,
    load: async () => {
      const [row] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
      return row ? UserRowSchema.parse(row) : null;
    },
  });
}

export async function getUserByClerkId(clerkUserId: string): Promise<UserRow | null> {
  return loadUserByClerkId(zodClerkUserId(clerkUserId));
}

function zodClerkUserId(clerkUserId: string) {
  return ClerkUserPayloadSchema.shape.id.parse(clerkUserId);
}
