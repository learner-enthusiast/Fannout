import { HeadBucketCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { env } from "./env";

function clientConfig(endpoint: string | undefined): S3ClientConfig {
  const forcePathStyle = env.S3_FORCE_PATH_STYLE
    ? env.S3_FORCE_PATH_STYLE === "true"
    : Boolean(env.S3_ENDPOINT);
  return {
    region: env.S3_REGION,
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle,
    ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
    // The SDK adds CRC checksums by default; S3-compatible stores (MinIO) and
    // browser uploads to presigned URLs don't always handle them.
    ...(endpoint
      ? { requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" }
      : {}),
  };
}

let client: S3Client | undefined;
let publicClient: S3Client | undefined;
let uploadClient: S3Client | undefined;

/** Shared client for server-side operations. */
export function getS3Client(): S3Client {
  client ??= new S3Client(clientConfig(env.S3_ENDPOINT));
  return client;
}

/** Client used only to sign URLs that browsers will call. */
export function getPublicS3Client(): S3Client {
  if (!env.S3_PUBLIC_ENDPOINT || env.S3_PUBLIC_ENDPOINT === env.S3_ENDPOINT) return getS3Client();
  publicClient ??= new S3Client(clientConfig(env.S3_PUBLIC_ENDPOINT));
  return publicClient;
}

/**
 * Client used only to sign browser upload URLs. In development it signs against
 * the local S3_ENDPOINT (fast, no tunnel round trip); set S3_UPLOAD_ENDPOINT to
 * override, e.g. when the browser runs on another machine.
 */
export function getUploadS3Client(): S3Client {
  const endpoint =
    env.S3_UPLOAD_ENDPOINT ?? (env.NODE_ENV === "development" ? env.S3_ENDPOINT : env.S3_PUBLIC_ENDPOINT);
  if (!endpoint || endpoint === env.S3_ENDPOINT) return getS3Client();
  if (endpoint === env.S3_PUBLIC_ENDPOINT) return getPublicS3Client();
  uploadClient ??= new S3Client(clientConfig(endpoint));
  return uploadClient;
}

export const defaultBucket = () => env.S3_BUCKET;
export const defaultRegion = () => env.S3_REGION;

export function closeS3(): void {
  client?.destroy();
  publicClient?.destroy();
  uploadClient?.destroy();
  client = undefined;
  publicClient = undefined;
  uploadClient = undefined;
}

/** HEAD the default bucket. Throws if S3 is unreachable, credentials are wrong or the bucket is missing. */
export async function checkS3Connection(): Promise<void> {
  await getS3Client().send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
}
