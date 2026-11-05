import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "prod"]).default("development"),
  CLERK_SECRET_KEY: z.string().optional(),

  /** Web app origin; OAuth callbacks only ever redirect here. */
  WEB_URL: z.url().default("http://localhost:3000"),
  /** 32 random bytes, base64 encoded (`openssl rand -base64 32`). */
  TOKEN_ENCRYPTION_KEY: optional,

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
  FACEBOOK_SCOPES: z.string().default("public_profile,pages_show_list,pages_read_engagement"),
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

function createEnv(env: NodeJS.ProcessEnv) {
  const safeParseResult = envSchema.safeParse(env);
  if (!safeParseResult.success) throw new Error(safeParseResult.error.message);
  return safeParseResult.data;
}

export const env = createEnv(process.env);
export type ServicesEnv = typeof env;
