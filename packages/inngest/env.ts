import { z } from "zod";

/**
 * The SDK also reads INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY and INNGEST_DEV
 * itself; they're listed here so misconfiguration fails at startup.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "prod"]).default("development"),
  INNGEST_APP_ID: z.string().default("fannout"),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
});

function createEnv(env: NodeJS.ProcessEnv) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error(parsed.error.message);
  if (parsed.data.NODE_ENV === "prod" && !parsed.data.INNGEST_SIGNING_KEY) {
    throw new Error("INNGEST_SIGNING_KEY is required in prod");
  }
  return parsed.data;
}

export const env = createEnv(process.env);
