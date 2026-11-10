import { AiError, getAiClient, type AiClient } from "@repo/ai";
import { aiGenerations, aiInstructionPresets, and, db, desc, eq, inArray, media, socialConnections } from "@repo/database";
import { errors } from "@repo/errors";
import { z } from "zod";
import { MediaRowSchema, type MediaRow } from "../media/model";
import { PLATFORMS, platformForProvider } from "../publishing/platforms";
import { runGeneration, type GenerationTarget } from "./generate";
import { aiFieldsFor, CreateInstructionPresetInputSchema, GenerateInputBaseSchema, GenerationIssueSchema, InstructionPresetViewSchema, ListInstructionPresetsInputSchema, NO_SOURCE_MESSAGE, type GenerationView } from "./model";
import { afterCursor, cursorTimestamp, toPage } from "../common/pagination";
import { loadSources, SourceError } from "./sources";

const UuidSchema = z.uuid();

const StoredInputSchema = z.object({
  jsonMediaId: z.uuid().nullable(),
  subtitleMediaId: z.uuid().nullable(),
  videoMediaId: z.uuid().nullable(),
  globalInstruction: z.string().nullable(),
  targets: z.array(z.object({ socialConnectionId: z.uuid(), fields: z.array(z.string()), instruction: z.string().nullable() })),
});

async function ownedMedia(userId: string, ids: string[]): Promise<Map<string, MediaRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(media).where(and(eq(media.userId, userId), inArray(media.id, ids)));
  return new Map(rows.map((row) => [row.id, MediaRowSchema.parse(row)]));
}

function requireMedia(rows: Map<string, MediaRow>, id: string | undefined, type: MediaRow["type"], label: string) {
  if (!id) return null;
  const row = rows.get(id);
  if (!row) return errors.notFound(label);
  if (row.type !== type) return errors.badRequest(`${label} must be a ${type} file`);
  if (row.status !== "ready") return errors.badRequest(`${label} isn't ready yet`);
  return row;
}

/**
 * Validates the request (ownership, ready media, known fields) and stores a
 * queued generation. The caller sends the Inngest event. No source text is saved.
 */
export async function createGeneration(userId: string, input: z.input<typeof GenerateInputBaseSchema>) {
  const data = GenerateInputBaseSchema.parse(input);
  if (!data.jsonMediaId && !data.subtitleMediaId) return errors.validation(NO_SOURCE_MESSAGE);
  const owner = UuidSchema.parse(userId);

  const rows = await ownedMedia(owner, [data.jsonMediaId, data.subtitleMediaId, data.videoMediaId].filter(Boolean) as string[]);
  requireMedia(rows, data.jsonMediaId, "json", "Social JSON");
  requireMedia(rows, data.subtitleMediaId, "subtitle", "Subtitles");
  requireMedia(rows, data.videoMediaId, "video", "Video");
  const mediaType = data.videoMediaId ? "video" : "photos";

  const connections = await db
    .select({ id: socialConnections.id, provider: socialConnections.provider })
    .from(socialConnections)
    .where(and(eq(socialConnections.userId, owner), inArray(socialConnections.id, data.targets.map((t) => t.socialConnectionId))));

  const targets = data.targets.map((target) => {
    const connection = connections.find((c) => c.id === target.socialConnectionId);
    if (!connection) return errors.notFound("Account");
    const platform = platformForProvider(connection.provider);
    const available = platform ? aiFieldsFor(platform, mediaType).map((f) => f.name) : [];
    if (available.length === 0) return errors.badRequest(`AI can't write for ${connection.provider} yet`);
    const fields = target.fields ?? available;
    const unknown = fields.filter((f) => !available.includes(f));
    if (unknown.length) return errors.badRequest(`AI can't write ${unknown.join(", ")} for ${PLATFORMS[platform!].label}`);
    return { socialConnectionId: target.socialConnectionId, fields, instruction: target.instruction ?? null };
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
      sourceMediaIds: [data.jsonMediaId, data.subtitleMediaId].filter(Boolean) as string[],
      input: {
        jsonMediaId: data.jsonMediaId ?? null,
        subtitleMediaId: data.subtitleMediaId ?? null,
        videoMediaId: data.videoMediaId ?? null,
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
  if (!row) return errors.notFound("Generation");
  return {
    id: row.id,
    status: row.status as GenerationView["status"],
    output: (row.output as GenerationView["output"]) ?? null,
    issues: z.array(GenerationIssueSchema).catch([]).parse(row.issues ?? []),
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

/**
 * Loads sources (JSON first, then subtitles) + targets + video info, runs the
 * generation and stores output/issues/usage. Source text and outputs are
 * never logged here.
 */
export async function runGenerationJob(id: string, ai: AiClient = getAiClient()) {
  const [row] = await db.select().from(aiGenerations).where(eq(aiGenerations.id, id)).limit(1);
  if (!row) throw new SourceError("Generation not found");
  const input = StoredInputSchema.parse(row.input);
  const rows = await ownedMedia(
    row.userId,
    [input.jsonMediaId, input.subtitleMediaId, input.videoMediaId].filter(Boolean) as string[],
  );
  const sources = await loadSources({
    json: input.jsonMediaId ? (rows.get(input.jsonMediaId) ?? null) : null,
    subtitle: input.subtitleMediaId ? (rows.get(input.subtitleMediaId) ?? null) : null,
  });
  if (!sources.json && !sources.transcript) throw new SourceError("The selected sources are no longer available");

  const video = input.videoMediaId ? (rows.get(input.videoMediaId) ?? null) : null;
  const mediaType = video ? "video" : "photos";
  const connections = await db
    .select()
    .from(socialConnections)
    .where(and(eq(socialConnections.userId, row.userId), inArray(socialConnections.id, input.targets.map((t) => t.socialConnectionId))));

  const targets: GenerationTarget[] = input.targets.flatMap((target, index) => {
    const connection = connections.find((c) => c.id === target.socialConnectionId);
    const platform = connection ? platformForProvider(connection.provider) : null;
    if (!connection || !platform) return [];
    const fields = aiFieldsFor(platform, mediaType).filter((f) => target.fields.includes(f.name));
    const rules = PLATFORMS[platform].capabilities.mediaRules;
    const orientation = video?.metadata?.orientation ?? null;
    return [
      {
        key: `t${index + 1}`,
        socialConnectionId: target.socialConnectionId,
        platform,
        platformLabel: PLATFORMS[platform].label,
        accountName: connection.displayName ?? connection.username ?? PLATFORMS[platform].label,
        fields,
        instruction: target.instruction ?? undefined,
        isShort: Boolean(rules.shortMaxSeconds && orientation === "portrait" && (video?.durationSeconds ?? Infinity) <= rules.shortMaxSeconds),
      },
    ];
  });
  if (targets.length === 0) throw new SourceError("None of the selected accounts are available");

  const result = await runGeneration({
    ai,
    targets,
    sources,
    globalInstruction: input.globalInstruction ?? undefined,
    video: video ? { orientation: video.metadata?.orientation ?? null, durationSeconds: video.durationSeconds } : null,
  });

  await db
    .update(aiGenerations)
    .set({
      status: "succeeded",
      output: result.output,
      issues: result.issues,
      usage: result.usage,
      model: result.model,
      promptVersion: result.promptVersion,
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(aiGenerations.id, id));
  return { fields: Object.values(result.output).reduce((n, o) => n + Object.keys(o).length, 0), issues: result.issues.length };
}

export async function listInstructionPresets(userId: string, input: unknown) {
  const { cursor, limit } = ListInstructionPresetsInputSchema.parse(input);
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
  return InstructionPresetViewSchema.parse(row);
}

