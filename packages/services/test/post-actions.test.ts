import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { db, eq, posts, socialConnections, users } from "@repo/database";
import { AppError } from "@repo/errors";
import { ProviderError, YouTubeProvider, type AnySocialProvider } from "@repo/providers";
import { YouTubeComposeInputSchema } from "@repo/providers/youtube";
import { requestDelete } from "../post-actions";
import { buildYouTubeUpdate, planDelete, planEdit } from "../post-actions/plan";
import { runDeletePost, runEditPost } from "../post-actions/run";

const caps = { supportsDelete: true, deleteNote: "note" };

test("delete plan: by status, manual platforms, Threads scope", () => {
  const plan = (status: string, extra: Partial<Parameters<typeof planDelete>[0]> = {}) =>
    planDelete({ status, platform: "youtube", capabilities: caps, connectionScopes: null, ...extra }).kind;
  assert.equal(plan("queued"), "cancel");
  assert.equal(plan("publishing"), "cancel");
  assert.equal(plan("failed"), "cancel", "never published → no platform call");
  assert.equal(plan("published"), "queue");
  for (const s of ["deleting", "deleted", "cancelled"]) assert.equal(plan(s), "noop");
  assert.deepEqual(
    planDelete({ status: "published", platform: "instagram", capabilities: { supportsDelete: false, deleteNote: "Delete it in Instagram" }, connectionScopes: null }),
    { kind: "manual", deleteNote: "Delete it in Instagram" },
  );
  assert.equal(plan("published", { platform: "threads", connectionScopes: ["threads_basic"] }), "reconnect_for_delete");
  assert.equal(plan("published", { platform: "threads", connectionScopes: ["threads_basic", "threads_delete"] }), "queue");
});

test("edit plan: non-editable fields rejected, merged values validated, no-op when unchanged", () => {
  const current = { title: "Old title", privacyStatus: "public", madeForKids: false, description: "d" };
  const base = {
    status: "published",
    externalStatus: "live",
    editStatus: null,
    capabilities: { supportsEdit: true, editableFields: ["title", "description"], editNote: "" },
    schema: YouTubeComposeInputSchema,
    current,
  };
  assert.throws(
    () => planEdit({ ...base, changes: { privacyStatus: "private" } }),
    (e: unknown) => e instanceof AppError && (e.details as { issues: { field: string }[] }).issues[0]!.field === "privacyStatus",
  );
  assert.throws(() => planEdit({ ...base, changes: { title: "x".repeat(101) } }), (e: unknown) => e instanceof AppError && e.code === "VALIDATION");
  assert.deepEqual(planEdit({ ...base, changes: { title: "Old title" } }), { kind: "noop" });
  const queued = planEdit({ ...base, changes: { title: "New title" } });
  assert.equal(queued.kind, "queue");
  if (queued.kind === "queue") {
    assert.deepEqual(queued.changed, { title: "New title" });
    assert.deepEqual(queued.before, { title: "Old title" });
    assert.equal(queued.merged.description, "d", "untouched fields kept");
  }
  assert.throws(() => planEdit({ ...base, status: "deleted", changes: { title: "New" } }), /Only live published posts/);
});

test("YouTube update resends the FULL snippet + status (partial snippet would wipe fields)", () => {
  const body = buildYouTubeUpdate(
    "vid1",
    { snippet: { title: "Old", description: "Old desc", tags: ["a"], categoryId: "28", defaultLanguage: "en" }, status: { privacyStatus: "public", embeddable: true, license: "youtube" } },
    { title: "New", description: "Old desc", tags: ["a", "b"], privacyStatus: "unlisted", madeForKids: false },
  );
  assert.deepEqual(body, {
    id: "vid1",
    snippet: { title: "New", description: "Old desc", tags: ["a", "b"], categoryId: "28", defaultLanguage: "en" },
    status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false, embeddable: true, license: "youtube" },
  });
});

// ---------------------------------------------------------------------------
// DB-backed state machine with a fake provider (no network)
// ---------------------------------------------------------------------------

let userId: string;
let connectionId: string;
before(async () => {
  const [user] = await db.insert(users).values({ clerkId: `user_test_${randomUUID()}`, email: `pa-${randomUUID()}@example.com` }).returning({ id: users.id });
  userId = user!.id;
  const [conn] = await db
    .insert(socialConnections)
    .values({ userId, provider: "YOUTUBE", providerAccountId: `UC${randomUUID().slice(0, 6)}`, accessTokenEncrypted: "v1.x", refreshTokenEncrypted: "v1.y" })
    .returning({ id: socialConnections.id });
  connectionId = conn!.id;
});
after(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

async function makePost(status: string, extra: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(posts)
    .values({
      userId,
      socialConnectionId: connectionId,
      name: "Test post",
      status,
      externalPostId: "vid-123",
      config: { platform: "youtube", mediaType: "video", input: { title: "Old", privacyStatus: "public", madeForKids: false }, attempts: 0, progress: {}, ...extra },
    })
    .returning();
  return row!;
}

function fakeYouTube(overrides: Partial<Record<keyof YouTubeProvider, unknown>>): () => Promise<AnySocialProvider> {
  const provider = Object.create(YouTubeProvider.prototype) as YouTubeProvider;
  Object.assign(provider, overrides);
  return async () => provider;
}

test("queued → cancelled (no platform call); published → deleting → deleted", async () => {
  const queued = await makePost("queued");
  const cancel = await requestDelete(userId, queued.id);
  assert.equal(cancel.result.mode, "cancelled");
  assert.equal(cancel.event?.name, "post/publish.cancelled");

  const published = await makePost("published");
  const queuedDelete = await requestDelete(userId, published.id);
  assert.equal(queuedDelete.result.mode, "queued");
  assert.equal(queuedDelete.event?.name, "post/delete.requested");
  assert.equal((await requestDelete(userId, published.id)).result.mode, "noop", "idempotent while deleting");

  let calls = 0;
  const outcome = await runDeletePost(published.id, { createProvider: fakeYouTube({ deleteVideo: async () => { calls++; } }) });
  assert.deepEqual(outcome, { outcome: "deleted" });
  assert.equal(calls, 1);
  const [row] = await db.select().from(posts).where(eq(posts.id, published.id));
  assert.equal(row!.status, "deleted");
  assert.equal(row!.deletedBy, "app");
  assert.deepEqual(await runDeletePost(published.id), { outcome: "skipped" }, "exits unless deleting");
});

test("404 from the platform counts as deleted", async () => {
  const post = await makePost("deleting");
  const outcome = await runDeletePost(post.id, {
    createProvider: fakeYouTube({ deleteVideo: async () => { throw new ProviderError({ provider: "YOUTUBE", code: "NOT_FOUND", status: 404, message: "videoNotFound" }); } }),
  });
  assert.equal(outcome.outcome, "deleted");
});

test("auth error → back to published + reconnect_required, connection flagged, no retry", async () => {
  const post = await makePost("deleting");
  await assert.rejects(
    runDeletePost(post.id, { createProvider: fakeYouTube({ deleteVideo: async () => { throw new ProviderError({ provider: "YOUTUBE", code: "UNAUTHORIZED", status: 401, message: "Invalid Credentials" }); } }) }),
    (e: unknown) => (e as { code?: string }).code === "reconnect_required",
  );
  const [row] = await db.select().from(posts).where(eq(posts.id, post.id));
  assert.equal(row!.status, "published");
  assert.equal(row!.deleteErrorCode, "reconnect_required");
  const [conn] = await db.select().from(socialConnections).where(eq(socialConnections.id, connectionId));
  assert.equal(conn!.accessTokenEncrypted, null, "connection now needs reconnect");
  await db.update(socialConnections).set({ accessTokenEncrypted: "v1.x" }).where(eq(socialConnections.id, connectionId));
});

test("a failed edit keeps the live values in the DB", async () => {
  const post = await makePost("published");
  await db
    .update(posts)
    .set({
      editStatus: "editing",
      config: {
        platform: "youtube",
        mediaType: "video",
        input: { title: "Old", privacyStatus: "public", madeForKids: false },
        attempts: 0,
        progress: {},
        pendingEdit: { merged: { title: "New", privacyStatus: "public", madeForKids: false }, changed: { title: "New" }, before: { title: "Old" } },
      },
    })
    .where(eq(posts.id, post.id));
  await assert.rejects(
    runEditPost(post.id, {
      createProvider: fakeYouTube({
        listVideo: async () => ({ items: [{ id: "vid-123", snippet: { title: "Old" }, status: {} }] }),
        updateVideo: async () => { throw new ProviderError({ provider: "YOUTUBE", code: "BAD_REQUEST", status: 400, message: "invalidTitle" }); },
      }),
    }),
  );
  const [row] = await db.select().from(posts).where(eq(posts.id, post.id));
  assert.equal(row!.editStatus, "failed");
  assert.equal((row!.config as { input: { title: string } }).input.title, "Old", "old value kept");
  assert.deepEqual(row!.revisions, []);
});
