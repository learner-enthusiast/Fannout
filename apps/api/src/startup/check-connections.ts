import { checkDatabaseConnection } from "@repo/database";
import { checkRedisConnection } from "@repo/redis";
import { checkBullMQConnection } from "@repo/bullmq";
import { checkS3Connection } from "@repo/s3";
import type { Dependency } from "@repo/services/health";

/** External services the API needs before it can serve requests. */
export const API_DEPENDENCIES: Dependency[] = [
  { name: "postgres", check: checkDatabaseConnection },
  { name: "redis", check: checkRedisConnection },
  { name: "bullmq", check: checkBullMQConnection },
  { name: "s3", check: checkS3Connection },
];
