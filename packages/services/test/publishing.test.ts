import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { db, eq, media, posts, postMedia, socialConnections, users } from "@repo/database";
import { AppError } from "@repo/errors";
import type { MediaRow } from "../media/model";
import { publishBatch } from "../publishing";
import type { PublishBatchInput } from "../publishing/model";
import { validateBatch, type ConnectionForValidation } from "../publishing/validate";

const userId = randomUUID();
const connection = (provider: string): ConnectionForValidation => ({ id: randomUUID(), userId, provider, status: "connected" });
const row = (type: "video" | "image", extra: Partial<MediaRow> = {}): MediaRow => ({
  id: randomUUID(),
  userId,
  name: `${type}-${randomUUID().slice(0, 4)}`,
  type,
  status: "ready",
  originalFilename: null,
  mimeType: type === "video" ? "video/mp4" : "image/png",
  sizeBytes: 1000,
  s3Bucket: "b",
  s3Key: randomUUID(),
  s3Region: "r",
  width: 1920,
  height: 1080,
  durationSeconds: type === "video" ? 30 : null,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});
const youtubeInput = { title: "GraphQL vs REST", privacyStatus: "public", madeForKids: false };
const batch = (partial: Partial<PublishBatchInput> & Pick<PublishBatchInput, "targets" | "mediaIds">): PublishBatchInput => ({
  idempotencyKey: randomUUID(),
  mediaType: "video",
  ...partial,
});
const fieldsFor = (issues: { socialConnectionId?: string; field: string }[], id: string) =>
  issues.filter((i) => i.socialConnectionId === id).map((i) => i.field);

test("unsupported media type is rejected (YouTube in Photos mode)", () => {
  const yt = connection("YOUTUBE");
  const x = connection("X");
  const photos = [row("image"), row("image")];
  const { issues, targets } = validateBatch({
    userId,
    connections: [yt, x],
    media: photos,
    input: batch({
      mediaType: "photos",
      mediaIds: photos.map((p) => p.id),
      targets: [
        { socialConnectionId: yt.id, input: youtubeInput },
        { socialConnectionId: x.id, input: { text: "hi" } },
      ],
    }),
  });
  assert.deepEqual(fieldsFor(issues, yt.id), ["media"]);
  assert.match(issues.find((i) => i.socialConnectionId === yt.id)!.message, /doesn't support photo posts/);
  assert.deepEqual(fieldsFor(issues, x.id), [], "X accepts photos");
  assert.deepEqual(targets, [], "nothing is publishable while any target is invalid");
});

test("missing required YouTube fields are reported per field", () => {
  const yt = connection("YOUTUBE");
  const video = row("video");
  const { issues } = validateBatch({
    userId,
    connections: [yt],
    media: [video],
    input: batch({ mediaIds: [video.id], targets: [{ socialConnectionId: yt.id, input: { title: "" } }] }),
  });
  const fields = fieldsFor(issues, yt.id);
  assert.ok(fields.includes("title"), "empty title");
  assert.ok(fields.includes("privacyStatus"), "privacy required");
  assert.ok(fields.includes("madeForKids"), "made-for-kids has no default and is required");

  const ok = validateBatch({
    userId,
    connections: [yt],
    media: [video],
    input: batch({ mediaIds: [video.id], targets: [{ socialConnectionId: yt.id, input: youtubeInput }] }),
  });
  assert.deepEqual(ok.issues, []);
  assert.equal(ok.targets[0]?.platform, "youtube");
});

test("photo count over the platform max is rejected; per-account subset fixes it", () => {
  const x = connection("X");
  const photos = Array.from({ length: 5 }, () => row("image"));
  const over = validateBatch({
    userId,
    connections: [x],
    media: photos,
    input: batch({ mediaType: "photos", mediaIds: photos.map((p) => p.id), targets: [{ socialConnectionId: x.id, input: {} }] }),
  });
  assert.match(over.issues[0]!.message, /at most 4 photos \(you picked 5\)/);

  const subset = validateBatch({
    userId,
    connections: [x],
    media: photos,
    input: batch({
      mediaType: "photos",
      mediaIds: photos.map((p) => p.id),
      targets: [{ socialConnectionId: x.id, input: {}, mediaIds: photos.slice(0, 4).map((p) => p.id) }],
    }),
  });
  assert.deepEqual(subset.issues, []);
});

test("thumbnail only where supported, and other users' media is refused", () => {
  const x = connection("X");
  const yt = connection("YOUTUBE");
  const video = row("video");
  const thumb = row("image");
  const theirs = { ...row("video"), userId: randomUUID() };
  const { issues } = validateBatch({
    userId,
    connections: [x, yt],
    media: [video, thumb, theirs],
    input: batch({
      mediaIds: [video.id],
      thumbnailByConnection: { [x.id]: thumb.id, [yt.id]: thumb.id },
      targets: [
        { socialConnectionId: x.id, input: {} },
        { socialConnectionId: yt.id, input: youtubeInput },
      ],
    }),
  });
  assert.match(issues.find((i) => i.socialConnectionId === x.id)!.message, /doesn't take a custom thumbnail/);
  assert.deepEqual(fieldsFor(issues, yt.id), []);

  const foreign = validateBatch({
    userId,
    connections: [yt],
    media: [theirs],
    input: batch({ mediaIds: [theirs.id], targets: [{ socialConnectionId: yt.id, input: youtubeInput }] }),
  });
  assert.ok(foreign.issues.some((i) => /wasn't found in your library/.test(i.message)));
});

// ---------------------------------------------------------------------------
// Idempotency (DB)
// ---------------------------------------------------------------------------

let dbUser: string;
let connectionId: string;
let videoId: string;
before(async () => {
  const [user] = await db
    .insert(users)
    .values({ clerkId: `user_test_${randomUUID()}`, email: `publish-${randomUUID()}@example.com` })
    .returning({ id: users.id });
  dbUser = user!.id;
  const [conn] = await db
    .insert(socialConnections)
    .values({
      userId: dbUser,
      provider: "YOUTUBE",
      providerAccountId: `UC${randomUUID().slice(0, 8)}`,
      accessTokenEncrypted: "v1.test",
      refreshTokenEncrypted: "v1.test",
    })
    .returning({ id: socialConnections.id });
  connectionId = conn!.id;
  const [video] = await db
    .insert(media)
    .values({
      userId: dbUser,
      name: "clip",
      type: "video",
      status: "ready",
      mimeType: "video/mp4",
      sizeBytes: 1000,
      durationSeconds: 30,
      s3Bucket: "b",
      s3Key: `test/${randomUUID()}`,
      s3Region: "r",
    })
    .returning({ id: media.id });
  videoId = video!.id;
});
after(async () => {
  await db.delete(users).where(eq(users.id, dbUser));
});

test("same idempotency key → same batch, no duplicate posts", async () => {
  const input = {
    idempotencyKey: `test-${randomUUID()}`,
    mediaType: "video" as const,
    mediaIds: [videoId],
    targets: [{ socialConnectionId: connectionId, input: youtubeInput }],
  };
  const first = await publishBatch(dbUser, input);
  const second = await publishBatch(dbUser, input);
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.batchId, first.batchId);
  assert.deepEqual(second.posts.map((p) => p.id), first.posts.map((p) => p.id));

  const rows = await db.select().from(posts).where(eq(posts.batchId, first.batchId));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, "queued");
  assert.equal(rows[0]!.caption, "GraphQL vs REST");
  const links = await db.select().from(postMedia).where(eq(postMedia.postId, rows[0]!.id));
  assert.deepEqual(links.map((l) => [l.role, l.position]), [["video", 0]]);

  await assert.rejects(
    () => publishBatch(dbUser, { ...input, idempotencyKey: `test-${randomUUID()}`, targets: [{ socialConnectionId: connectionId, input: {} }] }),
    (error: unknown) => error instanceof AppError && error.code === "VALIDATION",
  );
});

test("Facebook '(#100) No permission to publish the video' → missing_video_permission, not retried", async () => {
  const { ProviderError } = await import("@repo/providers");
  const { classifyPublishError } = await import("../publishing/run");
  const result = classifyPublishError(
    new ProviderError({ provider: "FACEBOOK", code: "BAD_REQUEST", status: 400, providerCode: "100", message: "(#100) No permission to publish the video" }),
  );
  assert.deepEqual(result, {
    kind: "permanent",
    code: "missing_video_permission",
    message: "Facebook didn't grant video publishing. Reconnect Facebook and approve all permissions.",
  });
});

test("LinkedIn 'Not enough permissions … registerUpload' → missing_post_permission, not retried", async () => {
  const { ProviderError } = await import("@repo/providers");
  const { classifyPublishError } = await import("../publishing/run");
  const result = classifyPublishError(
    new ProviderError({ provider: "LINKEDIN", code: "FORBIDDEN", status: 403, message: "Not enough permissions to access: assets.ACTION-registerUpload.NO_VERSION" }),
  );
  assert.equal(result.kind, "permanent");
  assert.equal(result.code, "missing_post_permission");
  assert.match(result.message, /Reconnect LinkedIn/);
});
