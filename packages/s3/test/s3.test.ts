import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { after, test } from "node:test";
import {
  assertSafeKey,
  buildObjectKey,
  closeS3,
  copyObject,
  deleteObject,
  deleteObjects,
  deletePrefix,
  downloadObject,
  downloadObjectAsBuffer,
  getDownloadUrl,
  getUploadUrl,
  headObject,
  listObjects,
  moveObject,
  objectExists,
  updateObject,
  updateObjectMetadata,
  uploadObject,
} from "..";

// Needs S3/MinIO from .env (docker compose up -d minio minio-init).
const prefix = `test/${randomUUID()}`;
after(async () => {
  await deletePrefix(prefix);
  closeS3();
});

test("upload, head, download and delete", async () => {
  const key = `${prefix}/hello.txt`;
  const uploaded = await uploadObject(key, "hello world", {
    contentType: "text/plain",
    metadata: { owner: "test" },
  });
  assert.ok(uploaded.etag);

  const head = await headObject(key);
  assert.equal(head?.contentType, "text/plain");
  assert.equal(head?.contentLength, 11);
  assert.equal(head?.metadata.owner, "test");

  assert.equal((await downloadObjectAsBuffer(key))?.toString(), "hello world");
  const ranged = await downloadObject(key, { range: "bytes=0-4" });
  const chunks: Buffer[] = [];
  for await (const chunk of ranged!.body) chunks.push(Buffer.from(chunk as Uint8Array));
  assert.equal(Buffer.concat(chunks).toString(), "hello");

  await deleteObject(key);
  assert.equal(await objectExists(key), false);
  assert.equal(await downloadObject(key), null);
  assert.equal(await headObject(key), null);
});

test("streams large bodies as multipart uploads", async () => {
  const key = `${prefix}/big.bin`;
  const size = 12 * 1024 * 1024; // > 1 part of 5 MiB
  const data = Buffer.alloc(size, 7);
  await uploadObject(key, Readable.from([data.subarray(0, size / 2), data.subarray(size / 2)]), {
    contentType: "application/octet-stream",
    partSize: 5 * 1024 * 1024,
  });
  assert.equal((await headObject(key))?.contentLength, size);
});

test("updateObject replaces content, keeps metadata, and supports If-Match", async () => {
  const key = `${prefix}/doc.json`;
  const first = await uploadObject(key, '{"v":1}', {
    contentType: "application/json",
    metadata: { kind: "doc" },
  });
  const second = await updateObject(key, '{"v":2}', { ifMatch: first.etag! });
  assert.equal((await downloadObjectAsBuffer(key))?.toString(), '{"v":2}');
  const head = await headObject(key);
  assert.equal(head?.contentType, "application/json");
  assert.equal(head?.metadata.kind, "doc");

  // Stale ETag → precondition failed, content unchanged.
  await assert.rejects(updateObject(key, '{"v":3}', { ifMatch: first.etag! }));
  assert.equal((await downloadObjectAsBuffer(key))?.toString(), '{"v":2}');
  assert.ok(second.etag);

  await assert.rejects(updateObject(`${prefix}/missing.json`, "{}"));
});

test("updateObjectMetadata changes headers without re-uploading", async () => {
  const key = `${prefix}/image.png`;
  await uploadObject(key, Buffer.from([1, 2, 3]), { contentType: "application/octet-stream" });
  const updated = await updateObjectMetadata(key, {
    contentType: "image/png",
    metadata: { alt: "logo" },
  });
  assert.equal(updated.contentType, "image/png");
  assert.equal(updated.metadata.alt, "logo");
  assert.deepEqual([...(await downloadObjectAsBuffer(key))!], [1, 2, 3]);
});

test("copy, move, list and batch delete", async () => {
  await uploadObject(`${prefix}/a/1.txt`, "1");
  await copyObject(`${prefix}/a/1.txt`, `${prefix}/a/2.txt`);
  await moveObject(`${prefix}/a/2.txt`, `${prefix}/b/2.txt`);
  const listed = await listObjects({ prefix: `${prefix}/` });
  const keys = listed.objects.map((o) => o.key);
  assert.ok(keys.includes(`${prefix}/a/1.txt`));
  assert.ok(keys.includes(`${prefix}/b/2.txt`));
  assert.ok(!keys.includes(`${prefix}/a/2.txt`));

  const failed = await deleteObjects([`${prefix}/a/1.txt`, `${prefix}/b/2.txt`]);
  assert.deepEqual(failed, []);
  assert.equal(await objectExists(`${prefix}/a/1.txt`), false);
});

test("presigned upload and download URLs work from a plain HTTP client", async () => {
  const key = `${prefix}/presigned.txt`;
  const upload = await getUploadUrl(key, { contentType: "text/plain", expiresIn: 60 });
  const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: "via url" });
  assert.equal(put.status, 200);

  const url = await getDownloadUrl(key, { expiresIn: 60, downloadAs: "report final.txt" });
  const get = await fetch(url);
  assert.equal(get.status, 200);
  assert.equal(await get.text(), "via url");
  assert.match(get.headers.get("content-disposition") ?? "", /attachment/);

  await assert.rejects(getDownloadUrl(key, { expiresIn: 8 * 24 * 60 * 60 }));
});

test("object keys are generated safely and unsafe keys are rejected", async () => {
  const key = buildObjectKey("media/user-1", "../../My Photo (1).JPG", new Date("2026-11-05"));
  assert.match(key, /^media\/user-1\/2026\/11\/[0-9a-f-]{36}-my-photo-1\.jpg$/);
  for (const bad of ["", "/abs", "a/../b", "a/./b", "line\nbreak"]) {
    assert.throws(() => assertSafeKey(bad), bad);
  }
  await assert.rejects(uploadObject("../escape", "x"));
  await assert.rejects(deletePrefix(""));
});
