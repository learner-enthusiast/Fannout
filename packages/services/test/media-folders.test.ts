import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { db, eq, media, mediaFolders, users } from "@repo/database";
import { AppError } from "@repo/errors";
import { listFolders } from "../media-folders";
import { assertRoleFits, planAdditions, validateFolderItems, type Link } from "../media-folders/rules";
import { buildFolderSuggestion, parseSocialPackage } from "../media/social-package";
import { summarizeSubtitles } from "../media/subtitles";
import { unifiedSearch } from "../search";

const fixture = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/graphql-vs-rest_social.json"), "utf8"),
);
const fails = (fn: () => unknown, pattern: RegExp) =>
  assert.throws(fn, (error: unknown) => error instanceof AppError && pattern.test(error.message));

test("role ↔ type: main/trailer=video, thumbnail=image, subtitles=subtitle, social_json=json, other=any+label", () => {
  for (const role of ["main_landscape", "main_portrait", "trailer_landscape", "trailer_portrait"] as const) {
    assertRoleFits(role, "video");
    fails(() => assertRoleFits(role, "image"), /needs a video/);
  }
  assertRoleFits("thumbnail", "image");
  fails(() => assertRoleFits("thumbnail", "video"), /needs an image/);
  assertRoleFits("subtitles", "subtitle");
  fails(() => assertRoleFits("subtitles", "json"), /needs a subtitle/);
  assertRoleFits("social_json", "json");
  fails(() => assertRoleFits("social_json", "subtitle"), /needs a JSON/);
  assertRoleFits("other", "video", "B-roll");
  assertRoleFits("other", "json", "Notes");
  fails(() => assertRoleFits("other", "image"), /need a label/);
});

test("same user: folder and every media must belong to the user", () => {
  const userId = randomUUID();
  const mine = { id: randomUUID(), userId, type: "image" as const };
  const theirs = { id: randomUUID(), userId: randomUUID(), type: "image" as const };
  const item = (id: string) => ({ mediaId: id, role: "thumbnail" as const });

  validateFolderItems({ userId, folderUserId: userId, media: [mine], items: [item(mine.id)] });
  fails(
    () => validateFolderItems({ userId, folderUserId: randomUUID(), media: [mine], items: [item(mine.id)] }),
    /Folder not found/,
  );
  fails(
    () => validateFolderItems({ userId, folderUserId: userId, media: [theirs], items: [item(theirs.id)] }),
    /Media not found/,
  );
  fails(
    () =>
      validateFolderItems({
        userId,
        folderUserId: userId,
        media: [mine],
        items: [item(mine.id)],
        existingMediaIds: [mine.id],
      }),
    /already in this folder/,
  );
});

test("single primary per role", () => {
  const [a, b, c, d] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const primaries = (links: Link[], role = "thumbnail") =>
    links.filter((l) => l.role === role && l.isPrimary).map((l) => l.mediaId);

  // First item in an empty role becomes primary; positions append.
  const first = planAdditions([], [
    { mediaId: a, role: "thumbnail" },
    { mediaId: b, role: "thumbnail" },
    { mediaId: c, role: "main_landscape" },
  ]);
  assert.deepEqual(primaries(first.inserts), [a]);
  assert.deepEqual(primaries(first.inserts, "main_landscape"), [c]);
  assert.deepEqual(first.inserts.filter((l) => l.role === "thumbnail").map((l) => l.position), [0, 1]);
  assert.deepEqual(first.clearPrimaryRoles, []);

  // An explicit primary takes over the role and asks to clear the existing one.
  const existing = first.inserts;
  const next = planAdditions(existing, [{ mediaId: d, role: "thumbnail", isPrimary: true }]);
  assert.deepEqual(primaries(next.inserts), [d]);
  assert.equal(next.inserts[0]!.position, 2);
  assert.deepEqual(next.clearPrimaryRoles, ["thumbnail"]);

  // Two explicit primaries in one call: the last wins, only one survives.
  const both = planAdditions([], [
    { mediaId: a, role: "thumbnail", isPrimary: true },
    { mediaId: b, role: "thumbnail", isPrimary: true },
  ]);
  assert.deepEqual(primaries(both.inserts), [b]);
});

test("folder suggestion maps the fixture's files to uploads by filename", () => {
  const pkg = parseSocialPackage(fixture);
  assert.ok(pkg, "fixture is a social package");
  assert.equal(parseSocialPackage({ video: "x", files: { main: "a.mp4" } }), null, "platform keys required");

  const json = randomUUID();
  const day = (n: number) => new Date(Date.UTC(2026, 10, n));
  const upload = (originalFilename: string, type: "video" | "image" | "subtitle" | "json", n = 5) => ({
    id: randomUUID(),
    originalFilename,
    type,
    createdAt: day(n),
  });
  const main = upload("GraphQL-vs-REST_16x9.mp4", "video");
  const mainOld = upload("graphql-vs-rest_16x9.mp4", "video", 1);
  const portrait = upload("graphql-vs-rest_9x16.mp4", "video");
  const trailerL = upload("graphql-vs-rest_trailer_16x9.mp4", "video");
  const trailerP = upload("graphql-vs-rest_trailer_9x16.mp4", "video");
  const srt = upload("graphql-vs-rest.srt", "subtitle");
  const thumbWrongType = upload("graphql-vs-rest_thumbnail.png", "video", 9);
  const thumb = upload("graphql-vs-rest_thumbnail.png", "image");
  const unrelated = upload("other.mp4", "video");

  const suggestion = buildFolderSuggestion(pkg, json, [
    mainOld, main, portrait, trailerL, trailerP, srt, thumbWrongType, thumb, unrelated,
  ]);
  assert.equal(suggestion.folderName, "graphql-vs-rest");
  assert.deepEqual(suggestion.items, [
    { mediaId: main.id, role: "main_landscape" },
    { mediaId: portrait.id, role: "main_portrait" },
    { mediaId: trailerL.id, role: "trailer_landscape" },
    { mediaId: trailerP.id, role: "trailer_portrait" },
    { mediaId: srt.id, role: "subtitles" },
    { mediaId: thumb.id, role: "thumbnail" },
    { mediaId: json, role: "social_json" },
  ]);
});

test("subtitles: SRT parses to a summary, garbage is rejected", () => {
  const srt = "1\n00:00:01,000 --> 00:00:02,500\nHello\n\n2\n00:00:03,000 --> 00:00:04,250\nWorld\n";
  assert.deepEqual(summarizeSubtitles(srt, "srt"), { segments: 2, durationMs: 4250 });
  assert.deepEqual(summarizeSubtitles("WEBVTT\n\n00:01.000 --> 00:02.000\nhi\n", "vtt"), {
    segments: 1,
    durationMs: 2000,
  });
  assert.throws(() => summarizeSubtitles("just some text", "srt"), /No SRT cues/);
});

let userId: string;
before(async () => {
  const [user] = await db
    .insert(users)
    .values({ clerkId: `user_test_${randomUUID()}`, email: `folders-${randomUUID()}@example.com` })
    .returning({ id: users.id });
  userId = user!.id;
  await db.insert(mediaFolders).values([
    { userId, name: "graphql-vs-rest" },
    { userId, name: "kubernetes-basics" },
    { userId, name: "Rust for TS devs" },
  ]);
  await db.insert(media).values({
    userId,
    name: "graphql-vs-rest_9x16",
    type: "video",
    status: "ready",
    mimeType: "video/mp4",
    s3Bucket: "b",
    s3Key: `test/${randomUUID()}`,
    s3Region: "r",
  });
});
after(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

test("trigram search finds a folder by partial name", async () => {
  const result = await unifiedSearch(userId, { q: "graph" });
  assert.equal(result.folders[0]?.name, "graphql-vs-rest");
  assert.ok(!result.folders.some((f) => f.name === "kubernetes-basics"));
  assert.equal(result.media[0]?.name, "graphql-vs-rest_9x16");

  const page = await listFolders(userId, { q: "graph" });
  assert.deepEqual(page.items.map((f) => f.name), ["graphql-vs-rest"]);
});
