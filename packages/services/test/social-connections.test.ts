import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db, eq, users } from "@repo/database";
import { AppError } from "@repo/errors";
import {
  deactivateSocialConnection,
  toSocialConnectionView,
  upsertSocialConnection,
} from "../social-connections";

// Needs a migrated database (pnpm db:migrate).
test("disconnecting clears credentials, is owner-only, and reconnecting reuses the row", async () => {
  const [owner] = await db
    .insert(users)
    .values({ clerkId: `user_${randomUUID()}`, email: `owner-${randomUUID()}@example.com` })
    .returning();
  const [stranger] = await db
    .insert(users)
    .values({ clerkId: `user_${randomUUID()}`, email: `stranger-${randomUUID()}@example.com` })
    .returning();
  assert.ok(owner && stranger);

  try {
    const base = {
      userId: owner.id,
      provider: "X",
      providerAccountId: "x-1",
      accessTokenEncrypted: "v1.a.b.c",
      refreshTokenEncrypted: "v1.d.e.f",
    };
    const connection = await upsertSocialConnection(base);
    const duplicate = await upsertSocialConnection({ ...base, username: "renamed" });
    assert.equal(duplicate.id, connection.id);
    assert.equal(toSocialConnectionView(duplicate).status, "connected");

    await assert.rejects(
      deactivateSocialConnection(stranger.id, connection.id),
      (error: unknown) => error instanceof AppError && error.code === "NOT_FOUND",
    );

    const disconnected = await deactivateSocialConnection(owner.id, connection.id);
    assert.equal(disconnected.isActive, false);
    assert.equal(disconnected.accessTokenEncrypted, null);
    assert.equal(disconnected.refreshTokenEncrypted, null);
    const view = toSocialConnectionView(disconnected);
    assert.equal(view.status, "disconnected");
    assert.equal("accessTokenEncrypted" in view, false);
    assert.equal("refreshTokenEncrypted" in view, false);

    const reconnected = await upsertSocialConnection(base);
    assert.equal(reconnected.id, connection.id);
    assert.equal(reconnected.isActive, true);
  } finally {
    await db.delete(users).where(eq(users.id, owner.id));
    await db.delete(users).where(eq(users.id, stranger.id));
  }
});
