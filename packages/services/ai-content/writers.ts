import {
  describeCount,
  FacebookOutputSchema,
  hashtagCountFor,
  getPlaybook,
  HOOK_PROMPT_VERSION,
  HookSchema,
  hookSystemPrompt,
  InstagramOutputSchema,
  LENGTH_TARGETS,
  LinkedInOutputSchema,
  repairPrompt,
  ThreadsOutputSchema,
  XOutputSchema,
  YouTubeCarouselOutputSchema,
  YouTubeOutputSchema,
  type AiClient,
  type AiUsage,
  type Brief,
  type PostType,
  type ResolvedTarget,
} from "@repo/ai";
import { YOUTUBE_TAGS_MAX, youtubeTagsLength } from "@repo/providers/youtube";
import type { z } from "zod";
import type { Platform } from "../publishing/platforms";
import { chapterBlock, chaptersFromCues, stripChapterLines, validateChapters, type Chapter } from "./chapters";
import {
  bandText,
  bannedPhrasesIn,
  firstLineOf,
  hasKeyword,
  hashtagLine,
  normalizeHashtags,
  num,
  repeatedSentences,
  stripInlineHashtagLine,
  trimToLimit,
  unitWord,
  visibleSliceOk,
} from "./checks";
import { measure, type AiField } from "./model";
import { aiBandFor, MAIN_TEXT_FIELD, playbookTargets } from "./targets";

/**
 * Stage 2 + 3 for ONE account: write with the platform's playbook, validate
 * in code (right unit per platform), one repair call with the exact numbers,
 * then trim in code if still over. Under the band is accepted with a note —
 * code never pads.
 */

export type WriterTarget = {
  socialConnectionId: string;
  platform: Platform;
  platformLabel: string;
  postType: PostType;
  /** Compose fields to fill (a subset of the platform's AI fields). */
  fields: AiField[];
  /** Per-photo alt texts wanted (`altTexts`, media ID → text). */
  altTexts: boolean;
  /** This account's photos, in its slide order. */
  slideMediaIds: string[];
  instruction?: string;
  /** Context only: people the user tagged on the media / invited as collaborators. */
  taggedUsernames?: string[];
  collaborators?: string[];
  /** YouTube long-form: code adds "Watch next: <title> <link>" above the hashtags (counted in the band). */
  watchNext?: { videoId: string; title: string } | null;
};

export type WriterContext = {
  ai: AiClient;
  brief: Brief;
  /** The author's draft for this platform (raw JSON block), if any. */
  jsonBlock: string | null;
  jsonChapters: Chapter[];
  /** Cue id → start ms, from the subtitles. */
  cues: Record<string, number>;
  durationSeconds: number | null;
  orientation: string | null;
  /** Media ID → slide number in the brief. */
  slideIndex: Record<string, number>;
  globalInstruction?: string;
  model?: string;
};

export type WriterResult = {
  output: Record<string, unknown>;
  issues: { field: string; message: string }[];
  usage: AiUsage;
  model: string | null;
  promptVersion: string;
};

type Piece = { role: "body" | "chapters" | "faqHead" | "faq" | "termsHead" | "terms" | "watchNext" | "hashtags"; text: string; sep?: string };
type TextPart = {
  field: string;
  label: string;
  target: ResolvedTarget | null;
  pieces: Piece[];
  /** Title / first line: must hold the primaryKeyword (and a required prefix from the user's instructions). */
  first: boolean;
  /** Characters visible before truncation. */
  visible?: number;
};
type Draft = { parts: TextPart[]; values: Record<string, unknown>; errors: string[] };

const NO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
const addUsage = (a: AiUsage, b: AiUsage): AiUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  totalTokens: a.totalTokens + b.totalTokens,
});

const join = (pieces: Piece[]) =>
  pieces
    .filter((p) => p.text.trim())
    .map((p, i) => (i === 0 ? p.text : `${p.sep ?? "\n\n"}${p.text}`))
    .join("");

const noAngles = (text: string) => text.replace(/[<>]/g, "");
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Handles e.g. "Start every title with ‘Interview #10 – ’". The account instruction comes last and wins. */
function requiredPrefix(target: WriterTarget, globalInstruction?: string): string | null {
  const instructions = [globalInstruction, target.instruction].filter(Boolean).join("\n");
  const matches = [...instructions.matchAll(/start(?:\s+[\p{L}\p{N}#_-]+){0,6}\s+with\s*[‘“"']([^’”"']+)[’”"']/giu)];
  return matches.at(-1)?.[1] ?? null;
}

function preferences(target: WriterTarget, globalInstruction?: string): string {
  if (!globalInstruction && !target.instruction) return "## USER PREFERENCES\nnone";
  return [
    "## USER PREFERENCES (style wishes; never above limits, bands or facts — the account block wins over the global one)",
    globalInstruction ? `<global>\n${globalInstruction}\n</global>` : "",
    target.instruction ? `<account>\n${target.instruction}\n</account>` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The brief as this account sees it: slides in its own order, renumbered. */
function briefFor(target: WriterTarget, ctx: WriterContext): Brief {
  const slides = target.slideMediaIds.flatMap((mediaId, i) => {
    const slide = ctx.brief.slides.find((s) => s.index === ctx.slideIndex[mediaId]);
    return slide ? [{ ...slide, index: i + 1 }] : [];
  });
  return { ...ctx.brief, slides };
}

function userPrompt(target: WriterTarget, ctx: WriterContext): string {
  const media =
    target.slideMediaIds.length > 0
      ? `${target.slideMediaIds.length} photo${target.slideMediaIds.length === 1 ? "" : "s"} (see brief.slides)`
      : `video, ${ctx.orientation ?? "unknown"} orientation, ${ctx.durationSeconds ? `${Math.round(ctx.durationSeconds)} s` : "unknown length"}`;
  return [
    `## POST\n${target.platformLabel} · ${target.postType} · ${media}`,
    `## BRIEF\n${JSON.stringify(briefFor(target, ctx), null, 1)}`,
    `## AUTHOR DRAFT (${target.platformLabel} block of the social JSON)\n${ctx.jsonBlock ?? "none — write everything from the brief"}`,
    ...(target.taggedUsernames?.length || target.collaborators?.length
      ? [
          [
            "## TAGGED PEOPLE (context only — chosen by the user; never add others)",
            target.taggedUsernames?.length ? `Tagged on the media: ${target.taggedUsernames.map((u) => `@${u}`).join(", ")}` : "",
            target.collaborators?.length ? `Collaborators: ${target.collaborators.map((u) => `@${u}`).join(", ")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        ]
      : []),
    ...(target.watchNext ? [`## WATCH NEXT\nCode adds this line above the hashtags (it counts toward the description total): Watch next: ${target.watchNext.title} https://youtu.be/${target.watchNext.videoId}`] : []),
    preferences(target, ctx.globalInstruction),
  ].join("\n\n");
}

function hashtagsFor(raw: string[], platform: Platform, errors: string[], postType: PostType = "video"): string[] {
  const tags = normalizeHashtags(raw);
  const count = hashtagCountFor(platform, postType);
  if (tags.length < count.min) {
    errors.push(`hashtags: return ${describeCount(count)} specific topic/niche hashtags (got ${tags.length} usable; generic ones don't count)`);
  }
  return tags.slice(0, count.max);
}

/** Model output → the compose values code will fill, plus what to measure. */
function build(target: WriterTarget, ctx: WriterContext, raw: unknown): Draft {
  const { platform, postType } = target;
  const errors: string[] = [];
  const parts: TextPart[] = [];
  const values: Record<string, unknown> = {};
  const wants = (field: string) => target.fields.some((f) => f.name === field);
  const labelOf = (field: string) => target.fields.find((f) => f.name === field)?.label.toLowerCase() ?? field;
  const visible = LENGTH_TARGETS[platform].visible?.chars;
  const text = (field: string, pieces: Piece[], first: boolean, slice?: number) => {
    if (wants(field)) parts.push({ field, label: labelOf(field), target: aiBandFor(platform, postType, field), pieces, first, visible: slice });
  };
  const withTags = (body: string, tags: string[], sep = "\n\n"): Piece[] => [
    { role: "body", text: stripInlineHashtagLine(body.trim()) },
    { role: "hashtags", text: hashtagLine(tags), sep },
  ];

  if (platform === "youtube" && postType === "carousel") {
    // Manual image post: text + up to 3 hashtags.
    const o = raw as z.infer<typeof YouTubeCarouselOutputSchema>;
    text("communityText", withTags(o.post, hashtagsFor(o.hashtags, platform, errors, postType)), true);
  } else if (platform === "youtube") {
    const o = raw as z.infer<typeof YouTubeOutputSchema>;
    const tags = hashtagsFor(o.hashtags, platform, wants("description") ? errors : []);
    text("title", [{ role: "body", text: oneLine(noAngles(o.title)) }], true);
    const fromJson = validateChapters(ctx.jsonChapters, ctx.durationSeconds);
    const chapters = postType === "video" ? (fromJson ?? validateChapters(chaptersFromCues(o.chapters, ctx.cues), ctx.durationSeconds)) : null;
    text(
      "description",
      [
        { role: "body", text: noAngles(stripInlineHashtagLine(stripChapterLines(o.description))) },
        ...(chapters ? [{ role: "chapters" as const, text: chapterBlock(chapters, ctx.durationSeconds) }] : []),
        ...(o.faq.length ? [{ role: "faqHead" as const, text: "FAQ" }] : []),
        ...o.faq.map((f, i) => ({ role: "faq" as const, text: noAngles(`Q: ${oneLine(f.question)}\nA: ${oneLine(f.answer)}`), sep: i === 0 ? "\n" : "\n\n" })),
        ...(o.keyTerms.length ? [{ role: "termsHead" as const, text: "Key terms" }] : []),
        ...o.keyTerms.map((k) => ({ role: "terms" as const, text: noAngles(`${oneLine(k.term)}: ${oneLine(k.meaning)}`), sep: "\n" })),
        ...(target.watchNext
          ? [{ role: "watchNext" as const, text: `Watch next: ${noAngles(oneLine(target.watchNext.title))} https://youtu.be/${target.watchNext.videoId}` }]
          : []),
        { role: "hashtags", text: hashtagLine(tags) },
      ],
      false,
      visible,
    );
    if (wants("tags")) {
      const seen = new Set<string>();
      const list = o.tags
        // A comma would split one tag into two on YouTube.
        .map((t) => oneLine(noAngles(t.replace(/^#+/, "").replace(/,/g, " "))).replace(/\s+/g, " ").trim().slice(0, 100))
        .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
      const band = aiBandFor(platform, postType, "tags");
      // Counted as YouTube does (multi-word tags +2 for quotes), or YouTube rejects them as invalid keywords.
      const joined = youtubeTagsLength(list);
      if (band && joined < band.min) errors.push(`tags total ${num(joined)} chars joined, target ${num(band.min)}–${num(band.max)}: add more search phrases people would type`);
      while (list.length && youtubeTagsLength(list) > Math.min(band?.limit ?? YOUTUBE_TAGS_MAX, YOUTUBE_TAGS_MAX)) list.pop();
      values.tags = list.slice(0, 50);
    }
  } else if (platform === "linkedin") {
    const o = raw as z.infer<typeof LinkedInOutputSchema>;
    text("commentary", withTags(o.post, hashtagsFor(o.hashtags, platform, errors)), true, visible);
  } else if (platform === "x") {
    const o = raw as z.infer<typeof XOutputSchema>;
    text("text", withTags(o.post, hashtagsFor(o.hashtags, platform, errors), " "), true);
  } else if (platform === "facebook") {
    const o = raw as z.infer<typeof FacebookOutputSchema>;
    text("message", withTags(o.post, hashtagsFor(o.hashtags, platform, wants("message") ? errors : [])), true, visible);
    text("title", [{ role: "body", text: oneLine(o.title) }], true);
  } else if (platform === "instagram") {
    const o = raw as z.infer<typeof InstagramOutputSchema>;
    text("caption", withTags(o.caption, hashtagsFor(o.hashtags, platform, wants("caption") ? errors : [])), true, visible);
    const slides = target.slideMediaIds;
    const wantsAlt = slides.length > 0 && (wants("altText") || target.altTexts);
    if (wantsAlt) {
      const band = aiBandFor(platform, postType, "altText");
      const alts = o.altTexts.map((a) => (band ? trimToLimit(oneLine(a), band.limit, band.unit) : oneLine(a)));
      if (alts.length < slides.length) errors.push(`altTexts: return exactly ${slides.length} entries, one per slide in order (got ${alts.length})`);
      alts.slice(0, slides.length).forEach((alt, i) => {
        const n = measure(alt, "chars");
        if (band && (n < band.min || n > band.max)) errors.push(`altTexts[${i + 1}] is ${num(n)} chars, target ${num(band.min)}–${num(band.max)}: describe what slide ${i + 1} shows`);
      });
      if (wants("altText") && slides.length === 1 && alts[0]) values.altText = alts[0];
      if (target.altTexts) values.altTexts = Object.fromEntries(slides.flatMap((id, i) => (alts[i] ? [[id, alts[i]]] : [])));
    }
  } else {
    const o = raw as z.infer<typeof ThreadsOutputSchema>;
    text("text", [{ role: "body", text: o.post.trim() }], true);
    const topic = oneLine(o.topicTag.replace(/[#.&]/g, "")).slice(0, 50);
    if (wants("topic_tag") && topic) values.topic_tag = topic;
  }
  return { parts, values, errors };
}

/** Stage 3 checks, as repair instructions with exact numbers. */
function validate(draft: Draft, target: WriterTarget, ctx: WriterContext): string[] {
  const errors = [...draft.errors];
  const prefix = requiredPrefix(target, ctx.globalInstruction);
  for (const part of draft.parts) {
    const text = join(part.pieces);
    const body = part.pieces.find((p) => p.role === "body")?.text ?? "";
    const { label, target: t } = part;
    if (!body.trim()) {
      errors.push(`${label} is empty: write it`);
      continue;
    }
    if (t) {
      const n = measure(text, t.unit);
      const added = part.pieces.length > 1 ? ` once the parts code appends (chapters, hashtags…) are counted — your own text is ${num(measure(body, t.unit))}` : "";
      if (n > t.limit) errors.push(`${label} is ${num(n)} ${unitWord(t.unit)}${added}, max ${num(t.limit)}: cut ${num(n - t.max)} by removing whole sentences`);
      else if (n < t.min) {
        const gap = t.min - n;
        const how = gap > 600 ? "3–5 more key points, an example and an FAQ" : gap > 200 ? "2–3 more key points" : "one more concrete fact or example";
        errors.push(`${label} is ${num(n)} ${unitWord(t.unit)}${added}, target ${bandText(t)}: add ${how} from the brief, don't repeat`);
      }
    }
    const banned = bannedPhrasesIn(text);
    if (banned.length) errors.push(`${label} uses banned wording (${banned.map((b) => `"${b}"`).join(", ")}): rewrite those sentences`);
    const repeated = repeatedSentences(text);
    if (repeated.length) errors.push(`${label} repeats a sentence ("${repeated[0]!.slice(0, 80)}"): say it once and use the space for new material`);
    const opening = part.pieces.length === 1 && !text.includes("\n") ? text : firstLineOf(text);
    if (part.first && !hasKeyword(opening, ctx.brief.primaryKeyword)) {
      errors.push(`${label}: put the primaryKeyword "${ctx.brief.primaryKeyword}" naturally in the ${opening === text ? "text" : "first line"}`);
    }
    if (part.first && prefix && !text.startsWith(prefix)) errors.push(`${label} must start with "${prefix}" (user instruction; it counts toward the length)`);
    if (part.visible && !visibleSliceOk(text, part.visible)) {
      errors.push(`${label}: the first ${part.visible} characters are all most people see — end a complete sentence or line inside them`);
    }
  }
  return errors;
}

/** Over the hard limit: drop key terms, then FAQ entries, then trim the body at a sentence/word boundary. Chapters stay. */
function fit(part: TextPart): { text: string; trimmed: boolean } {
  const t = part.target;
  let pieces = part.pieces.filter((p) => p.text.trim()).map((p) => ({ ...p }));
  const over = () => Boolean(t && measure(join(pieces), t.unit) > t.limit);
  if (!t || !over()) return { text: join(pieces), trimmed: false };
  for (const role of ["terms", "faq"] as const) {
    while (over()) {
      const index = pieces.map((p) => p.role).lastIndexOf(role);
      if (index < 0) break;
      pieces.splice(index, 1);
    }
  }
  pieces = pieces.filter((p, i) => !(p.role === "faqHead" && pieces[i + 1]?.role !== "faq") && !(p.role === "termsHead" && pieces[i + 1]?.role !== "terms"));
  const body = pieces.find((p) => p.role === "body");
  for (let guard = 0; body && over() && guard < 20; guard++) {
    const rest = measure(join(pieces), t.unit) - measure(body.text, t.unit);
    body.text = trimToLimit(body.text, Math.max(0, t.limit - rest - guard * 4), t.unit);
  }
  return { text: join(pieces), trimmed: true };
}

function finalize(draft: Draft, target: WriterTarget, ctx: WriterContext): Pick<WriterResult, "output" | "issues"> {
  const output: Record<string, unknown> = {};
  const issues: WriterResult["issues"] = [];
  const prefix = requiredPrefix(target, ctx.globalInstruction);
  for (const part of draft.parts) {
    const field = target.fields.find((f) => f.name === part.field)!;
    const { text, trimmed } = fit(part);
    if (!text.trim()) {
      issues.push({ field: part.field, message: "AI returned nothing for this field" });
      continue;
    }
    const parsed = field.validator.safeParse(text);
    if (!parsed.success) {
      issues.push({ field: part.field, message: `Couldn't generate a valid value: ${parsed.error.issues[0]?.message ?? "invalid"}` });
      continue;
    }
    output[part.field] = parsed.data;
    const t = part.target;
    if (part.first && prefix && !text.startsWith(prefix)) issues.push({ field: part.field, message: "Couldn't apply your instruction within the limit" });
    else if (t && trimmed) issues.push({ field: part.field, message: `Shortened automatically to ${num(measure(text, t.unit))}/${num(t.limit)} ${unitWord(t.unit)}` });
    else if (t && measure(text, t.unit) < t.min) {
      issues.push({ field: part.field, message: `Shorter than target (${num(measure(text, t.unit))} of ${bandText(t)}): the source didn't have more to say` });
    }
  }
  for (const [name, value] of Object.entries(draft.values)) {
    const field = target.fields.find((f) => f.name === name);
    if (!field) {
      output[name] = value;
      continue;
    }
    const parsed = field.validator.safeParse(value);
    if (parsed.success) output[name] = parsed.data;
    else issues.push({ field: name, message: `Couldn't generate a valid value: ${parsed.error.issues[0]?.message ?? "invalid"}` });
  }
  return { output, issues };
}

/** One account: write → validate → ONE repair → trim/accept. */
export async function writeForTarget(target: WriterTarget, ctx: WriterContext): Promise<WriterResult> {
  const playbook = getPlaybook(target.platform, target.postType);
  const system = playbook.system(playbookTargets(target.platform, playbook.postType));
  const user = userPrompt(target, ctx);
  const first = await ctx.ai.generateStructured({ system, user, schema: playbook.schema, schemaName: playbook.schemaName, model: ctx.model });
  let usage = first.usage;
  let draft = build(target, ctx, first.data);
  const errors = validate(draft, target, ctx);

  if (errors.length) {
    try {
      const second = await ctx.ai.generateStructured({
        system,
        user: `${user}\n\n## PREVIOUS ANSWER\n${JSON.stringify(first.data)}\n\n## FIX\n${repairPrompt(errors)}`,
        schema: playbook.schema,
        schemaName: `${playbook.schemaName}_repair`,
        model: ctx.model,
      });
      usage = addUsage(usage, second.usage);
      const repaired = build(target, ctx, second.data);
      if (validate(repaired, target, ctx).length <= errors.length) draft = repaired;
    } catch {
      // Keep the first answer; code trims what is over a limit.
    }
  }
  return { ...finalize(draft, target, ctx), usage, model: first.model, promptVersion: playbook.version };
}

/**
 * "Regenerate hook only": rewrites the title (YouTube) or the first line of
 * the main text and splices it back, keeping the total inside the band.
 */
export async function rewriteHook(target: WriterTarget, ctx: WriterContext, current: Record<string, unknown>): Promise<WriterResult> {
  const fieldName =
    target.platform === "youtube" ? (target.postType === "carousel" ? "communityText" : "title") : MAIN_TEXT_FIELD[target.platform];
  const field = target.fields.find((f) => f.name === fieldName);
  const text = typeof current[fieldName] === "string" ? (current[fieldName] as string).trimStart() : "";
  const done = (issues: WriterResult["issues"], output: Record<string, unknown> = {}, usage = NO_USAGE, model: string | null = null): WriterResult => ({
    output,
    issues,
    usage,
    model,
    promptVersion: HOOK_PROMPT_VERSION,
  });
  if (!field) return done([{ field: fieldName, message: "AI can't write this field" }]);
  if (!text.trim()) return done([{ field: fieldName, message: "Nothing to rewrite yet — generate the post first" }]);

  const isTitle = fieldName === "title";
  const band = aiBandFor(target.platform, target.postType, fieldName);
  const unit = band?.unit ?? field.countMode;
  const limit = band?.limit ?? field.maxLength ?? 300;
  const oldHook = isTitle ? text : firstLineOf(text);
  const rest = isTitle ? "" : text.slice(oldHook.length);
  const restLength = measure(rest, unit);
  const visible = LENGTH_TARGETS[target.platform].visible?.chars ?? 140;
  const max = isTitle ? (band?.max ?? limit) : Math.min(Math.max(visible * 2, measure(oldHook, unit) + 40), (band?.max ?? limit) - restLength);
  if (max < 20) return done([{ field: fieldName, message: "No room to rewrite the first line within the limit" }]);
  const min = Math.min(max - 10, Math.max(20, isTitle ? (band?.min ?? 20) : (band?.min ?? 0) - restLength));

  const result = await ctx.ai.generateStructured({
    system: hookSystemPrompt({
      platformLabel: target.platformLabel,
      what: isTitle ? "title" : "first line",
      length: `${num(min)}–${num(max)} ${unitWord(unit)} (hard limit ${num(max)})`,
    }),
    user: [
      `## BRIEF (hooks and facts)\n${JSON.stringify({
        topic: ctx.brief.topic,
        language: ctx.brief.language,
        primaryKeyword: ctx.brief.primaryKeyword,
        hookCandidates: ctx.brief.hookCandidates,
        concreteFacts: ctx.brief.concreteFacts,
        keyPoints: ctx.brief.keyPoints,
      })}`,
      `## CURRENT ${isTitle ? "TITLE" : "FIRST LINE"}\n${oldHook}`,
      rest.trim() ? `## TEXT THAT FOLLOWS (unchanged)\n${rest.trim().slice(0, 800)}` : "",
      preferences(target, ctx.globalInstruction),
    ]
      .filter(Boolean)
      .join("\n\n"),
    schema: HookSchema,
    schemaName: "hook",
    model: ctx.model,
  });
  const clean = oneLine(target.platform === "youtube" ? noAngles(result.data.hook) : result.data.hook);
  const hook = trimToLimit(clean, max, unit);
  const parsed = field.validator.safeParse(`${hook}${rest}`);
  if (!hook || !parsed.success) {
    return done([{ field: fieldName, message: "Couldn't rewrite the hook within the limit" }], {}, result.usage, result.model);
  }
  return done([], { [fieldName]: parsed.data }, result.usage, result.model);
}
