import { logger } from "@repo/logger";
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "prod"]).default("development"),
  /** Required: Clerk session verification. */
  CLERK_SECRET_KEY: z.string().min(1, "is required"),

  /** Web app origin; OAuth callbacks only ever redirect here. */
  WEB_URL: z.url().default("http://localhost:3000"),
  /** 32 random bytes, base64 encoded (`openssl rand -base64 32`). */
  TOKEN_ENCRYPTION_KEY: z
    .string({ error: "is required" })
    .min(1, "is required")
    .refine((value) => Buffer.from(value, "base64").length === 32, {
      message: "must be 32 bytes, base64 encoded (openssl rand -base64 32)",
    }),

  LINKEDIN_CLIENT_ID: optional,
  LINKEDIN_CLIENT_SECRET: optional,
  LINKEDIN_REDIRECT_URI: z.url().default("http://localhost:8000/api/oauth/linkedin/callback"),
  LINKEDIN_SCOPES: z.string().default("openid profile email"),

  X_CLIENT_ID: optional,
  X_CLIENT_SECRET: optional,
  X_REDIRECT_URI: z.url().default("http://localhost:8000/api/oauth/x/callback"),
  X_SCOPES: z.string().default("tweet.read users.read offline.access"),

  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  GOOGLE_REDIRECT_URI: z.url().default("http://localhost:8000/api/oauth/youtube/callback"),
  YOUTUBE_SCOPES: z
    .string()
    .default("openid email profile https://www.googleapis.com/auth/youtube.readonly"),

  FACEBOOK_CLIENT_ID: optional,
  FACEBOOK_CLIENT_SECRET: optional,
  FACEBOOK_REDIRECT_URI: z.url().default("http://localhost:8000/api/oauth/facebook/callback"),
  FACEBOOK_SCOPES: z
    .string()
    .default("public_profile,pages_show_list,pages_read_engagement,business_management"),
  FACEBOOK_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default("v23.0"),

  THREADS_CLIENT_ID: optional,
  THREADS_CLIENT_SECRET: optional,
  /** Threads only accepts HTTPS redirect URIs (use a tunnel such as ngrok locally). */
  THREADS_REDIRECT_URI: z.url().default("http://localhost:8000/api/oauth/threads/callback"),
  THREADS_SCOPES: z.string().default("threads_basic"),
});

/** Optional OAuth providers: all-or-nothing credentials, otherwise the provider is disabled. */
const OPTIONAL_PROVIDERS = [
  { name: "LinkedIn", id: "LINKEDIN_CLIENT_ID", secret: "LINKEDIN_CLIENT_SECRET" },
  { name: "X", id: "X_CLIENT_ID", secret: "X_CLIENT_SECRET", secretOptional: true },
  { name: "YouTube/Google", id: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET" },
  { name: "Facebook", id: "FACEBOOK_CLIENT_ID", secret: "FACEBOOK_CLIENT_SECRET" },
  { name: "Threads", id: "THREADS_CLIENT_ID", secret: "THREADS_CLIENT_SECRET" },
] as const;

function collectWarnings(env: z.infer<typeof envSchema>): string[] {
  const warnings: string[] = [];
  const values = env as Record<string, string | undefined>;
  for (const provider of OPTIONAL_PROVIDERS) {
    const id = values[provider.id];
    const secret = values[provider.secret];
    const optionalSecret = "secretOptional" in provider;
    if (!id && !secret) {
      warnings.push(
        `${provider.name} is disabled: ${provider.id} and ${provider.secret} are not set.`,
      );
    } else if (!id) {
      warnings.push(`${provider.name} is disabled: ${provider.id} is not set.`);
    } else if (!secret && !optionalSecret) {
      warnings.push(`${provider.name} is disabled: ${provider.secret} is not set.`);
    }
  }
  if (env.THREADS_CLIENT_ID && !env.THREADS_REDIRECT_URI.startsWith("https://")) {
    warnings.push(
      "THREADS_REDIRECT_URI must be HTTPS; Threads will reject it (use a tunnel such as ngrok).",
    );
  }
  return warnings;
}

function createEnv(env: NodeJS.ProcessEnv) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid environment variables (@repo/services):\n${lines.join("\n")}`);
  }
  for (const warning of collectWarnings(result.data)) logger.warn(`[env] ${warning}`);
  return result.data;
}

export const env = createEnv(process.env);
export type ServicesEnv = typeof env;
