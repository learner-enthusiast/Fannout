import { getAiClient, type AiClient } from "@repo/ai";
import { logger } from "@repo/logger";
import { asc, db, eq, media, posts } from "@repo/database";
import { z } from "zod";
import { MediaRowSchema } from "../media/model";
import { PostNameSchema } from "../posts/model";
import { shortenToLimit } from "./model";
import { loadSources, type JsonSource } from "./sources";

export const POST_NAME_MAX = 100;
const FALLBACK = "Untitled post";

/** First line, whitespace collapsed, hashtags dropped, cut at a word boundary within 100. */
export function fallbackPostName(texts: (string | null | undefined)[]): string {
  for (const text of texts) {
    const line = (text ?? "").split("\n").find((l) => l.trim()) ?? "";
    const clean = line.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " ").replace(/\s+/g, " ").trim();
    if (clean) return shortenToLimit(clean, POST_NAME_MAX, "chars") || clean.slice(0, POST_NAME_MAX);
  }
  return FALLBACK;
}

/** What the model returns; the 100-char limit is enforced after (models don't honour lengths). */
const NameOutputSchema = z.object({ name: z.string().describe("Post name, at most 100 characters") });

function jsonSummary(json: JsonSource): string {
  if (json.kind === "generic") return json.text.slice(0, 4000);
  const lines = json.video ? [`Content: ${json.video}`] : [];
  for (const [platform, hint] of Object.entries(json.platforms)) {
    const text = hint.title ?? hint.shortsTitle ?? hint.post ?? hint.caption ?? hint.description;
    if (text) lines.push(`${platform}: ${text.slice(0, 400)}`);
  }
  return lines.join("\n");
}

/**
 * AI name for a post: short, specific, ≤100 chars, based on the social JSON
 * (primary) or the post titles/captions. Always returns a valid name
 * (shortened at a word boundary, or the fallback).
 */
export async function generatePostName(params: {
  ai?: AiClient;
  json?: JsonSource | null;
  titles: (string | null | undefined)[];
}): Promise<{ name: string; byAi: boolean }> {
  const titles = params.titles.filter((t): t is string => Boolean(t?.trim())).map((t) => t.trim().slice(0, 500));
  const fallback = fallbackPostName(params.json?.kind === "social" ? [params.json.video, ...titles] : titles);
  if (!params.json && titles.length === 0) return { name: fallback, byAi: false };

  const sources = [
    params.json ? `## Social JSON (primary)\n${jsonSummary(params.json)}` : null,
    titles.length ? `## Post titles and captions\n${titles.map((t) => `- ${t}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const result = await (params.ai ?? getAiClient()).generateStructured({
      system: [
        "Name a social media post for the user's own post list.",
        `- At most ${POST_NAME_MAX} characters. Specific and descriptive, like a headline.`,
        "- Use only what the sources say. No hashtags, emojis, quotes or trailing punctuation.",
        "- Same language as the sources. The JSON wins over the captions.",
      ].join("\n"),
      user: sources,
      schema: NameOutputSchema,
      schemaName: "post_name",
    });
    const raw = result.data.name.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " ").replace(/\s+/g, " ").trim();
    const fitted = shortenToLimit(raw, POST_NAME_MAX, "chars");
    const parsed = PostNameSchema.safeParse(fitted);
    return parsed.success ? { name: parsed.data, byAi: true } : { name: fallback, byAi: false };
  } catch (error) {
    logger.warn("AI post name failed; keeping the fallback", { error: (error as Error).message });
    return { name: fallback, byAi: false };
  }
}

/**
 * Names every post of a batch with one AI call and saves it. Uses the
 * social JSON the composer used (config.sourceJsonId) when there is one.
 * Never throws for AI problems — the fallback name stays.
 */
export async function nameBatchWithAi(batchId: string, ai?: AiClient) {
  const rows = await db.select().from(posts).where(eq(posts.batchId, batchId)).orderBy(asc(posts.createdAt));
  if (rows.length === 0) return { named: 0, byAi: false };

  const config = (rows[0]!.config ?? {}) as { sourceJsonId?: string; input?: Record<string, unknown> };
  let json: JsonSource | null = null;
  if (config.sourceJsonId) {
    const [row] = await db.select().from(media).where(eq(media.id, config.sourceJsonId)).limit(1);
    if (row && row.userId === rows[0]!.userId && row.type === "json" && row.status === "ready") {
      json = (await loadSources({ json: MediaRowSchema.parse(row) }).catch(() => ({ json: null }))).json;
    }
  }
  const titles = rows.flatMap((row) => {
    const input = ((row.config ?? {}) as { input?: Record<string, unknown> }).input ?? {};
    return [input.title, input.videoTitle, row.caption].filter((v): v is string => typeof v === "string");
  });

  const { name, byAi } = await generatePostName({ ai, json, titles });
  await db.update(posts).set({ name, updatedAt: new Date() }).where(eq(posts.batchId, batchId));
  return { named: rows.length, byAi };
}
