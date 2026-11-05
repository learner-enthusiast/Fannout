import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "prod"]).default("development"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  /** Namespace for cache keys (BullMQ uses its own "bull:" prefix). */
  REDIS_CACHE_PREFIX: z.string().default("fannout:cache:"),
});

function createEnv(env: NodeJS.ProcessEnv) {
  const safeParseResult = envSchema.safeParse(env);
  if (!safeParseResult.success) throw new Error(safeParseResult.error.message);
  return safeParseResult.data;
}

export const env = createEnv(process.env);
