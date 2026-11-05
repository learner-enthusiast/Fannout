import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db, eq, users } from "@repo/database";
import { softDeleteUser, upsertUserFromClerk } from "../users";

test("upsert inserts, updates, and restores a soft-deleted Clerk user", async () => {
  const id = `user_${randomUUID().replaceAll("-", "")}`;
  const originalEmail = `clerk-${randomUUID()}@example.com`;
  const updatedEmail = `clerk-${randomUUID()}@example.com`;

  try {
    const inserted = await upsertUserFromClerk({
      id,
      email_addresses: [{ id: "email_1", email_address: originalEmail }],
      primary_email_address_id: "email_1",
      first_name: "First",
      last_name: "User",
      image_url: "https://example.com/first.png",
    });
    assert.equal(inserted.clerkId, id);
    assert.equal(inserted.email, originalEmail);
    assert.equal(inserted.fullName, "First User");

    const updated = await upsertUserFromClerk({
      id,
      email_addresses: [{ id: "email_2", email_address: updatedEmail }],
      primary_email_address_id: "email_2",
      first_name: "Updated",
      last_name: "User",
      image_url: "https://example.com/updated.png",
    });
    assert.equal(updated.email, updatedEmail);
    assert.equal(updated.fullName, "Updated User");

    await softDeleteUser(id);
    const [deleted] = await db.select().from(users).where(eq(users.clerkId, id)).limit(1);
    assert.ok(deleted?.deletedAt);

    const restored = await upsertUserFromClerk({
      id,
      email_addresses: [{ id: "email_2", email_address: updatedEmail }],
      primary_email_address_id: "email_2",
      first_name: "Updated",
      last_name: "User",
      image_url: "https://example.com/updated.png",
    });
    assert.equal(restored.deletedAt, null);
    assert.equal(restored.email, updatedEmail);
  } finally {
    await db.delete(users).where(eq(users.clerkId, id));
  }
});
