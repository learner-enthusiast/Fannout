import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LinkedInProvider } from "../linkedin";
import { json, mockFetch, noSleep } from "./helpers";

const asset = "urn:li:digitalmediaAsset:C5522AQGTYER3k3ByHQ";
const registered = json({
  value: {
    uploadMechanism: {
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": {
        headers: { "media-type-family": "VIDEO" },
        uploadUrl: "https://api.linkedin.com/mediaUpload/C5522AQGTYER3k3ByHQ/feedshare-uploadedVideo/0?ca=vector_feedshare",
      },
    },
    asset,
  },
});

describe("LinkedIn Share on LinkedIn (UGC)", () => {
  test("video: registerUpload → PUT binary → wait for AVAILABLE → ugcPosts", async () => {
    const m = mockFetch(
      registered,
      json(null, 201),
      json({ recipes: [{ recipe: "urn:li:digitalmediaRecipe:feedshare-video", status: "PROCESSING" }] }),
      json({ recipes: [{ recipe: "urn:li:digitalmediaRecipe:feedshare-video", status: "AVAILABLE" }] }),
      json(null, 201, { "x-restli-id": "urn:li:ugcPost:7000" }),
    );
    const p = new LinkedInProvider({ accessToken: "t", fetch: m.fetch, sleep: noSleep });

    const { asset: uploaded } = await p.uploadUgcAsset({
      owner: "urn:li:person:abc",
      kind: "video",
      source: { type: "buffer", data: new Uint8Array([1, 2, 3]), mimeType: "video/mp4" },
    });
    assert.equal(uploaded, asset);
    await p.waitForAsset(uploaded);
    const created = await p.createUgcPost({
      author: "urn:li:person:abc",
      commentary: "Hello",
      visibility: "CONNECTIONS",
      mediaCategory: "VIDEO",
      media: [{ asset: uploaded, title: "Demo" }],
    });
    assert.deepEqual(created, { id: "urn:li:ugcPost:7000" });

    const [register, upload, poll1, , post] = m.calls;
    assert.equal(register!.method, "POST");
    assert.match(register!.url.href, /^https:\/\/api\.linkedin\.com\/v2\/assets\?action=registerUpload$/);
    assert.equal(register!.headers.get("x-restli-protocol-version"), "2.0.0");
    assert.deepEqual(register!.json, {
      registerUploadRequest: {
        recipes: ["urn:li:digitalmediaRecipe:feedshare-video"],
        owner: "urn:li:person:abc",
        serviceRelationships: [{ relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" }],
      },
    });
    assert.equal(upload!.method, "PUT");
    assert.match(upload!.url.href, /mediaUpload\/C5522AQGTYER3k3ByHQ/);
    assert.equal(upload!.headers.get("authorization"), "Bearer t");
    assert.equal(upload!.headers.get("media-type-family"), "VIDEO");
    assert.match(poll1!.url.href, /\/v2\/assets\/C5522AQGTYER3k3ByHQ$/);
    assert.match(post!.url.href, /\/v2\/ugcPosts$/);
    assert.deepEqual(post!.json, {
      author: "urn:li:person:abc",
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: "Hello" },
          shareMediaCategory: "VIDEO",
          media: [{ status: "READY", media: asset, title: { text: "Demo" } }],
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "CONNECTIONS" },
    });
  });

  test("images: feedshare-image recipe, several media entries; bad shapes rejected locally", async () => {
    const m = mockFetch(json({ value: { ...(registered.body as { value: object }).value } }));
    const p = new LinkedInProvider({ accessToken: "t", fetch: m.fetch, sleep: noSleep });
    await p.registerUpload({ owner: "urn:li:person:abc", kind: "image" });
    assert.deepEqual((m.calls[0]!.json as { registerUploadRequest: { recipes: string[] } }).registerUploadRequest.recipes, [
      "urn:li:digitalmediaRecipe:feedshare-image",
    ]);
    await assert.rejects(
      p.createUgcPost({ author: "urn:li:person:abc", commentary: "x", mediaCategory: "VIDEO", media: [{ asset }, { asset }] }),
      /exactly one video/,
    );
    await assert.rejects(p.createUgcPost({ author: "urn:li:person:abc", commentary: "x", mediaCategory: "IMAGE" }), /media is required/);
    assert.equal(m.calls.length, 1);
  });

  test("a processing failure stops the wait", async () => {
    const m = mockFetch(json({ recipes: [{ recipe: "urn:li:digitalmediaRecipe:feedshare-video", status: "CLIENT_ERROR" }] }));
    const p = new LinkedInProvider({ accessToken: "t", fetch: m.fetch, sleep: noSleep });
    await assert.rejects(p.waitForAsset(asset), /couldn't process the upload/);
  });
});
