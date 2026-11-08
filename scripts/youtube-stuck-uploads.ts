/**
 * Lists (and with --confirm deletes) YouTube videos Fannout created that are
 * stuck: uploadStatus still "uploaded" more than 2 h after upload — the
 * leftovers of the old single-request uploads that were cut and retried.
 *
 *   pnpm youtube:stuck --user <userId> --connection <socialConnectionId> [--confirm]
 *
 * A video counts as Fannout's when a post on this connection references its id
 * (posts.config.progress.youtube.externalVideoId / progress.videoId), or its title
 * equals that post's title and it was uploaded within ±6 h of the post being
 * created. Videos that are a published post's external_post_id are never touched.
 * Quota: list calls ≈ 1 unit/page; each delete costs 50 units (printed first).
 */
import { and, db, eq, posts } from "../packages/database";
import { YouTubeProvider } from "../packages/providers";
import { createProviderForConnection } from "../packages/services/provider-factory";

const STUCK_AFTER_MS = 2 * 60 * 60 * 1000;
const TITLE_WINDOW_MS = 6 * 60 * 60 * 1000;
const DELETE_COST = 50;
const MAX_UPLOADS_SCANNED = 500;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const userId = arg("user");
  const connectionId = arg("connection");
  const confirm = process.argv.includes("--confirm");
  if (!userId || !connectionId) throw new Error("Usage: --user <userId> --connection <socialConnectionId> [--confirm]");

  const youtube = await createProviderForConnection({ userId, connectionId });
  if (!(youtube instanceof YouTubeProvider)) throw new Error("Not a YouTube connection");

  // What Fannout knows about this connection's posts.
  const rows = await db
    .select({ id: posts.id, status: posts.status, externalPostId: posts.externalPostId, config: posts.config, createdAt: posts.createdAt })
    .from(posts)
    .where(and(eq(posts.userId, userId), eq(posts.socialConnectionId, connectionId)));
  const protectedIds = new Set(rows.filter((r) => r.status === "published" && r.externalPostId).map((r) => r.externalPostId!));
  const knownIds = new Map<string, string>();
  const titled: { postId: string; title: string; createdAt: number }[] = [];
  for (const row of rows) {
    const config = (row.config ?? {}) as { input?: { title?: string }; progress?: { videoId?: string; youtube?: { externalVideoId?: string } } };
    for (const id of [config.progress?.youtube?.externalVideoId, config.progress?.videoId]) if (id) knownIds.set(id, row.id);
    if (config.input?.title) titled.push({ postId: row.id, title: config.input.title, createdAt: row.createdAt.getTime() });
  }

  // The channel's uploads playlist, newest first.
  const channels = await youtube.listChannels({ part: ["contentDetails"], mine: true });
  const uploads = channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error("Channel has no uploads playlist");
  const videoIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await youtube.listPlaylistItem({ part: ["contentDetails"], playlistId: uploads, maxResults: 50, ...(pageToken ? { pageToken } : {}) });
    for (const item of page.items ?? []) if (item.contentDetails?.videoId) videoIds.push(item.contentDetails.videoId);
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken && videoIds.length < MAX_UPLOADS_SCANNED);

  const stuck: { id: string; title: string; uploadedAt: string; postId: string; reason: string }[] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = await youtube.listVideo({ part: ["status", "snippet"], id: videoIds.slice(i, i + 50), maxResults: 50 });
    for (const video of batch.items ?? []) {
      if (!video.id || protectedIds.has(video.id)) continue;
      const uploadedAt = video.snippet?.publishedAt ? Date.parse(video.snippet.publishedAt) : NaN;
      if (video.status?.uploadStatus !== "uploaded" || !(Date.now() - uploadedAt > STUCK_AFTER_MS)) continue;
      const title = video.snippet?.title ?? "";
      const byId = knownIds.get(video.id);
      const byTitle = titled.find((p) => p.title === title && Math.abs(p.createdAt - uploadedAt) <= TITLE_WINDOW_MS);
      const postId = byId ?? byTitle?.postId;
      if (!postId) continue; // not ours: never touch
      stuck.push({ id: video.id, title, uploadedAt: new Date(uploadedAt).toISOString(), postId, reason: byId ? "id" : "title+time" });
    }
  }

  console.log(`Scanned ${videoIds.length} uploads; ${stuck.length} stuck video(s) created by Fannout:`);
  for (const v of stuck) console.log(`  ${v.id}  ${v.uploadedAt}  post=${v.postId}  match=${v.reason}  "${v.title}"`);
  if (stuck.length === 0) return;
  console.log(`Deleting them would cost ${stuck.length * DELETE_COST} quota units (${DELETE_COST} each).`);
  if (!confirm) {
    console.log("Dry run. Re-run with --confirm to delete.");
    return;
  }
  for (const v of stuck) {
    await youtube.deleteVideo({ id: v.id });
    console.log(`  deleted ${v.id}`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
