import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { LENGTH_TARGETS, resolveTarget, type AiClient, type Brief } from "@repo/ai";
import { db, eq, users } from "@repo/database";
import { AppError } from "@repo/errors";
import { xWeightedLength } from "@repo/providers";
import { createGeneration } from "../ai-content";
import { chapterBlock, chaptersFromCues, validateChapters } from "../ai-content/chapters";
import { normalizeHashtags, visibleSliceOk } from "../ai-content/checks";
import { aiFieldsFor, measure } from "../ai-content/model";
import { parseJsonSource, SourceError, transcriptFromSubtitles } from "../ai-content/sources";
import { aiBandFor } from "../ai-content/targets";
import { writeForTarget, type WriterContext, type WriterTarget } from "../ai-content/writers";

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

const target = (platform: "x" | "threads" | "youtube", fields: string[]): WriterTarget => ({
  socialConnectionId: randomUUID(),
  platform,
  platformLabel: platform,
  postType: "video",
  fields: aiFieldsFor(platform, "video").filter((f) => fields.includes(f.name)),
  altTexts: false,
  slideMediaIds: [],
});

const brief: Brief = {
  topic: "Bloom filters",
  audience: "backend engineers",
  language: "English",
  primaryKeyword: "Bloom filters",
  secondaryKeywords: ["probabilistic data structure"],
  keyPoints: [{ point: "A Bloom filter is a bit array", sourceRef: "c1" }],
  concreteFacts: [],
  examples: [],
  faqs: [],
  quotes: [],
  hookCandidates: [],
  chapterCandidates: [],
  slides: [],
  gaps: [],
};

const context = (ai: AiClient, extra: Partial<WriterContext> = {}): WriterContext => ({
  ai,
  brief,
  jsonBlock: null,
  jsonChapters: [],
  cues: {},
  durationSeconds: 600,
  orientation: "landscape",
  slideIndex: {},
  ...extra,
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

test("SRT → \"[c1 00:01] text\" windows with cue ids; long ones keep start, sampled middle and end", () => {
  const transcript = transcriptFromSubtitles(SRT, "srt");
  assert.equal(transcript.text, "[c1 00:01] A Bloom filter is a bit array.\n[c2 01:05] False positives are possible.");
  assert.deepEqual(transcript.cues, { c1: 1000, c2: 65_000 });
  // 400 one-second cues merge into ~25 s windows that keep the first cue's id.
  const long = Array.from({ length: 400 }, (_, i) => `${i + 1}\n00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")},000 --> 00:59:59,000\nLine number ${i + 1} of the talk.\n`).join("\n");
  const merged = transcriptFromSubtitles(long, "srt");
  assert.equal(merged.text.split("\n").length, 16);
  assert.match(merged.text, /^\[c1 00:00\] Line number 1 of the talk\. Line number 2 /);
  assert.equal(merged.cues.c26, 25_000);
  const capped = transcriptFromSubtitles(long, "srt", 5000);
  assert.ok(capped.truncated && capped.text.length <= 5200);
  assert.match(capped.text, /Line number 1 of/);
  assert.match(capped.text, /Line number 400 of/);
  assert.match(capped.text, /transcript cut/);
});

test("length targets: the compose model's limit and unit win; bands come from one table", () => {
  // YouTube descriptions are limited in UTF-8 bytes by the compose model.
  assert.deepEqual(aiBandFor("youtube", "video", "description"), { limit: 5000, min: 4200, max: 4950, unit: "bytes", joined: false });
  // Facebook's title limit only exists in the model (255): 85–100% of it.
  assert.deepEqual(aiBandFor("facebook", "video", "title"), { limit: 255, min: 217, max: 255, unit: "chars", joined: false });
  // A very high limit keeps the absolute band.
  assert.equal(aiBandFor("facebook", "image", "message")?.max, 2500);
  assert.equal(aiBandFor("threads", "video", "text")?.unit, "bytes");
  assert.equal(aiBandFor("youtube", "image", "title"), null);
  // A smaller model limit scales the band.
  assert.deepEqual(resolveTarget(LENGTH_TARGETS.linkedin.fields.post!, { limit: 1500 }), { limit: 1500, min: 1300, max: 1475, unit: "chars", joined: false });
});

test("chapters: cue ids → real times, first at 00:00, ≥ 10 s apart, before the end, at least 3", () => {
  const cues = { c1: 4000, c9: 95_000, c12: 221_000, c13: 226_000, c40: 598_000 };
  const picked = chaptersFromCues(
    [
      { cueId: "c12", label: "Sizing the bit array" },
      { cueId: "c1", label: "What a Bloom filter is" },
      { cueId: "c13", label: "Too close" },
      { cueId: "c99", label: "Unknown cue" },
      { cueId: "c9", label: "False positives" },
      { cueId: "c40", label: "Past the end" },
    ],
    cues,
  );
  const chapters = validateChapters(picked, 600)!;
  assert.deepEqual(chapters.map((c) => c.seconds), [0, 95, 221]);
  assert.equal(chapterBlock(chapters, 600), "Chapters\n00:00 What a Bloom filter is\n01:35 False positives\n03:41 Sizing the bit array");
  assert.match(chapterBlock(chapters, 4000), /^Chapters\n0:00:00 /);
  assert.equal(validateChapters(picked.slice(0, 2), 600), null, "fewer than 3 → no block");
});

test("hashtags are normalised in code; the visible slice must end a phrase", () => {
  assert.deepEqual(normalizeHashtags(["#Bloom Filter", "bloomfilter", "#viral", "system-design", "#BloomFilter"]), ["BloomFilter", "systemdesign"]);
  assert.ok(visibleSliceOk("Short hook.", 125));
  assert.ok(!visibleSliceOk("word ".repeat(60), 125));
  assert.ok(visibleSliceOk(`Bloom filters let a database skip disk reads for keys that are missing. ${"word ".repeat(60)}`, 125));
});

// ---------------------------------------------------------------------------
// Writers: validation + one repair
// ---------------------------------------------------------------------------

test("X text over 280 weighted → one repair call with the exact numbers fixes it", async () => {
  const t = target("x", ["text"]);
  const tooLong = "Bloom filters ".repeat(25);
  assert.ok(xWeightedLength(tooLong) > 280);
  const fixed = `Bloom filters answer "is this key here?" with a firm no or a cheap maybe, in constant space. Cassandra uses them to skip disk reads for missing rows, and a 1% false positive rate costs about 10 bits per key. Small price, big win`;
  const { ai, calls } = mockAi([
    { post: tooLong, hashtags: ["programming", "databases"] },
    { post: fixed, hashtags: ["bloomfilter", "databases"] },
  ]);
  const result = await writeForTarget(t, context(ai));
  assert.deepEqual(calls.map((c) => c.schemaName), ["x_video", "x_video_repair"]);
  assert.match(calls[1]!.user, /post text is \d+ weighted chars.*max 280/);
  const text = String(result.output.text);
  assert.ok(text.endsWith("#bloomfilter #databases") && xWeightedLength(text) <= 280);
  assert.equal(result.usage.totalTokens, 30);
  assert.equal(result.promptVersion, "x-1");
});

test("Threads limit is UTF-8 bytes: still over after the repair → trimmed in code, never padded", async () => {
  const t = target("threads", ["text", "topic_tag"]);
  const bengali = "ব্লুম ফিল্টার একটি সম্ভাব্য ডেটা কাঠামো। ".repeat(8); // ~300 chars, ~800 bytes
  assert.ok([...bengali].length < 500 && measure(bengali, "bytes") > 500);
  const { ai, calls } = mockAi([
    { post: bengali, topicTag: "#Bloom.Filters" },
    { post: bengali, topicTag: "#Bloom.Filters" },
  ]);
  const result = await writeForTarget(t, context(ai));
  assert.equal(calls.length, 2, "exactly one repair call");
  const text = String(result.output.text);
  assert.ok(measure(text, "bytes") <= 500, "fits in 500 bytes");
  assert.ok(bengali.startsWith(text), "cut at a sentence/word boundary of the original");
  assert.equal(result.output.topic_tag, "BloomFilters");
  assert.match(result.issues.find((i) => i.field === "text")!.message, /Shortened automatically to \d+\/500 bytes/);
});

test("YouTube: chapters come from cue ids (code writes the times); a thin source stays short with a note", async () => {
  const t = target("youtube", ["title", "description", "tags"]);
  const answer = {
    title: "Bloom Filters Explained: How Databases Skip Disk Reads With a Tiny Probabilistic Bit Array",
    description: "Bloom filters tell a database a key is definitely missing before it touches disk.\n\nWhat you'll learn\n- What a Bloom filter is",
    faq: [{ question: "Can a Bloom filter give false negatives?", answer: "No, only false positives." }],
    keyTerms: [{ term: "False positive", meaning: "A maybe for a key that was never added." }],
    tags: ["bloom filter", "#bloom filter", "probabilistic data structure"],
    hashtags: ["#BloomFilter", "databases", "systemdesign", "extra"],
    chapters: [
      { cueId: "c1", label: "What a Bloom filter is" },
      { cueId: "c9", label: "False positives explained" },
      { cueId: "c12", label: "Sizing the bit array" },
    ],
  };
  const { ai, calls } = mockAi([answer, answer]);
  const result = await writeForTarget(t, context(ai, { cues: { c1: 4000, c9: 95_000, c12: 221_000 } }));
  assert.equal(calls.length, 2, "below the band → one repair call");
  assert.match(calls[1]!.user, /description is \d+ bytes.*target 4,200–4,950 bytes/);
  const description = String(result.output.description);
  assert.match(description, /Chapters\n00:00 What a Bloom filter is\n01:35 False positives explained\n03:41 Sizing the bit array/);
  assert.ok(description.indexOf("Chapters") < description.indexOf("FAQ") && description.indexOf("FAQ") < description.indexOf("Key terms"));
  assert.ok(description.endsWith("#BloomFilter #databases #systemdesign"), "exactly 3 hashtags on the last line");
  assert.deepEqual(result.output.tags, ["bloom filter", "probabilistic data structure"]);
  assert.match(result.issues.find((i) => i.field === "description")!.message, /Shorter than target/);
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

test("ai.generate rejects when no JSON, subtitles or photos are given", async () => {
  await assert.rejects(
    () => createGeneration(userId, { targets: [{ socialConnectionId: randomUUID() }] }),
    (error: unknown) => error instanceof AppError && error.code === "VALIDATION" && /social JSON, subtitles or photos/.test(error.message),
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
