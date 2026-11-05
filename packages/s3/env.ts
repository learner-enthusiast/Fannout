import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "prod"]).default("development"),
  /** Custom endpoint for S3-compatible storage (MinIO). Leave empty for AWS S3. */
  S3_ENDPOINT: optional.pipe(z.url().optional()),
  /**
   * Endpoint browsers use for presigned URLs, when it differs from the one the
   * server uses (e.g. server → http://minio:9000, browser → http://localhost:9000).
   */
  S3_PUBLIC_ENDPOINT: optional.pipe(z.url().optional()),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(3).default("fannout-media"),
  /** Optional on AWS (falls back to the default credential chain, e.g. IAM roles). */
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  /** Path-style URLs (http://host/bucket/key). Needed for MinIO; defaults to on when S3_ENDPOINT is set. */
  S3_FORCE_PATH_STYLE: optional.pipe(z.enum(["true", "false"]).optional()),
});

function createEnv(env: NodeJS.ProcessEnv) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

export const env = createEnv(process.env);
