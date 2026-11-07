import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, test } from "node:test";
import { ProviderError } from "../common/provider-error";
import { FacebookProvider } from "../facebook";
import { json, mockFetch, noSleep } from "./helpers";

const PAGE = "1000";
const POST = `${PAGE}_2000`;
const make = (m: ReturnType<typeof mockFetch>, extra: Partial<ConstructorParameters<typeof FacebookProvider>[0]> = {}) =>
  new FacebookProvider({ accessToken: "page-token", pageId: PAGE, fetch: m.fetch, sleep: noSleep, ...extra });

async function* chunks(...parts: string[]) {
  for (const p of parts) yield new TextEncoder().encode(p);
}

describe("FacebookProvider", () => {
  test("constructor: no network, validates pageId, default version", () => {
    const m = mockFetch();
    const p = make(m);
    assert.equal(p.version, "v23.0");
    assert.equal(m.calls.length, 0);
    assert.throws(() => new FacebookProvider({ accessToken: "t", pageId: "me" }), ProviderError);
  });

  test("getAuthenticatedAccount reads the Page with access_token and appsecret_proof", async () => {
    const m = mockFetch(json({ id: PAGE, name: "Acme", username: "acme", picture: { data: { url: "https://p" } } }));
    const account = await make(m, { appSecret: "s3cret", version: "v24.0" }).getAuthenticatedAccount();
    assert.deepEqual(account, { provider: "FACEBOOK", id: PAGE, username: "acme", displayName: "Acme", profilePictureUrl: "https://p" });
    const call = m.calls[0]!;
    assert.equal(call.url.origin + call.url.pathname, `https://graph.facebook.com/v24.0/${PAGE}`);
    assert.equal(call.url.searchParams.get("access_token"), "page-token");
    assert.equal(call.url.searchParams.get("appsecret_proof"), createHmac("sha256", "s3cret").update("page-token").digest("hex"));
  });

  test("createPost validates then posts to /feed as form fields", async () => {
    const m = mockFetch(json({ id: POST }));
    const p = make(m);
    assert.deepEqual(
      await p.createPost({ message: "hi", link: "https://example.com", published: false, scheduled_publish_time: 1900000000, targeting: { geo_locations: { countries: ["US"] } } }),
      { id: POST },
    );
    const form = m.calls[0]!.form!;
    assert.equal(m.calls[0]!.url.pathname, `/v23.0/${PAGE}/feed`);
    assert.equal(form.get("message"), "hi");
    assert.equal(form.get("published"), "false");
    assert.deepEqual(JSON.parse(form.get("targeting")!), { geo_locations: { countries: ["US"] } });

    await assert.rejects(p.createPost({}), /message or link/);
    await assert.rejects(p.createPost({ message: "x", scheduled_publish_time: 1 }), /published=false/);
    await assert.rejects(p.createPost({ message: "x", tags: ["1"] }), /place/);
    await assert.rejects(p.updatePost({ postId: POST }), /Nothing to update/);
    await assert.rejects(p.getPost({ postId: "123" }), /page-id/);
    assert.equal(m.calls.length, 1);
  });

  test("post lifecycle: get, update, publish unpublished, delete", async () => {
    const m = mockFetch(json({ id: POST, message: "m", is_published: false }), json({ success: true }), json({ success: true }), json({ success: true }));
    const p = make(m);
    assert.equal((await p.getPost({ postId: POST, fields: ["message", "is_published"] })).is_published, false);
    assert.equal(await p.updatePost({ postId: POST, message: "edited" }), true);
    assert.equal(await p.publishUnpublishedPost(POST), true);
    assert.equal(await p.deletePost(POST), true);
    assert.equal(m.calls[0]!.url.searchParams.get("fields"), "message,is_published");
    assert.equal(m.calls[2]!.form!.get("is_published"), "true");
    assert.equal(m.calls[3]!.method, "DELETE");
  });

  test("uploadPhoto: url → url param; bytes → multipart source", async () => {
    const m = mockFetch(json({ id: "p1", post_id: POST }), json({ id: "p2" }));
    const p = make(m);
    await p.uploadPhoto({ media: { type: "url", url: "https://cdn/x.jpg" }, caption: "c" });
    assert.equal(m.calls[0]!.form!.get("url"), "https://cdn/x.jpg");
    await p.uploadPhoto({ media: { type: "buffer", data: new Uint8Array([1, 2, 3]), mimeType: "image/png" }, published: false, temporary: true });
    const body = m.calls[1]!.body as FormData;
    assert.ok(body instanceof FormData);
    assert.equal(body.get("published"), "false");
    assert.equal((body.get("source") as Blob).size, 3);
  });

  test("uploadVideo from URL uses file_url on graph-video", async () => {
    const m = mockFetch(json({ id: "v1" }));
    await make(m).uploadVideo({ media: { type: "url", url: "https://cdn/v.mp4" }, title: "t" });
    assert.equal(m.calls[0]!.url.host, "graph-video.facebook.com");
    assert.equal(m.calls[0]!.form!.get("file_url"), "https://cdn/v.mp4");
  });

  test("uploadVideo from a stream follows server-dictated offsets (start → transfer → finish)", async () => {
    const m = mockFetch(
      json({ video_id: "v9", upload_session_id: "s1", start_offset: "0", end_offset: "4" }),
      json({ start_offset: "4", end_offset: "10" }),
      json({ start_offset: "10", end_offset: "10" }),
      json({ success: true }),
    );
    const res = await make(m).uploadVideo({
      media: { type: "stream", stream: chunks("abc", "defg", "hij"), size: 10, mimeType: "video/mp4" },
      description: "d",
    });
    assert.deepEqual(res, { success: true, video_id: "v9" });
    assert.equal(m.calls[0]!.form!.get("upload_phase"), "start");
    assert.equal(m.calls[0]!.form!.get("file_size"), "10");
    const t1 = m.calls[1]!.body as FormData;
    const t2 = m.calls[2]!.body as FormData;
    assert.equal(t1.get("upload_phase"), "transfer");
    assert.equal(await (t1.get("video_file_chunk") as Blob).text(), "abcd");
    assert.equal(t2.get("start_offset"), "4");
    assert.equal(await (t2.get("video_file_chunk") as Blob).text(), "efghij");
    assert.equal(m.calls[3]!.form!.get("upload_phase"), "finish");
    assert.equal(m.calls[3]!.form!.get("upload_session_id"), "s1");
    assert.equal(m.calls[3]!.form!.get("description"), "d");
  });

  test("a failed transfer cancels the upload session", async () => {
    const m = mockFetch(
      json({ video_id: "v9", upload_session_id: "s1", start_offset: "0", end_offset: "3" }),
      json({ error: { message: "boom", code: 6000 } }, 400),
      json({ success: true }),
    );
    await assert.rejects(make(m).uploadVideo({ media: { type: "buffer", data: new Uint8Array(3), mimeType: "video/mp4" } }), ProviderError);
    assert.equal(m.calls[2]!.form!.get("upload_phase"), "cancel");
  });

  test("publishReel: start → rupload with OAuth header → finish", async () => {
    const m = mockFetch(
      json({ video_id: "501", upload_url: "https://rupload.facebook.com/video-upload/v23.0/501" }),
      json({ success: true }),
      json({ success: true, post_id: "pp" }),
    );
    const res = await make(m).publishReel({
      media: { type: "buffer", data: new Uint8Array([1, 2]), mimeType: "video/mp4" },
      video_state: "PUBLISHED",
      description: "#reel",
    });
    assert.deepEqual(res, { success: true, post_id: "pp", video_id: "501" });
    const upload = m.calls[1]!;
    assert.equal(upload.url.host, "rupload.facebook.com");
    assert.equal(upload.headers.get("authorization"), "OAuth page-token");
    assert.equal(upload.headers.get("file_size"), "2");
    assert.equal(upload.headers.get("offset"), "0");
    assert.equal(upload.url.searchParams.get("access_token"), null);
    assert.equal(m.calls[2]!.form!.get("upload_phase"), "finish");
    assert.equal(m.calls[2]!.form!.get("video_id"), "501");
  });

  test("reel scheduling rules are validated", async () => {
    const p = make(mockFetch());
    await assert.rejects(p.finishReel({ video_id: "1", video_state: "SCHEDULED" }), /SCHEDULED/);
    await assert.rejects(p.finishReel({ video_id: "1", video_state: "PUBLISHED", scheduled_publish_time: 1 }), /SCHEDULED/);
  });

  test("comments: list with summary, create, reply, hide, delete", async () => {
    const m = mockFetch(
      json({ data: [{ id: "601", message: "hey" }], paging: { cursors: { after: "N" }, next: "https://n" }, summary: { total_count: 5, order: "chronological" } }),
      json({ id: "602" }),
      json({ id: "603" }),
      json({ success: true }),
      json({ success: true }),
    );
    const p = make(m);
    const page = await p.listComments({ objectId: POST, filter: "stream", summary: true, limit: 25 });
    assert.equal(page.nextCursor, "N");
    assert.equal(page.summary?.total_count, 5);
    await p.createComment({ objectId: POST, message: "thanks" });
    await p.replyToComment("601", { message: "reply" });
    assert.equal(await p.hideComment("601"), true);
    assert.equal(await p.deleteComment("601"), true);
    assert.equal(m.calls[0]!.url.searchParams.get("filter"), "stream");
    assert.equal(m.calls[2]!.url.pathname, "/v23.0/601/comments");
    assert.equal(m.calls[3]!.form!.get("is_hidden"), "true");
    await assert.rejects(p.createComment({ objectId: POST }), /message or an attachment/);
  });

  test("reactions, likes, insights, feed, tagged, subscriptions", async () => {
    const m = mockFetch(
      json({ data: [{ id: "u", type: "LOVE" }], summary: { total_count: 1 } }),
      json({ success: true }),
      json({ success: true }),
      json({ data: [{ name: "page_follows", period: "day", values: [{ value: 3, end_time: "2026-01-01" }] }] }),
      json({ data: [{ name: "post_reactions_by_type_total", period: "lifetime", values: [{ value: { like: 2 } }] }] }),
      json({ data: [{ id: POST, message: "x" }] }),
      json({ data: [{ id: "9_9", tagged_time: "2026-01-01" }] }),
      json({ success: true }),
      json({ data: [{ id: "app", subscribed_fields: ["feed"] }] }),
    );
    const p = make(m);
    assert.equal((await p.listReactions({ objectId: POST, type: "LOVE", summary: ["total_count"] })).summary?.total_count, 1);
    assert.equal(await p.like(POST), true);
    assert.equal(await p.unlike(POST), true);
    assert.equal((await p.getPageInsights({ metric: ["page_follows"], period: "day" })).items[0]!.values![0]!.value, 3);
    assert.deepEqual((await p.getPostInsights({ postId: POST, metric: ["post_reactions_by_type_total"] })).items[0]!.values![0]!.value, { like: 2 });
    assert.equal((await p.listFeed({ limit: 10 })).items.length, 1);
    assert.equal((await p.listTagged()).items[0]!.tagged_time, "2026-01-01");
    assert.equal(await p.subscribeApp({ subscribed_fields: ["feed", "mention"] }), true);
    assert.deepEqual((await p.listSubscribedApps())[0]!.subscribed_fields, ["feed"]);
    assert.equal(m.calls[2]!.method, "DELETE");
    assert.equal(m.calls[2]!.url.pathname, `/v23.0/${POST}/likes`);
    assert.equal(m.calls[3]!.url.searchParams.get("metric"), "page_follows");
    assert.equal(m.calls[7]!.form!.get("subscribed_fields"), "feed,mention");
    await assert.rejects(p.listFeed({ limit: 101 }), ProviderError);
  });

  test("Graph error and rate-limit headers are surfaced", async () => {
    const usage = JSON.stringify({ call_count: 99, total_time: 10, total_cputime: 10 });
    const m = mockFetch(json({ error: { message: "Limit", code: 4 } }, 400, { "x-app-usage": usage }));
    await assert.rejects(make(m).getPage(), (e: unknown) => {
      assert.ok(e instanceof ProviderError);
      assert.equal(e.providerCode, "4");
      assert.deepEqual((e.rateLimit?.usage as { app: unknown }).app, JSON.parse(usage));
      return true;
    });
  });

  test("webhook payload parsing and signature", () => {
    const body = JSON.stringify({ object: "page", entry: [{ id: PAGE, time: 1, changes: [{ field: "feed", value: { item: "comment" } }] }] });
    const sig = `sha256=${createHmac("sha256", "app").update(body).digest("hex")}`;
    assert.equal(FacebookProvider.verifyWebhookSignature(body, sig, "app"), true);
    assert.equal(FacebookProvider.verifyWebhookSignature(body, "sha256=00", "app"), false);
    assert.equal(FacebookProvider.parseWebhookPayload(JSON.parse(body)).entry[0]!.changes![0]!.field, "feed");
    assert.throws(() => FacebookProvider.parseWebhookPayload({ object: "page" }), ProviderError);
  });
});
