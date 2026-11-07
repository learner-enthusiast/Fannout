import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, test } from "node:test";
import { ProviderError } from "../common/provider-error";
import { ThreadsProvider } from "../threads";
import { json, mockFetch, noSleep } from "./helpers";

const USER = "1234567890";
const make = (m: ReturnType<typeof mockFetch>, accessToken: ConstructorParameters<typeof ThreadsProvider>[0]["accessToken"] = "tok") =>
  new ThreadsProvider({ accessToken, userId: USER, fetch: m.fetch, sleep: noSleep });

describe("ThreadsProvider", () => {
  test("constructor makes no network calls and rejects a non-numeric user id", () => {
    const m = mockFetch();
    make(m);
    assert.equal(m.calls.length, 0);
    assert.throws(() => new ThreadsProvider({ accessToken: "t", userId: "me" }), (e: unknown) => e instanceof ProviderError && e.code === "VALIDATION");
  });

  test("getAuthenticatedAccount reads the configured user with the token as access_token", async () => {
    const m = mockFetch(json({ id: USER, username: "alice", name: "Alice", threads_profile_picture_url: "https://x/p.jpg" }));
    const account = await make(m).getAuthenticatedAccount();
    assert.deepEqual(account, { provider: "THREADS", id: USER, username: "alice", displayName: "Alice", profilePictureUrl: "https://x/p.jpg" });
    const call = m.calls[0]!;
    assert.equal(call.url.origin + call.url.pathname, `https://graph.threads.net/v1.0/${USER}`);
    assert.equal(call.url.searchParams.get("access_token"), "tok");
    assert.equal(call.url.searchParams.get("fields"), "id,username,name,threads_profile_picture_url");
    assert.equal(call.headers.get("authorization"), null);
  });

  test("publishText creates a TEXT container then publishes it", async () => {
    const m = mockFetch(json({ id: "111" }), json({ id: "222" }));
    const result = await make(m).publishText({ text: "hello", reply_control: "everyone", poll_attachment: { option_a: "A", option_b: "B" } });
    assert.deepEqual(result, { containerId: "111", mediaId: "222" });
    const [create, publish] = m.calls;
    assert.equal(create!.method, "POST");
    assert.equal(create!.url.pathname, `/v1.0/${USER}/threads`);
    assert.equal(create!.form!.get("media_type"), "TEXT");
    assert.equal(create!.form!.get("text"), "hello");
    assert.deepEqual(JSON.parse(create!.form!.get("poll_attachment")!), { option_a: "A", option_b: "B" });
    assert.equal(publish!.url.pathname, `/v1.0/${USER}/threads_publish`);
    assert.equal(publish!.form!.get("creation_id"), "111");
  });

  test("auto_publish_text skips the publish step", async () => {
    const m = mockFetch(json({ id: "333" }));
    assert.deepEqual(await make(m).publishText({ text: "hi", auto_publish_text: true }), { containerId: "333", mediaId: "333" });
    assert.equal(m.calls.length, 1);
  });

  test("validation runs before any request", async () => {
    const m = mockFetch();
    const p = make(m);
    await assert.rejects(p.publishText({ text: "x".repeat(501) }), /VALIDATION|Invalid input/);
    await assert.rejects(p.publishText({ text: "hi", topic_tag: "a.b" }), /Topic tags/);
    await assert.rejects(p.publishText({ text: "hi", poll_attachment: { option_a: "A", option_b: "B" }, text_attachment: { plaintext: "x" } }), /poll/);
    await assert.rejects(p.createContainer({ media_type: "IMAGE" } as never), /image_url/);
    await assert.rejects(p.listThreads({ before: "a", after: "b" }), /before/);
    await assert.rejects(p.listThreads({ limit: 101 }), /limit/);
    await assert.rejects(p.getUserInsights({ metric: ["followers_count"], since: 1712991600 }), /since\/until/);
    await assert.rejects(p.getUserInsights({ metric: ["views"], breakdown: "country" }), /breakdown/);
    await assert.rejects(p.searchLocations({ latitude: 1 }), /together/);
    await assert.rejects(p.getOEmbed({ url: "https://example.com/x" }), /permalink/);
    assert.equal(m.calls.length, 0);
  });

  test("publishVideo polls the container until FINISHED", async () => {
    const m = mockFetch(json({ id: "10" }), json({ id: "10", status: "IN_PROGRESS" }), json({ id: "10", status: "FINISHED" }), json({ id: "20" }));
    const result = await make(m).publishVideo({ video_url: "https://cdn.example.com/v.mp4", text: "clip" });
    assert.deepEqual(result, { containerId: "10", mediaId: "20" });
    assert.equal(m.calls[1]!.url.searchParams.get("fields"), "id,status,error_message");
  });

  test("container ERROR surfaces the error_message", async () => {
    const m = mockFetch(json({ id: "10" }), json({ id: "10", status: "ERROR", error_message: "INVALID_DURATION" }));
    await assert.rejects(make(m).publishVideo({ video_url: "https://cdn.example.com/v.mp4" }), (e: unknown) => {
      assert.ok(e instanceof ProviderError);
      assert.equal(e.providerCode, "INVALID_DURATION");
      return true;
    });
    assert.equal(m.calls.length, 2);
  });

  test("waitForContainer times out after maxAttempts", async () => {
    const m = mockFetch(json({ id: "1", status: "IN_PROGRESS" }), json({ id: "1", status: "IN_PROGRESS" }));
    await assert.rejects(make(m).waitForContainer("1", { maxAttempts: 2 }), (e: unknown) => e instanceof ProviderError && e.code === "TIMEOUT");
  });

  test("publishCarousel creates items with is_carousel_item, then the parent", async () => {
    const m = mockFetch(
      json({ id: "1" }),
      json({ id: "2" }),
      json({ id: "2", status: "FINISHED" }),
      json({ id: "3" }),
      json({ id: "3", status: "FINISHED" }),
      json({ id: "4" }),
    );
    const res = await make(m).publishCarousel({
      text: "album",
      items: [
        { media_type: "IMAGE", image_url: "https://cdn.example.com/a.jpg" },
        { media_type: "VIDEO", video_url: "https://cdn.example.com/b.mp4" },
      ],
    });
    assert.deepEqual(res, { containerId: "3", mediaId: "4" });
    assert.equal(m.calls[0]!.form!.get("is_carousel_item"), "true");
    const parent = m.calls[3]!.form!;
    assert.equal(parent.get("media_type"), "CAROUSEL");
    assert.equal(parent.get("children"), "1,2");
    assert.equal(parent.get("text"), "album");
  });

  test("createReply and createQuotePost send reply_to_id / quote_post_id", async () => {
    const m = mockFetch(json({ id: "1" }), json({ id: "2" }), json({ id: "3" }), json({ id: "4" }));
    const p = make(m);
    await p.createReply({ text: "re", reply_to_id: "99" });
    await p.createQuotePost({ text: "q", quote_post_id: "98" });
    assert.equal(m.calls[0]!.form!.get("reply_to_id"), "99");
    assert.equal(m.calls[2]!.form!.get("quote_post_id"), "98");
  });

  test("list endpoints map Graph paging to cursors", async () => {
    const m = mockFetch(
      json({ data: [{ id: "1", text: "a" }], paging: { cursors: { before: "B", after: "A" }, next: "https://next" } }),
      json({ data: [{ id: "2" }], paging: { cursors: { before: "B2", after: "A2" } } }),
    );
    const p = make(m);
    const first = await p.listThreads({ fields: ["id", "text"], limit: 1, since: 1700000000 });
    assert.equal(first.nextCursor, "A");
    assert.equal(m.calls[0]!.url.searchParams.get("fields"), "id,text");
    assert.equal(m.calls[0]!.url.searchParams.get("since"), "1700000000");
    const second = await p.listReplies({ mediaId: "5", after: "A", reverse: false });
    assert.equal(second.nextCursor, null);
    assert.equal(m.calls[1]!.url.pathname, "/v1.0/5/replies");
    assert.equal(m.calls[1]!.url.searchParams.get("reverse"), "false");
  });

  test("reply management, delete, repost, insights, search", async () => {
    const m = mockFetch(
      json({ success: true }),
      json({ success: true }),
      json({ success: true, deleted_id: "7" }),
      json({ id: "8" }),
      json({ data: [{ name: "views", period: "lifetime", values: [{ value: 10 }] }] }),
      json({ data: [{ name: "clicks", period: "day", link_total_values: [{ value: 3, link_url: "https://a" }] }] }),
      json({ data: [{ id: "9", text: "found" }] }),
      json({ username: "meta", follower_count: 1000 }),
      json({ data: [{ id: "L1", name: "Cafe" }] }),
      json({ html: "<blockquote/>", version: "1.0" }),
    );
    const p = make(m);
    assert.equal(await p.hideReply("1"), true);
    assert.equal(await p.managePendingReply({ replyId: "2", approve: false }), true);
    assert.deepEqual(await p.deletePost("7"), { success: true, deleted_id: "7" });
    assert.deepEqual(await p.repost("3"), { id: "8" });
    assert.equal((await p.getMediaInsights({ mediaId: "3", metric: ["views", "likes"] }))[0]!.name, "views");
    assert.equal((await p.getUserInsights({ metric: ["clicks"] }))[0]!.link_total_values![0]!.value, 3);
    assert.equal((await p.keywordSearch({ q: "cats", search_type: "RECENT" })).items[0]!.id, "9");
    assert.equal((await p.lookupProfile({ username: "meta" })).follower_count, 1000);
    assert.equal((await p.searchLocations({ query: "cafe" }))[0]!.name, "Cafe");
    await p.getOEmbed({ url: "https://www.threads.com/@meta/post/abc" });

    assert.equal(m.calls[0]!.url.pathname, "/v1.0/1/manage_reply");
    assert.equal(m.calls[0]!.form!.get("hide"), "true");
    assert.equal(m.calls[1]!.form!.get("approve"), "false");
    assert.equal(m.calls[2]!.method, "DELETE");
    assert.equal(m.calls[3]!.url.pathname, "/v1.0/3/repost");
    assert.equal(m.calls[4]!.url.searchParams.get("metric"), "views,likes");
    assert.equal(m.calls[5]!.url.pathname, `/v1.0/${USER}/threads_insights`);
    assert.equal(m.calls[6]!.url.searchParams.get("q"), "cats");
    const oembed = m.calls[9]!;
    assert.equal(oembed.url.host, "www.threads.com");
    assert.equal(oembed.url.searchParams.get("access_token"), null, "token must not be sent to the oEmbed host");
  });

  test("Graph errors are normalised; 401 triggers one token refresh", async () => {
    const m = mockFetch(
      json({ error: { message: "Expired", code: 190, error_subcode: 463 } }, 401),
      json({ id: USER, username: "alice" }),
      json({ error: { message: "Bad param", code: 100 } }, 400),
    );
    let refreshed = 0;
    const p = make(m, { getAccessToken: async () => "old", refreshAccessToken: async () => (refreshed++, "new") });
    await p.getProfile();
    assert.equal(refreshed, 1);
    assert.equal(m.calls[1]!.url.searchParams.get("access_token"), "new");
    await assert.rejects(p.getPost({ mediaId: "1" }), (e: unknown) => {
      assert.ok(e instanceof ProviderError);
      assert.equal(e.code, "BAD_REQUEST");
      assert.equal(e.providerCode, "100");
      assert.equal(e.message, "Bad param");
      return true;
    });
  });

  test("429 on GET is retried with backoff", async () => {
    const m = mockFetch(json({ error: { message: "slow down", code: 4 } }, 429), json({ id: USER }));
    await make(m).getProfile();
    assert.equal(m.calls.length, 2);
  });

  test("webhook helpers verify subscription, signature and payload", () => {
    assert.equal(ThreadsProvider.verifyWebhookSubscription({ "hub.mode": "subscribe", "hub.verify_token": "v", "hub.challenge": "c" }, "v"), "c");
    assert.equal(ThreadsProvider.verifyWebhookSubscription({ "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "c" }, "v"), null);
    const body = JSON.stringify({ app_id: "1", topic: "moderate", values: { field: "replies", value: { id: "2" } } });
    const sig = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    assert.equal(ThreadsProvider.verifyWebhookSignature(body, sig, "secret"), true);
    assert.equal(ThreadsProvider.verifyWebhookSignature(body, sig, "other"), false);
    assert.equal(ThreadsProvider.parseWebhookEvent(JSON.parse(body)).values.field, "replies");
    assert.throws(() => ThreadsProvider.parseWebhookEvent({}), ProviderError);
  });
});
