/**
 * Fills mention_contacts (platform instagram) from posts already published to Instagram: tagged
 * usernames (posts.config.instagram.tags), collaborators and @handles in the caption.
 *
 *   pnpm mentions:backfill-instagram
 *
 * Idempotent: use_count becomes greatest(current, posts that used the handle) and last_used_at the
 * latest publish time, so running it twice changes nothing. Contacts are matched case-insensitively.
 */
import { and, db, eq, posts, sql } from "../packages/database";
import { instagramHandlesOfPost, upsertInstagramContacts } from "../packages/services/mentions";
import { PostConfigSchema } from "../packages/services/publishing/model";

async function main() {
  const rows = await db
    .select({ userId: posts.userId, config: posts.config, caption: posts.caption, publishedAt: posts.publishedAt, updatedAt: posts.updatedAt })
    .from(posts)
    .where(and(eq(posts.status, "published"), sql`${posts.config} ->> 'platform' = 'instagram'`));

  // user → handle → { posts that used it, latest use }
  const byUser = new Map<string, Map<string, { count: number; lastUsedAt: Date | null }>>();
  for (const row of rows) {
    const config = PostConfigSchema.safeParse(row.config);
    if (!config.success) continue;
    const input = config.data.input;
    const handles = instagramHandlesOfPost({
      tags: config.data.instagram?.tags ?? [],
      collaborators: input.collaborators ?? [],
      caption: typeof input.caption === "string" ? input.caption : (row.caption ?? ""),
    });
    const usedAt = row.publishedAt ?? row.updatedAt ?? null;
    const usage = byUser.get(row.userId) ?? new Map();
    for (const handle of handles) {
      const current = usage.get(handle) ?? { count: 0, lastUsedAt: null };
      usage.set(handle, {
        count: current.count + 1,
        lastUsedAt: usedAt && (!current.lastUsedAt || usedAt > current.lastUsedAt) ? usedAt : current.lastUsedAt,
      });
    }
    byUser.set(row.userId, usage);
  }

  let contacts = 0;
  for (const [userId, usage] of byUser) contacts += await upsertInstagramContacts(userId, usage, "atLeast");
  console.log(`${rows.length} published Instagram posts, ${byUser.size} users, ${contacts} contacts upserted`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
