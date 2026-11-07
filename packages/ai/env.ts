import { z } from "zod";

/** Backend only — the key is never sent to the browser. */
const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, "is required"),
  /** Cost-efficient default for short copywriting tasks. */
  OPENAI_MODEL: z.string().min(1).default("gpt-6-luna"),
  /** Log prompts/outputs (contain user content). Keep false outside local debugging. */
  AI_LOG_PROMPTS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type AiEnv = z.infer<typeof envSchema>;

let cached: AiEnv | undefined;

/** Parsed lazily so packages that import @repo/ai don't need the key until they call it. */
export function aiEnv(): AiEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid AI environment variables (@repo/ai):\n${lines.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}
