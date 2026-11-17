import { AiError, BRIEF_PROMPT_VERSION, getAiClient, postTypeFor, type AiClient, type AiUsage, type PostType } from "@repo/ai";
import { aiGenerations, aiInstructionPresets, and, db, desc, eq, inArray, media, socialConnections, sql } from "@repo/database";
import { errors } from "@repo/errors";
import { z } from "zod";
import { cached, invalidate } from "../cache";
import { MediaRowSchema, orientationOf, type MediaRow } from "../media/model";
import { PLATFORMS, platformForProvider, type Platform } from "../publishing/platforms";
import { ensureBrief, loadBrief } from "./brief";
import { aiFieldsFor, CreateInstructionPresetInputSchema, GenerateInputBaseSchema, GenerationIssueSchema, InstructionPresetPageSchema, InstructionPresetViewSchema, ListInstructionPresetsInputSchema, NO_SOURCE_MESSAGE, type GenerationIssue, type GenerationView } from "./model";
import { afterCursor, cursorTimestamp, toPage } from "../common/pagination";
import { loadSources, SourceError, type SourceKind } from "./sources";
import { rewriteHook, writeForTarget, type WriterTarget } from "./writers";

const UuidSchema = z.uuid();

/** Compose key for per-photo alt texts (media ID → text); not a generic compose control. */
const ALT_TEXTS = "altTexts";

const StoredInputSchema = z.object({
  jsonMediaId: z.uuid().nullable(),
  subtitleMediaId: z.uuid().nullable(),
  videoMediaId: z.uuid().nullable(),
  /** Browser-read duration/size of a video that was still uploading when AI started. */
  videoMeta: z.object({ durationSeconds: z.number().nullable(), width: z.number().nullable(), height: z.number().nullable() }).nullable().default(null),
  photoMediaIds: z.array(z.uuid()).default([]),
  globalInstruction: z.string().nullable(),
  /** The brief row (ai_generations, scope.kind = "brief") this generation writes from. */
  briefId: z.uuid().nullable().default(null),
  targets: z.array(
    z.object({
      socialConnectionId: z.uuid(),
      fields: z.array(z.string()),
      instruction: z.string().nullable(),
      photoMediaIds: z.array(z.uuid()).nullable().default(null),
      hookOnly: z.boolean().default(false),
      current: z.record(z.string(), z.string()).nullable().default(null),
      context: z
        .object({
          taggedUsernames: z.array(z.string()).default([]),
          collaborators: z.array(z.string()).default([]),
          watchNext: z.object({ videoId: z.string(), title: z.string() }).nullable().default(null),
        })
        .nullable()
        .default(null),
    }),
  ),
});

const WriterMetaSchema = z.object({
  socialConnectionId: z.string(),
  platform: z.string(),
  postType: z.enum(["video", "short", "image", "carousel"]),
  source: z.enum(["json", "srt", "photos"]),
  promptVersion: z.string(),
});
type WriterMeta = z.infer<typeof WriterMetaSchema>;

/** AI-writable compose fields for a platform (plus per-photo alt texts on multi-photo posts). */
function availableFields(platform: Platform, mediaType: "video" | "photos", photoCount: number): string[] {
  const names = aiFieldsFor(platform, mediaType).map((f) => f.name);
  if (mediaType === "photos" && photoCount > 1 && PLATFORMS[platform].capabilities.perImageAltTextMax) names.push(ALT_TEXTS);
  return names;
}

async function ownedMedia(userId: string, ids: string[]): Promise<Map<string, MediaRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(media).where(and(eq(media.userId, userId), inArray(media.id, ids)));
  return new Map(rows.map((row) => [row.id, MediaRowSchema.parse(row)]));
}

function requireMedia(rows: Map<string, MediaRow>, id: string | undefined, type: MediaRow["type"], label: string, options: { allowInFlight?: boolean } = {}) {
  if (!id) return null;
  const row = rows.get(id);
  if (!row) return errors.notFound(label);
  if (row.type !== type) return errors.badRequest(`${label} must be a ${type} file`);
  if (row.status === "failed") return errors.badRequest(`${label} failed to upload`);
  if (row.status !== "ready" && !options.allowInFlight) return errors.badRequest(`${label} isn't ready yet`);
  return row;
}

/**
 * Validates the request (ownership, ready media, known fields) and stores a
 * queued generation. The caller sends the Inngest event. No source text is saved.
 */
export async function createGeneration(userId: string, input: z.input<typeof GenerateInputBaseSchema>) {
  const data = GenerateInputBaseSchema.parse(input);
  const photoIds = data.videoMediaId ? [] : (data.photoMediaIds ?? []);
  if (!data.jsonMediaId && !data.subtitleMediaId && photoIds.length === 0) return errors.validation(NO_SOURCE_MESSAGE);
  const owner = UuidSchema.parse(userId);

  const rows = await ownedMedia(owner, [data.jsonMediaId, data.subtitleMediaId, data.videoMediaId, ...photoIds].filter(Boolean) as string[]);
  requireMedia(rows, data.jsonMediaId, "json", "Social JSON");
  requireMedia(rows, data.subtitleMediaId, "subtitle", "Subtitles");
  // The video only adds duration/orientation context, so it may still be uploading (videoMeta stands in).
  requireMedia(rows, data.videoMediaId, "video", "Video", { allowInFlight: true });
  for (const id of photoIds) requireMedia(rows, id, "image", "Photo");
  const mediaType = data.videoMediaId ? "video" : "photos";

  const connections = await db
    .select({ id: socialConnections.id, provider: socialConnections.provider })
    .from(socialConnections)
    .where(and(eq(socialConnections.userId, owner), inArray(socialConnections.id, data.targets.map((t) => t.socialConnectionId))));

  const targets = data.targets.map((target) => {
    const connection = connections.find((c) => c.id === target.socialConnectionId);
    if (!connection) return errors.notFound("Account");
    const platform = platformForProvider(connection.provider);
    const own = target.photoMediaIds?.filter((id) => photoIds.includes(id)) ?? null;
    if (target.photoMediaIds && own?.length !== target.photoMediaIds.length) return errors.badRequest("An account's photos must come from photoMediaIds");
    const available = platform ? availableFields(platform, mediaType, (own ?? photoIds).length) : [];
    if (available.length === 0) return errors.badRequest(`AI can't write for ${connection.provider} yet`);
    const fields = target.fields ?? available;
    const unknown = fields.filter((f) => !available.includes(f));
    if (unknown.length) return errors.badRequest(`AI can't write ${unknown.join(", ")} for ${PLATFORMS[platform!].label}`);
    if (target.hookOnly && !target.current) return errors.badRequest("hookOnly needs the account's current text");
    return {
      socialConnectionId: target.socialConnectionId,
      fields,
      instruction: target.instruction ?? null,
      photoMediaIds: own,
      hookOnly: target.hookOnly ?? false,
      current: target.hookOnly ? (target.current ?? null) : null,
      context: target.context
        ? { taggedUsernames: target.context.taggedUsernames ?? [], collaborators: target.context.collaborators ?? [], watchNext: target.context.watchNext ?? null }
        : null,
    };
  });

  const scope = data.targets.every((t) => !t.fields)
    ? "all"
    : targets.flatMap((t) => t.fields.map((field) => ({ connectionId: t.socialConnectionId, field })));
  const [row] = await db
    .insert(aiGenerations)
    .values({
      userId: owner,
      status: "queued",
      scope,
      sourceMediaIds: [data.jsonMediaId, data.subtitleMediaId, ...photoIds].filter(Boolean) as string[],
      input: {
        jsonMediaId: data.jsonMediaId ?? null,
        subtitleMediaId: data.subtitleMediaId ?? null,
        videoMediaId: data.videoMediaId ?? null,
        videoMeta: data.videoMeta ?? null,
        photoMediaIds: photoIds,
        globalInstruction: data.globalInstruction ?? null,
        targets,
      },
    })
    .returning({ id: aiGenerations.id });
  return { generationId: row!.id };
}

export async function getGeneration(userId: string, generationId: string): Promise<GenerationView> {
  const [row] = await db
    .select()
    .from(aiGenerations)
    .where(and(eq(aiGenerations.id, UuidSchema.parse(generationId)), eq(aiGenerations.userId, UuidSchema.parse(userId))))
    .limit(1);
  // Brief rows live in the same table but are not generations.
  if (!row || (row.scope as { kind?: string } | null)?.kind === "brief") return errors.notFound("Generation");
  const writers = z.array(WriterMetaSchema).catch([]).parse((row.usage as { writers?: unknown } | null)?.writers ?? []);
  return {
    id: row.id,
    status: row.status as GenerationView["status"],
    output: (row.output as GenerationView["output"]) ?? null,
    issues: z.array(GenerationIssueSchema).catch([]).parse(row.issues ?? []),
    targets: Object.fromEntries(writers.map(({ socialConnectionId, ...meta }) => [socialConnectionId, meta])),
    error: row.errorCode ? { code: row.errorCode, message: row.errorMessage ?? "Generation failed" } : null,
  };
}

// ---------------------------------------------------------------------------
// Job (Inngest)
// ---------------------------------------------------------------------------

export async function markGenerationRunning(id: string) {
  const [row] = await db
    .update(aiGenerations)
    .set({ status: "running", updatedAt: new Date() })
    .where(and(eq(aiGenerations.id, id), inArray(aiGenerations.status, ["queued", "running"])))
    .returning({ id: aiGenerations.id, userId: aiGenerations.userId });
  return row ?? null;
}

export async function markGenerationFailed(id: string, code: string, message: string) {
  await db
    .update(aiGenerations)
    .set({ status: "failed", errorCode: code, errorMessage: message.slice(0, 500), updatedAt: new Date() })
    // Keep the first (most specific) failure if onFailure runs after a permanent error.
    .where(and(eq(aiGenerations.id, id), inArray(aiGenerations.status, ["queued", "running"])));
}

/** Errors that won't fix themselves on retry (bad source, auth, invalid request). */
export function isPermanentGenerationError(error: unknown) {
  if (error instanceof SourceError) return true;
  if (error instanceof AiError) return !error.retryable;
  return false;
}

export function generationErrorCode(error: unknown) {
  if (error instanceof SourceError) return "invalid_source";
  if (error instanceof AiError) return error.kind;
  return "unknown";
}

function postTypeOf(platform: Platform, video: MediaRow | null, photoCount: number): PostType {
  if (!video) return postTypeFor(platform, photoCount > 1 ? "carousel" : "image");
  const portrait = video.metadata?.orientation === "portrait";
  const seconds = video.durationSeconds ?? Infinity;
  const shortMax = PLATFORMS[platform].capabilities.mediaRules.shortMaxSeconds;
  const short =
    platform === "instagram" || // every Instagram video is a Reel
    (platform === "youtube" && portrait && Boolean(shortMax) && seconds <= shortMax!) ||
    (platform === "facebook" && portrait && seconds <= 90);
  return postTypeFor(platform, short ? "short" : "video");
}

/** A video still uploading has no probed metadata yet: use what the browser read. */
function withVideoMeta(row: MediaRow, meta: z.infer<typeof StoredInputSchema>["videoMeta"]): MediaRow {
  if (!meta || row.durationSeconds != null) return row;
  const orientation = orientationOf(meta.width, meta.height);
  return {
    ...row,
    durationSeconds: meta.durationSeconds,
    width: meta.width,
    height: meta.height,
    metadata: { ...row.metadata, ...(orientation ? { orientation } : {}) },
  };
}

/** Everything a job step needs, re-read from the DB/storage (steps share nothing but ids). */
async function loadJob(id: string) {
  const [row] = await db.select().from(aiGenerations).where(eq(aiGenerations.id, id)).limit(1);
  if (!row) throw new SourceError("Generation not found");
  const input = StoredInputSchema.parse(row.input);
  const rows = await ownedMedia(
    row.userId,
    [input.jsonMediaId, input.subtitleMediaId, input.videoMediaId, ...input.photoMediaIds].filter(Boolean) as string[],
  );
  const sources = await loadSources({
    json: input.jsonMediaId ? (rows.get(input.jsonMediaId) ?? null) : null,
    subtitle: input.subtitleMediaId ? (rows.get(input.subtitleMediaId) ?? null) : null,
  });
  const photos = input.photoMediaIds.map((photoId) => rows.get(photoId)).filter((m): m is MediaRow => Boolean(m && m.type === "image"));
  if (!sources.json && !sources.transcript && photos.length === 0) throw new SourceError("The selected sources are no longer available");
  const stored = input.videoMediaId ? (rows.get(input.videoMediaId) ?? null) : null;
  const video = stored ? withVideoMeta(stored, input.videoMeta) : null;
  const source: SourceKind = sources.json ? "json" : sources.transcript ? "srt" : "photos";
  return { row, input, sources, photos, video, source };
}

/**
 * Step "brief": Stage 1. Builds (or reuses, by input hash) the brief and
 * links it to the generation. Returns counts only.
 */
export async function prepareGenerationJob(id: string, ai: AiClient = getAiClient()) {
  const { row, input, sources, photos } = await loadJob(id);
  const { briefId, cached: briefCached, usage, model } = await ensureBrief({
    ai,
    userId: row.userId,
    sources,
    photos,
    sourceMediaIds: (row.sourceMediaIds as string[] | null) ?? [],
  });
  await db
    .update(aiGenerations)
    .set({ input: sql`${aiGenerations.input} || ${JSON.stringify({ briefId })}::jsonb`, updatedAt: new Date() })
    .where(eq(aiGenerations.id, id));
  return { targets: input.targets.length, briefCached, usage, model };
}

export type WriterStepResult = {
  meta: WriterMeta | null;
  issues: GenerationIssue[];
  usage: AiUsage | null;
  model: string | null;
  fields: number;
};

/**
 * Step "write-N": Stage 2 + 3 for one account. The copy is merged straight
 * into ai_generations.output; only meta, counts and limit notes leave the step.
 */
export async function writeGenerationTarget(id: string, index: number, ai: AiClient = getAiClient()): Promise<WriterStepResult> {
  const { row, input, sources, photos, video, source } = await loadJob(id);
  const stored = input.targets[index];
  const none: WriterStepResult = { meta: null, issues: [], usage: null, model: null, fields: 0 };
  if (!stored) return none;
  const brief = input.briefId ? await loadBrief(row.userId, input.briefId) : null;
  if (!brief) throw new SourceError("The brief for this generation is missing");

  const [connection] = await db
    .select()
    .from(socialConnections)
    .where(and(eq(socialConnections.userId, row.userId), eq(socialConnections.id, stored.socialConnectionId)))
    .limit(1);
  const platform = connection ? platformForProvider(connection.provider) : null;
  if (!connection || !platform) return none;

  const mediaType = video ? "video" : "photos";
  const slideMediaIds = video ? [] : (stored.photoMediaIds ?? photos.map((p) => p.id)).filter((photoId) => photos.some((p) => p.id === photoId));
  const postType = postTypeOf(platform, video, slideMediaIds.length);
  const target: WriterTarget = {
    socialConnectionId: stored.socialConnectionId,
    platform,
    platformLabel: PLATFORMS[platform].label,
    postType,
    fields: aiFieldsFor(platform, mediaType).filter((f) => stored.fields.includes(f.name)),
    altTexts: stored.fields.includes(ALT_TEXTS),
    slideMediaIds,
    instruction: stored.instruction ?? undefined,
    taggedUsernames: stored.context?.taggedUsernames ?? [],
    collaborators: stored.context?.collaborators ?? [],
    // Description links aren't clickable on Shorts, so the line is long-form only.
    watchNext: postType === "video" ? (stored.context?.watchNext ?? null) : null,
  };
  const context = {
    ai,
    brief,
    jsonBlock: sources.json?.kind === "social" ? (sources.json.blocks[platform] ?? null) : null,
    jsonChapters: sources.json?.kind === "social" ? sources.json.chapters : [],
    cues: sources.transcript?.cues ?? {},
    durationSeconds: video?.durationSeconds ?? null,
    orientation: video?.metadata?.orientation ?? null,
    slideIndex: Object.fromEntries(photos.map((p, i) => [p.id, i + 1])),
    globalInstruction: input.globalInstruction ?? undefined,
  };

  let result;
  try {
    result = stored.hookOnly ? await rewriteHook(target, context, stored.current ?? {}) : await writeForTarget(target, context);
  } catch (error) {
    // A rejected request for one account must not sink the other accounts; outages still retry the step.
    if (!(error instanceof AiError) || error.retryable || error.kind === "auth") throw error;
    return { ...none, issues: [{ socialConnectionId: target.socialConnectionId, field: "account", message: `AI couldn't write this card: ${error.message}` }] };
  }

  await db
    .update(aiGenerations)
    .set({
      output: sql`coalesce(${aiGenerations.output}, '{}'::jsonb) || ${JSON.stringify({ [target.socialConnectionId]: result.output })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(aiGenerations.id, id));

  return {
    meta: { socialConnectionId: target.socialConnectionId, platform, postType, source, promptVersion: result.promptVersion },
    issues: result.issues.map((issue) => ({ socialConnectionId: target.socialConnectionId, ...issue })),
    usage: result.usage,
    model: result.model,
    fields: Object.keys(result.output).length,
  };
}

/** Step "finish": totals, notes and what wrote each card (platform, post type, PROMPT_VERSION). */
export async function finishGeneration(
  id: string,
  parts: { brief: { usage: AiUsage | null; model: string | null }; writers: WriterStepResult[] },
) {
  const metas = parts.writers.map((w) => w.meta).filter((m): m is WriterMeta => Boolean(m));
  const issues = parts.writers.flatMap((w) => w.issues);
  const usage = [parts.brief.usage, ...parts.writers.map((w) => w.usage)].reduce<AiUsage>(
    (sum, u) => (u ? { inputTokens: sum.inputTokens + u.inputTokens, outputTokens: sum.outputTokens + u.outputTokens, totalTokens: sum.totalTokens + u.totalTokens } : sum),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );
  const versions = [`brief@${BRIEF_PROMPT_VERSION}`, ...new Set(metas.map((m) => `${m.platform}/${m.postType}@${m.promptVersion}`))];
  await db
    .update(aiGenerations)
    .set({
      status: "succeeded",
      output: sql`coalesce(${aiGenerations.output}, '{}'::jsonb)`,
      issues,
      usage: { ...usage, writers: metas },
      model: parts.writers.find((w) => w.model)?.model ?? parts.brief.model,
      promptVersion: versions.join(";"),
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(aiGenerations.id, id));
  return { fields: parts.writers.reduce((n, w) => n + w.fields, 0), issues: issues.length };
}

export async function listInstructionPresets(userId: string, input: unknown) {
  const { cursor, limit } = ListInstructionPresetsInputSchema.parse(input);
  return cached({
    userId,
    group: "aiPresets",
    key: "listInstructionPresets",
    input: { cursor: cursor ?? null, limit },
    schema: InstructionPresetPageSchema,
    load: () => loadInstructionPresets(userId, { cursor, limit }),
  });
}

async function loadInstructionPresets(userId: string, { cursor, limit }: { cursor?: string | null; limit: number }) {
  const rows = await db.select({ row: aiInstructionPresets, cursorTs: cursorTimestamp(aiInstructionPresets.createdAt) })
    .from(aiInstructionPresets)
    .where(and(eq(aiInstructionPresets.userId, userId), afterCursor(aiInstructionPresets.createdAt, aiInstructionPresets.id, cursor ?? undefined)))
    .orderBy(desc(aiInstructionPresets.createdAt), desc(aiInstructionPresets.id))
    .limit(limit + 1);
  const page = toPage(rows.map(({ row, cursorTs }) => ({ id: row.id, cursorTs, row })), limit);
  return { items: page.items.map((item) => InstructionPresetViewSchema.parse(item.row)), nextCursor: page.nextCursor };
}

export async function createInstructionPreset(userId: string, input: unknown) {
  const data = CreateInstructionPresetInputSchema.parse(input);
  const [row] = await db.insert(aiInstructionPresets).values({ ...data, userId }).returning();
  await invalidate(userId, "aiPresets");
  return InstructionPresetViewSchema.parse(row);
}

