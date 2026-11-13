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
  INNGEST_DEV: z.string().optional(),
});

/** Local Inngest dev server (`INNGEST_DEV=1` or a dev server URL). Independent of NODE_ENV. */
export function isInngestDevEnabled(raw: NodeJS.ProcessEnv): boolean {
  const value = raw.INNGEST_DEV;
  if (value === undefined || value === "") return false;
  if (value === "0" || value === "false") return false;
  return true;
}

function createEnv(raw: NodeJS.ProcessEnv) {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.message);
  const inngestDev = isInngestDevEnabled(raw);
  if (parsed.data.NODE_ENV === "prod" && !inngestDev && !parsed.data.INNGEST_SIGNING_KEY) {
    throw new Error("INNGEST_SIGNING_KEY is required in prod when INNGEST_DEV is not enabled");
  }
  return { ...parsed.data, inngestDev };
}

export const env = createEnv(process.env);
