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

  /** HMAC pepper for API keys (openssl rand -base64 32). Only hashes are stored. */
  API_KEY_PEPPER: z.string().min(32, "must be at least 32 characters (openssl rand -base64 32)"),
  /** Set to "false" to disable rate limiting (local debugging only). */
  RATE_LIMIT_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

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
  /** w_member_social = Share on LinkedIn (post as the member). */
  LINKEDIN_SCOPES: z.string().default("openid profile email w_member_social"),
  /**
   * false (default): member posts use Share on LinkedIn (/v2/ugcPosts, w_member_social).
   * true: Community Management API (/rest/posts, /rest/videos) — needs that product.
   */
  LINKEDIN_USE_COMMUNITY_API: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /** Redis cache layer (services/cache). false = every read goes straight to Postgres. */
  CACHE_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  X_CLIENT_ID: optional,
  X_CLIENT_SECRET: optional,
  X_REDIRECT_URI: z.url().default("http://localhost:8000/api/oauth/x/callback"),
  X_SCOPES: z.string().default("tweet.read tweet.write users.read media.write offline.access"),

  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  GOOGLE_REDIRECT_URI: z.url().default("http://localhost:8000/api/oauth/youtube/callback"),
  YOUTUBE_SCOPES: z
    .string()
    // yt-analytics.readonly: analytics dashboard (YouTube Analytics API). Reconnect to grant.
    .default("openid email profile https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly"),

  FACEBOOK_CLIENT_ID: optional,
  FACEBOOK_CLIENT_SECRET: optional,
  FACEBOOK_REDIRECT_URI: z.url().default("http://localhost:8000/api/oauth/facebook/callback"),
  FACEBOOK_SCOPES: z
    .string()
    // read_insights + pages_read_engagement: analytics dashboard (Page insights). Reconnect to grant.
    .default("public_profile,pages_show_list,pages_read_engagement,pages_manage_posts,business_management,read_insights"),
  FACEBOOK_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default("v23.0"),

  /** App secret that signs Facebook deauthorize / data-deletion signed_requests (default FACEBOOK_CLIENT_SECRET). */
  META_APP_SECRET: optional,
  /** Threads app secret for the uninstall / delete callbacks (default THREADS_CLIENT_SECRET). */
  THREADS_APP_SECRET: optional,

  THREADS_CLIENT_ID: optional,
  THREADS_CLIENT_SECRET: optional,
  /** Threads only accepts HTTPS redirect URIs (use a tunnel such as ngrok locally). */
  THREADS_REDIRECT_URI: z.url().default("http://localhost:8000/api/oauth/threads/callback"),
  /** threads_delete lets Fannout delete posts it published. */
  /** threads_manage_insights: analytics dashboard. */
  THREADS_SCOPES: z.string().default("threads_basic,threads_content_publish,threads_delete,threads_manage_insights"),

  /**
   * Instagram API with Unified Login: same Meta app as Facebook (FACEBOOK_CLIENT_ID/SECRET), plus the
   * Facebook Login for Business configuration id. Permissions come from that configuration (no scope param).
   */
  INSTAGRAM_CONFIG_ID: optional,
  INSTAGRAM_REDIRECT_URI: z.url().default("http://localhost:8000/api/oauth/instagram/callback"),
  INSTAGRAM_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default("v27.0"),

  /** Scheduled posts: assumed upload speed to push platforms (Mbit/s) for the lead time. */
  SCHEDULE_UPLOAD_MBPS: z.coerce.number().positive().default(20),
  /** Lead time bounds (seconds): uploads start this long before scheduled_at. */
  SCHEDULE_LEAD_MIN_SECONDS: z.coerce.number().int().positive().default(30),
  SCHEDULE_LEAD_MAX_SECONDS: z.coerce.number().int().positive().default(30 * 60),
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
  const values = env as unknown as Record<string, string | undefined>;
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
  if (env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET && !env.INSTAGRAM_CONFIG_ID) {
    warnings.push("Instagram is disabled: INSTAGRAM_CONFIG_ID is not set.");
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
