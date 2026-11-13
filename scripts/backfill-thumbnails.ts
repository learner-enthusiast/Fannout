/**
 * Generates thumbnails for ready images/videos that don't have one (uploaded before thumbnails existed).
 *
 *   pnpm --filter @repo/api exec dotenv -e ../../.env -- tsx ../../scripts/backfill-thumbnails.ts [--limit 200]
 *
 * Idempotent: skips media that already has metadata.thumbnailKey; failures are logged and skipped.
 */
import { and, db, eq, inArray, media } from "../packages/database";
import { getDownloadUrl, uploadObject } from "../packages/s3";
import { MediaRowSchema } from "../packages/services/media/model";
import { generateThumbnail, thumbnailKeyFor } from "../packages/services/media/thumbnail";
import { setMediaThumbnail } from "../packages/services/media/uploads";

const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 200;

async function main() {
  const rows = await db
    .select()
    .from(media)
    .where(and(eq(media.status, "ready"), inArray(media.type, ["image", "video"])));
  const todo = rows.map((r) => MediaRowSchema.parse(r)).filter((r) => !r.metadata?.thumbnailKey).slice(0, limit);
  console.log(`${todo.length} to process (of ${rows.length} ready images/videos)`);
  let done = 0;
  for (const row of todo) {
    try {
      const url = await getDownloadUrl(row.s3Key, { bucket: row.s3Bucket, internal: true, expiresIn: 15 * 60 });
      const jpeg = await generateThumbnail(url, row.type as "image" | "video", row.durationSeconds);
      const key = thumbnailKeyFor(row.s3Key);
      await uploadObject(key, jpeg, { bucket: row.s3Bucket, contentType: "image/jpeg", cacheControl: "private, max-age=31536000" });
      await setMediaThumbnail(row.id, key);
      done += 1;
    } catch (error) {
      console.warn(`skip ${row.id}: ${(error as Error).message.slice(0, 160)}`);
    }
  }
  console.log(`done: ${done}/${todo.length}`);
  process.exit(0);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
