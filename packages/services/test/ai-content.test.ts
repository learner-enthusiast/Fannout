import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AiClient } from "@repo/ai";
import { db, eq, users } from "@repo/database";
import { AppError } from "@repo/errors";
import { xWeightedLength } from "@repo/providers";
import { createGeneration } from "../ai-content";
import { runGeneration, type GenerationTarget } from "../ai-content/generate";
import { aiFieldsFor, measure } from "../ai-content/model";
import { buildSystemPrompt, buildUserPrompt } from "../ai-content/prompts/v1";
import { parseJsonSource, SourceError, transcriptFromSubtitles } from "../ai-content/sources";

const fixture = readFileSync(path.join(__dirname, "fixtures/bloom-filter_social.json"), "utf8");
const SRT = "1\n00:00:01,000 --> 00:00:03,000\nA Bloom filter is a bit array.\n\n2\n00:01:05,000 --> 00:01:07,500\nFalse positives are possible.\n";

/** Mocked AI: returns the queued responses in order and records the calls. */
function mockAi(responses: Record<string, unknown>[]) {
  const calls: { schemaName: string; user: string }[] = [];
  const ai: AiClient = {
    async generateStructured(input) {
      calls.push({ schemaName: input.schemaName, user: input.user });
      const data = responses.shift();
      if (!data) throw new Error("unexpected AI call");
      return { data: data as never, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, model: "mock-model" };
    },
  };
  return { ai, calls };
}

const target = (platform: "x" | "threads" | "youtube", fields: string[], isShort = false): GenerationTarget => ({
  key: "t1",
  socialConnectionId: randomUUID(),
  platform,
  platformLabel: platform,
  accountName: "acct",
  fields: aiFieldsFor(platform, "video").filter((f) => fields.includes(f.name)),
  isShort,
});

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

test("social JSON (bloom-filter shape) → per-platform hints", () => {
  const source = parseJsonSource(fixture);
  assert.equal(source.kind, "social");
  if (source.kind !== "social") return;
  assert.equal(source.video, "bloom-filters-explained");
  assert.deepEqual(Object.keys(source.platforms).sort(), ["facebook", "instagram", "linkedin", "threads", "x", "youtube"]);
  assert.equal(source.platforms.youtube?.shortsTitle, "Bloom filters in 60s");
  assert.deepEqual(source.platforms.x?.hashtags, ["#programming"]);
  assert.match(source.platforms.linkedin?.post ?? "", /constant space/);
});

test("any other object → generic context; non-objects → error", () => {
  const generic = parseJsonSource(JSON.stringify({ topic: "bloom filters", points: ["bits", "hashes"] }));
  assert.equal(generic.kind, "generic");
  if (generic.kind === "generic") assert.match(generic.text, /"topic": "bloom filters"/);

  const big = parseJsonSource(JSON.stringify({ blob: "x".repeat(20_000) }));
  assert.ok(big.kind === "generic" && big.truncated && big.text.length < 13_000);

  assert.throws(() => parseJsonSource("[1, 2, 3]"), (e: unknown) => e instanceof SourceError && /isn't an object/.test(e.message));
  assert.throws(() => parseJsonSource('"just a string"'), /isn't an object/);
  assert.throws(() => parseJsonSource("{nope"), /isn't valid JSON/);
});

test("SRT → [mm:ss] transcript; long ones keep start, sampled middle and end", () => {
  const transcript = transcriptFromSubtitles(SRT, "srt");
  assert.equal(transcript.text, "[00:01] A Bloom filter is a bit array.\n[01:05] False positives are possible.");
  const long = Array.from({ length: 400 }, (_, i) => `${i + 1}\n00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")},000 --> 00:59:59,000\nLine number ${i + 1} of the talk.\n`).join("\n");
  const capped = transcriptFromSubtitles(long, "srt", 2000);
  assert.ok(capped.truncated && capped.text.length <= 2200);
  assert.match(capped.text, /Line number 1 of/);
  assert.match(capped.text, /Line number 400 of/);
  assert.match(capped.text, /transcript truncated/);
});

test("JSON + SRT: JSON comes first and wins on conflicts", () => {
  const sources = { json: parseJsonSource(fixture), transcript: transcriptFromSubtitles(SRT, "srt") };
  const t = target("x", ["text"]);
  const user = buildUserPrompt({ sources, targets: [t] });
  assert.ok(user.indexOf("Social JSON (primary source)") < user.indexOf("Transcript (supporting detail"));
  assert.match(buildSystemPrompt([t]), /if they disagree, the JSON wins/);
});

// ---------------------------------------------------------------------------
// Output validation + repair
// ---------------------------------------------------------------------------

test("X text over 280 weighted → one repair call fixes it", async () => {
  const t = target("x", ["text"]);
  const tooLong = "Bloom filters ".repeat(25);
  assert.ok(xWeightedLength(tooLong) > 280);
  const { ai, calls } = mockAi([{ t1: { text: tooLong } }, { t1: { text: "Bloom filters say \"no\" for sure and \"maybe\" cheaply. #programming" } }]);
  const result = await runGeneration({ ai, targets: [t], sources: { json: parseJsonSource(fixture), transcript: null } });
  assert.deepEqual(calls.map((c) => c.schemaName), ["social_copy", "social_copy_repair"]);
  assert.match(String(result.output[t.socialConnectionId]?.text), /maybe/);
  assert.deepEqual(result.issues, []);
  assert.equal(result.usage.totalTokens, 30);
});

test("Threads limit is UTF-8 bytes: Bengali text under 500 chars still gets shortened", async () => {
  const t = target("threads", ["text"]);
  const bengali = "ব্লুম ফিল্টার একটি সম্ভাব্য ডেটা কাঠামো। ".repeat(8); // ~300 chars, ~800 bytes
  assert.ok([...bengali].length < 500 && measure(bengali, "bytes") > 500);
  const { ai } = mockAi([{ t1: { text: bengali } }, { t1: { text: bengali } }]);
  const result = await runGeneration({ ai, targets: [t], sources: { json: null, transcript: transcriptFromSubtitles(SRT, "srt") } });
  const text = String(result.output[t.socialConnectionId]?.text);
  assert.ok(measure(text, "bytes") <= 500, "fits in 500 bytes");
  assert.ok(bengali.startsWith(text), "cut at a word boundary of the original");
  assert.match(result.issues[0]!.message, /Shortened automatically to \d+\/500 bytes/);
});

test("YouTube title over 100 → repair still too long → word-boundary shortening + issue", async () => {
  const t = target("youtube", ["title", "description"]);
  const title = "Bloom Filters Explained: How Databases Like Cassandra Skip Disk Reads Using Tiny Probabilistic Bit Arrays Today";
  assert.ok(title.length > 100);
  const { ai, calls } = mockAi([
    { t1: { title, description: "What a Bloom filter is. #bloomfilter" } },
    { t1: { title: `${title} — Full Guide` } },
  ]);
  const result = await runGeneration({ ai, targets: [t], sources: { json: parseJsonSource(fixture), transcript: null } });
  const out = result.output[t.socialConnectionId]!;
  assert.equal(calls.length, 2, "exactly one repair call");
  assert.ok(String(out.title).length <= 100);
  assert.ok(title.startsWith(String(out.title)) && !/\s$/.test(String(out.title)), "ends at a word boundary");
  assert.equal(out.description, "What a Bloom filter is. #bloomfilter", "valid fields are untouched");
  assert.deepEqual(result.issues.map((i) => i.field), ["title"]);
  assert.match(result.issues[0]!.message, /Shortened automatically/);
});

// ---------------------------------------------------------------------------
// ai.generate
// ---------------------------------------------------------------------------

let userId: string;
before(async () => {
  const [user] = await db
    .insert(users)
    .values({ clerkId: `user_test_${randomUUID()}`, email: `ai-${randomUUID()}@example.com` })
    .returning({ id: users.id });
  userId = user!.id;
});
after(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

test("ai.generate rejects when neither JSON nor subtitles is given", async () => {
  await assert.rejects(
    () => createGeneration(userId, { targets: [{ socialConnectionId: randomUUID() }] }),
    (error: unknown) => error instanceof AppError && error.code === "VALIDATION" && /social JSON or subtitles/.test(error.message),
  );
});

test("post name: AI name from the JSON, ≤100 chars; fallbacks never empty", async () => {
  const { generatePostName, fallbackPostName } = await import("../ai-content/post-name");
  const json = parseJsonSource(fixture);

  const { ai, calls } = mockAi([{ name: "Bloom Filters Explained: Fast Membership Checks With Tiny Memory #datastructures" }]);
  const named = await generatePostName({ ai, json, titles: ["Bloom filters in 60s"] });
  assert.equal(named.byAi, true);
  assert.equal(named.name, "Bloom Filters Explained: Fast Membership Checks With Tiny Memory", "hashtags stripped");
  assert.match(calls[0]!.user, /Social JSON \(primary\)/);

  const long = "Why Bloom filters let Cassandra skip disk reads and how false positives happen in real production clusters today";
  const { ai: ai2 } = mockAi([{ name: long }]);
  const cut = await generatePostName({ ai: ai2, titles: ["x"] });
  assert.ok(cut.name.length <= 100 && long.startsWith(cut.name));

  const failing: AiClient = { generateStructured: async () => { throw new Error("401"); } };
  const fallback = await generatePostName({ ai: failing, titles: ["How AI agents log in without your API keys #shorts"] });
  assert.deepEqual(fallback, { name: "How AI agents log in without your API keys", byAi: false });

  assert.equal(fallbackPostName([null, "", "  "]), "Untitled post");
});
