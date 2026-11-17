import { createHash } from "node:crypto";
import { BRIEF_PROMPT_VERSION, BRIEF_SYSTEM_PROMPT, BriefSchema, type AiClient, type AiUsage, type Brief } from "@repo/ai";
import { aiGenerations, and, db, desc, eq, sql } from "@repo/database";
import type { MediaRow } from "../media/model";
import { loadImages, MAX_AI_IMAGES, type Sources } from "./sources";

/**
 * Stage 1: one brief per set of inputs. It is stored as its own
 * ai_generations row (scope { kind: "brief", hash }) and reused by every
 * later generation with the same JSON / subtitles / photos — "Generate all",
 * a single card and "hook only" all share it.
 */

export function briefHash(sources: Sources, photoIds: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ version: BRIEF_PROMPT_VERSION, json: sources.json, transcript: sources.transcript?.text ?? null, photos: photoIds }))
    .digest("hex");
}

function briefUserPrompt(sources: Sources, slideIndexes: number[], photoCount: number): string {
  const parts: string[] = [];
  if (sources.json?.kind === "social") {
    parts.push("## SOCIAL JSON (first priority: the author's own drafts per platform)");
    if (sources.json.video) parts.push(`Content: ${sources.json.video}`);
    for (const [platform, block] of Object.entries(sources.json.blocks)) parts.push(`### ${platform}\n${block}`);
  } else if (sources.json?.kind === "generic") {
    parts.push(`## JSON (first priority)${sources.json.truncated ? " — truncated" : ""}\n${sources.json.text}`);
  }
  if (sources.transcript) {
    parts.push(
      `## TRANSCRIPT (second priority; lines are "[cueId mm:ss] text"${sources.transcript.truncated ? "; cut to fit, some parts are missing" : ""})\n${sources.transcript.text}`,
    );
  }
  if (slideIndexes.length) {
    parts.push(
      `## IMAGES\n${slideIndexes.length} image${slideIndexes.length === 1 ? " is" : "s are"} attached, in slide order: ${slideIndexes.map((n) => `slide ${n}`).join(", ")}.` +
        (photoCount > slideIndexes.length ? ` The post has ${photoCount} slides; describe only the attached ones.` : ""),
    );
  }
  if (!sources.transcript) parts.push("No transcript: chapterCandidates and quotes are empty.");
  if (!slideIndexes.length) parts.push("No images: slides is empty.");
  return parts.join("\n\n");
}

export async function ensureBrief(params: {
  ai: AiClient;
  userId: string;
  sources: Sources;
  photos: MediaRow[];
  sourceMediaIds: string[];
  model?: string;
}): Promise<{ briefId: string; brief: Brief; cached: boolean; usage: AiUsage | null; model: string | null }> {
  const { ai, userId, sources, photos } = params;
  const hash = briefHash(sources, photos.map((p) => p.id));
  const [existing] = await db
    .select({ id: aiGenerations.id, output: aiGenerations.output })
    .from(aiGenerations)
    .where(and(eq(aiGenerations.userId, userId), eq(aiGenerations.status, "succeeded"), sql`${aiGenerations.scope}->>'hash' = ${hash}`))
    .orderBy(desc(aiGenerations.createdAt))
    .limit(1);
  const stored = existing ? BriefSchema.safeParse(existing.output) : null;
  if (existing && stored?.success) return { briefId: existing.id, brief: stored.data, cached: true, usage: null, model: null };

  const { images, slideIndexes } = await loadImages(photos.slice(0, MAX_AI_IMAGES));
  const result = await ai.generateStructured({
    system: BRIEF_SYSTEM_PROMPT,
    user: briefUserPrompt(sources, slideIndexes, photos.length),
    schema: BriefSchema,
    schemaName: "brief",
    images,
    model: params.model,
  });
  // Slides keep the numbers we assigned, whatever the model returned.
  const brief: Brief = { ...result.data, slides: result.data.slides.filter((s) => slideIndexes.includes(s.index)) };
  const [row] = await db
    .insert(aiGenerations)
    .values({
      userId,
      status: "succeeded",
      scope: { kind: "brief", hash },
      sourceMediaIds: params.sourceMediaIds,
      input: {},
      output: brief,
      usage: result.usage,
      model: result.model,
      promptVersion: BRIEF_PROMPT_VERSION,
    })
    .returning({ id: aiGenerations.id });
  return { briefId: row!.id, brief, cached: false, usage: result.usage, model: result.model };
}

export async function loadBrief(userId: string, briefId: string): Promise<Brief | null> {
  const [row] = await db
    .select({ output: aiGenerations.output })
    .from(aiGenerations)
    .where(and(eq(aiGenerations.id, briefId), eq(aiGenerations.userId, userId)))
    .limit(1);
  const parsed = row ? BriefSchema.safeParse(row.output) : null;
  return parsed?.success ? parsed.data : null;
}
