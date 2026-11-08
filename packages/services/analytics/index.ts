import {
  analyticsAccountDaily,
  analyticsPostSnapshots,
  analyticsSyncState,
  and,
  asc,
  db,
  desc,
  eq,
  gte,
  inArray,
  lte,
  media,
  postMedia,
  posts,
  scheduledPosts,
  socialConnections,
  sql,
} from "@repo/database";
import { errors } from "@repo/errors";
import { decodeKeyCursor, toKeyPage } from "../common/pagination";
import { MediaRowSchema } from "../media/model";
import { presignedUrl } from "../media/views";
import { platformForProvider, type Platform } from "../publishing/platforms";
import { ANALYTICS_CAPABILITIES, missingScopes } from "./capabilities";
import {
  BestTimesInputSchema,
  MetricsSchema,
  OverviewInputSchema,
  TopPostsInputSchema,
  engagementOf,
  type Availability,
  type BestTimesInput,
  type Kpi,
  type MetricKey,
  type Metrics,
  type Overview,
  type OverviewInput,
  type Range,
  type TopPostsInput,
} from "./model";
import { MANUAL_REFRESH_INTERVAL_MS } from "./sync";

/*
 * Dashboard reads. Everything here comes from our tables (analytics_*, posts,
 * scheduled_posts) — never from a platform API (those calls live in ./sync, run by Inngest).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS = { "7d": 7, "28d": 28, "90d": 90 } as const;

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const todayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export function resolveRange(range: Range, timeZone: string) {
  let from: string;
  let to: string;
  if (typeof range === "string") {
    to = todayIn(timeZone);
    from = addDays(to, -(RANGE_DAYS[range] - 1));
  } else {
    ({ from, to } = range);
    if (from > to) return errors.badRequest("from must be on or before to");
    if ((Date.parse(to) - Date.parse(from)) / DAY_MS > 365) return errors.badRequest("Custom ranges can span at most 366 days");
  }
  const length = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
  return { from, to, previousFrom: addDays(from, -length), previousTo: addDays(from, -1) };
}

const kpi = (current: number | null, previous: number | null): Kpi => ({
  current,
  previous,
  deltaPercent: current !== null && previous !== null && previous !== 0 ? ((current - previous) / previous) * 100 : null,
});

const sumOrNull = (values: (number | null | undefined)[]) => {
  const present = values.filter((v): v is number => typeof v === "number");
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
};

type Conn = { id: string; platform: Platform; username: string | null; scopes: string[] | null; hasToken: boolean };

/** The user's active connections (created order), optionally just one. */
async function userConnections(userId: string, connectionId?: string): Promise<Conn[]> {
  const rows = await db
    .select({
      id: socialConnections.id,
      provider: socialConnections.provider,
      username: socialConnections.username,
      scopes: socialConnections.scopes,
      token: socialConnections.accessTokenEncrypted,
    })
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.userId, userId),
        eq(socialConnections.isActive, true),
        connectionId ? eq(socialConnections.id, connectionId) : undefined,
      ),
    )
    .orderBy(asc(socialConnections.createdAt), asc(socialConnections.id));
  if (connectionId && rows.length === 0) return errors.notFound("Social connection");
  return rows.flatMap((r) => {
    const platform = platformForProvider(r.provider);
    return platform ? [{ id: r.id, platform, username: r.username, scopes: r.scopes, hasToken: Boolean(r.token) }] : [];
  });
}

async function availabilityFor(conns: Conn[]): Promise<(Availability & { state: typeof analyticsSyncState.$inferSelect | null })[]> {
  if (conns.length === 0) return [];
  const ids = conns.map((c) => c.id);
  const [states, withDaily, withPosts] = await Promise.all([
    db.select().from(analyticsSyncState).where(inArray(analyticsSyncState.socialConnectionId, ids)),
    db.selectDistinct({ id: analyticsAccountDaily.socialConnectionId }).from(analyticsAccountDaily).where(inArray(analyticsAccountDaily.socialConnectionId, ids)),
    db.selectDistinct({ id: analyticsPostSnapshots.socialConnectionId }).from(analyticsPostSnapshots).where(inArray(analyticsPostSnapshots.socialConnectionId, ids)),
  ]);
  const hasData = new Set([...withDaily, ...withPosts].map((r) => r.id));
  return conns.map((c) => {
    const cap = ANALYTICS_CAPABILITIES[c.platform];
    const state = states.find((s) => s.socialConnectionId === c.id) ?? null;
    const missing = missingScopes(c.platform, c.scopes);
    const last = [state?.lastAccountSyncAt, state?.lastPostSyncAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
    const status: Availability["status"] = !cap.supported
      ? "unsupported"
      : missing.length || !c.hasToken || state?.status === "needs_reconnect"
        ? "needs_reconnect"
        : state?.status === "error" && !hasData.has(c.id)
          ? "error"
          : hasData.has(c.id)
            ? "ready"
            : "no_data";
    return {
      connectionId: c.id,
      platform: c.platform,
      username: c.username,
      status,
      missingScopes: missing,
      lastSyncedAt: last ? last.toISOString() : null,
      note: cap.note ?? null,
      state,
    };
  });
}

type DailyRow = { connectionId: string; date: string; metrics: Metrics };

/** Account totals for a window. Followers net = Σ gained − Σ lost, else last − first follower total. */
function accountTotals(rows: DailyRow[]) {
  const byConn = new Map<string, DailyRow[]>();
  for (const r of rows) byConn.set(r.connectionId, [...(byConn.get(r.connectionId) ?? []), r]);
  const followersNet = sumOrNull(
    [...byConn.values()].map((list) => {
      const gained = sumOrNull(list.map((r) => r.metrics.followers_gained));
      const lost = sumOrNull(list.map((r) => r.metrics.followers_lost));
      if (gained !== null || lost !== null) return (gained ?? 0) - (lost ?? 0);
      const totals = list.filter((r) => typeof r.metrics.followers === "number").sort((a, b) => a.date.localeCompare(b.date));
      return totals.length >= 2 ? totals.at(-1)!.metrics.followers! - totals[0]!.metrics.followers! : null;
    }),
  );
  const engagement = sumOrNull(rows.map((r) => engagementOf(r.metrics)));
  const basis = (["views", "impressions", "reach"] as const).find((k) => rows.some((r) => typeof r.metrics[k] === "number")) ?? null;
  const basisTotal = basis ? sumOrNull(rows.map((r) => r.metrics[basis])) : null;
  return {
    views: sumOrNull(rows.map((r) => r.metrics.views)),
    engagement,
    followersNet,
    rateBasis: basis,
    rate: engagement !== null && basisTotal ? (engagement / basisTotal) * 100 : null,
  };
}

/** Platform-specific tiles on a single-connection tab. */
const PLATFORM_TILES: Record<Platform, { key: MetricKey; source: "account" | "posts"; agg: "sum" | "avg" | "last" }[]> = {
  youtube: [
    { key: "watch_time_seconds", source: "account", agg: "sum" },
    { key: "avg_view_duration_seconds", source: "account", agg: "avg" },
    { key: "followers_gained", source: "account", agg: "sum" },
    { key: "followers_lost", source: "account", agg: "sum" },
  ],
  facebook: [
    { key: "reach", source: "account", agg: "sum" },
    { key: "impressions", source: "account", agg: "sum" },
    { key: "video_views", source: "account", agg: "sum" },
  ],
  threads: [
    { key: "views", source: "account", agg: "sum" },
    { key: "comments", source: "account", agg: "sum" },
    { key: "reposts", source: "account", agg: "sum" },
    { key: "quotes", source: "account", agg: "sum" },
  ],
  x: [
    { key: "impressions", source: "posts", agg: "sum" },
    { key: "bookmarks", source: "posts", agg: "sum" },
    { key: "reposts", source: "posts", agg: "sum" },
  ],
  linkedin: [],
};

function aggregate(values: (number | undefined)[], agg: "sum" | "avg" | "last") {
  const present = values.filter((v): v is number => typeof v === "number");
  if (!present.length) return null;
  if (agg === "last") return present.at(-1)!;
  const total = present.reduce((a, b) => a + b, 0);
  return agg === "avg" ? total / present.length : total;
}

/** Latest snapshot per post for posts published in [from, to] (dates in timeZone). */
async function latestPostMetrics(userId: string, connectionIds: string[], from: string, to: string, timeZone: string) {
  if (connectionIds.length === 0) return [];
  const result = await db.execute<{ post_id: string; metrics: Metrics; published_at: string }>(sql`
    select distinct on (s.post_id) s.post_id, s.metrics, p.published_at
    from ${analyticsPostSnapshots} s
    join ${posts} p on p.id = s.post_id
    where p.user_id = ${userId}
      and p.social_connection_id in ${connectionIds}
      and (p.published_at at time zone ${timeZone})::date between ${from}::date and ${to}::date
    order by s.post_id, s.captured_at desc`);
  return result.rows.map((r) => ({ postId: r.post_id, metrics: MetricsSchema.parse(r.metrics), publishedAt: r.published_at }));
}

async function publishCounts(userId: string, connectionIds: string[], from: string, to: string, timeZone: string) {
  if (connectionIds.length === 0) return { published: 0, failed: 0 };
  const result = await db.execute<{ published: string; failed: string }>(sql`
    select
      count(*) filter (where status = 'published' and (published_at at time zone ${timeZone})::date between ${from}::date and ${to}::date) as published,
      count(*) filter (where status = 'failed' and (updated_at at time zone ${timeZone})::date between ${from}::date and ${to}::date) as failed
    from ${posts}
    where user_id = ${userId} and social_connection_id in ${connectionIds}`);
  const row = result.rows[0];
  return { published: Number(row?.published ?? 0), failed: Number(row?.failed ?? 0) };
}

const successRate = (c: { published: number; failed: number }) => (c.published + c.failed > 0 ? (c.published / (c.published + c.failed)) * 100 : null);

export async function analyticsOverview(userId: string, rawInput: OverviewInput): Promise<Overview> {
  const input = OverviewInputSchema.parse(rawInput);
  const range = resolveRange(input.range, input.timeZone);
  const conns = await userConnections(userId, input.connectionId);
  const ids = conns.map((c) => c.id);
  const platformOf = new Map(conns.map((c) => [c.id, c.platform]));

  const daily: DailyRow[] = ids.length
    ? (
        await db
          .select({ connectionId: analyticsAccountDaily.socialConnectionId, date: analyticsAccountDaily.date, metrics: analyticsAccountDaily.metrics })
          .from(analyticsAccountDaily)
          .where(and(inArray(analyticsAccountDaily.socialConnectionId, ids), gte(analyticsAccountDaily.date, range.previousFrom), lte(analyticsAccountDaily.date, range.to)))
          .orderBy(asc(analyticsAccountDaily.date))
      ).map((r) => ({ ...r, metrics: MetricsSchema.parse(r.metrics) }))
    : [];
  const current = daily.filter((r) => r.date >= range.from);
  const previous = daily.filter((r) => r.date <= range.previousTo);
  const cur = accountTotals(current);
  const prev = accountTotals(previous);

  const [pubCur, pubPrev, availability, upcoming, failures, scheduledCount] = await Promise.all([
    publishCounts(userId, ids, range.from, range.to, input.timeZone),
    publishCounts(userId, ids, range.previousFrom, range.previousTo, input.timeZone),
    availabilityFor(conns),
    upcomingPosts(userId, ids),
    recentFailures(userId, ids),
    scheduledTotal(userId, ids),
  ]);

  // Series: one point per date per platform (connections of a platform are summed).
  const seriesMap = new Map<string, { date: string; platform: Platform; rows: DailyRow[] }>();
  for (const r of current) {
    const platform = platformOf.get(r.connectionId)!;
    const key = `${r.date}|${platform}`;
    const entry = seriesMap.get(key) ?? { date: r.date, platform, rows: [] };
    entry.rows.push(r);
    seriesMap.set(key, entry);
  }
  const series = [...seriesMap.values()].map(({ date, platform, rows }) => {
    const t = accountTotals(rows);
    const gained = sumOrNull(rows.map((r) => r.metrics.followers_gained));
    const lost = sumOrNull(rows.map((r) => r.metrics.followers_lost));
    return { date, platform, views: t.views, engagement: t.engagement, followersNet: gained !== null || lost !== null ? (gained ?? 0) - (lost ?? 0) : null };
  });

  const platforms = [...new Set(conns.map((c) => c.platform))];
  const byPlatform = platforms.map((platform) => {
    const t = accountTotals(current.filter((r) => platformOf.get(r.connectionId) === platform));
    return { platform, views: t.views, engagement: t.engagement };
  });

  // Platform tiles only on a single-connection tab.
  const tiles: Record<string, Kpi> = {};
  if (input.connectionId && conns[0]) {
    const spec = PLATFORM_TILES[conns[0].platform];
    const needsPosts = spec.some((s) => s.source === "posts");
    const [postsCur, postsPrev] = needsPosts
      ? await Promise.all([
          latestPostMetrics(userId, ids, range.from, range.to, input.timeZone),
          latestPostMetrics(userId, ids, range.previousFrom, range.previousTo, input.timeZone),
        ])
      : [[], []];
    for (const t of spec) {
      const pick = (rows: { metrics: Metrics }[]) => aggregate(rows.map((r) => r.metrics[t.key]), t.agg);
      tiles[t.key] = t.source === "account" ? kpi(pick(current), pick(previous)) : kpi(pick(postsCur), pick(postsPrev));
    }
  }

  return {
    range,
    kpis: {
      views: kpi(cur.views, prev.views),
      engagement: kpi(cur.engagement, prev.engagement),
      engagementRate: kpi(cur.rate, prev.rate),
      engagementRateBasis: cur.rateBasis,
      followersNet: kpi(cur.followersNet, prev.followersNet),
      postsPublished: kpi(pubCur.published, pubPrev.published),
      publishSuccessRate: kpi(successRate(pubCur), successRate(pubPrev)),
      platform: tiles,
    },
    series,
    byPlatform,
    publishStats: { published: pubCur.published, failed: pubCur.failed, scheduled: scheduledCount, successRate: successRate(pubCur) },
    upcoming,
    recentFailures: failures,
    availability: availability.map(({ state: _state, ...a }) => a),
  };
}

async function upcomingPosts(userId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ postId: posts.id, name: posts.name, provider: socialConnections.provider, scheduledAt: scheduledPosts.scheduledAt })
    .from(scheduledPosts)
    .innerJoin(posts, eq(posts.id, scheduledPosts.postId))
    .innerJoin(socialConnections, eq(socialConnections.id, posts.socialConnectionId))
    .where(
      and(
        eq(posts.userId, userId),
        inArray(posts.socialConnectionId, ids),
        inArray(scheduledPosts.status, ["scheduled", "handed_off"]),
        gte(scheduledPosts.scheduledAt, new Date()),
      ),
    )
    .orderBy(asc(scheduledPosts.scheduledAt))
    .limit(5);
  return rows.map((r) => ({ postId: r.postId, name: r.name, platform: platformForProvider(r.provider), scheduledAt: r.scheduledAt.toISOString() }));
}

async function scheduledTotal(userId: string, ids: string[]) {
  if (ids.length === 0) return 0;
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(scheduledPosts)
    .innerJoin(posts, eq(posts.id, scheduledPosts.postId))
    .where(and(eq(posts.userId, userId), inArray(posts.socialConnectionId, ids), inArray(scheduledPosts.status, ["scheduled", "handed_off"]), gte(scheduledPosts.scheduledAt, new Date())));
  return Number(row?.n ?? 0);
}

async function recentFailures(userId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ postId: posts.id, name: posts.name, provider: socialConnections.provider, errorMessage: posts.errorMessage, failedAt: posts.updatedAt })
    .from(posts)
    .innerJoin(socialConnections, eq(socialConnections.id, posts.socialConnectionId))
    .where(and(eq(posts.userId, userId), inArray(posts.socialConnectionId, ids), eq(posts.status, "failed")))
    .orderBy(desc(posts.updatedAt))
    .limit(5);
  return rows.map((r) => ({ postId: r.postId, name: r.name, platform: platformForProvider(r.provider), errorMessage: r.errorMessage, failedAt: r.failedAt.toISOString() }));
}

// ---------------------------------------------------------------------------
// Top posts (cursor-paginated, ≤ 10)
// ---------------------------------------------------------------------------

/** SQL for engagement on a metrics jsonb (mirrors engagementOf). NULL when nothing is reported. */
const engagementSql = (m: ReturnType<typeof sql>) => sql`(case
  when ${m} ?| array['likes','comments','shares','saves','reposts','quotes'] then
    coalesce((${m}->>'likes')::numeric,0) + coalesce((${m}->>'comments')::numeric,0) + coalesce((${m}->>'shares')::numeric,0)
    + coalesce((${m}->>'saves')::numeric,0) + coalesce((${m}->>'reposts')::numeric,0) + coalesce((${m}->>'quotes')::numeric,0)
  else (${m}->>'engagements')::numeric end)`;

export async function analyticsTopPosts(userId: string, rawInput: TopPostsInput) {
  const input = TopPostsInputSchema.parse(rawInput);
  const range = resolveRange(input.range, "UTC");
  const conns = await userConnections(userId, input.connectionId);
  if (conns.length === 0) return { items: [], nextCursor: null };
  const ids = conns.map((c) => c.id);
  const m = sql`l.metrics`;
  // Absent metric sorts last (−1). "views" falls back to impressions (X reports impressions only).
  const sortExpr =
    input.sortBy === "engagement"
      ? sql`coalesce(${engagementSql(m)}, -1)`
      : input.sortBy === "likes"
        ? sql`coalesce((${m}->>'likes')::numeric, -1)`
        : sql`coalesce((${m}->>'views')::numeric, (${m}->>'impressions')::numeric, -1)`;
  const after = input.cursor ? decodeKeyCursor(input.cursor) : null;

  const result = await db.execute<{
    id: string;
    connection_id: string;
    provider: string;
    name: string;
    caption: string | null;
    published_at: Date | null;
    post_url: string | null;
    metrics: Metrics;
    captured_at: Date;
    sort_value: string;
  }>(sql`
    with latest as (
      select distinct on (s.post_id) s.post_id, s.metrics, s.captured_at
      from ${analyticsPostSnapshots} s
      where s.social_connection_id in ${ids}
      order by s.post_id, s.captured_at desc
    ), ranked as (
      select p.id, p.social_connection_id as connection_id, c.provider, p.name, p.caption, p.published_at, p.post_url,
             l.metrics, l.captured_at, ${sortExpr} as sort_value
      from latest l
      join ${posts} p on p.id = l.post_id
      join ${socialConnections} c on c.id = p.social_connection_id
      where p.user_id = ${userId} and p.published_at::date between ${range.from}::date and ${range.to}::date
    )
    select * from ranked
    ${after ? sql`where (sort_value, id) < (${after.sortKey}::numeric, ${after.id}::uuid)` : sql``}
    order by sort_value desc, id desc
    limit ${input.limit + 1}`);

  const rows = result.rows;
  const thumbs = await thumbnailsFor(rows.slice(0, input.limit).map((r) => r.id));
  const page = toKeyPage(rows, input.limit, (r) => ({ sortKey: String(r.sort_value), id: r.id }));
  return {
    nextCursor: page.nextCursor,
    items: page.items.map((r) => {
      const metrics = MetricsSchema.parse(r.metrics);
      return {
        postId: r.id,
        connectionId: r.connection_id,
        platform: platformForProvider(r.provider),
        title: r.name || r.caption || "Untitled post",
        publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
        postUrl: r.post_url,
        thumbnailUrl: thumbs.get(r.id) ?? null,
        metrics,
        engagement: engagementOf(metrics),
        capturedAt: new Date(r.captured_at).toISOString(),
      };
    }),
  };
}

/** Preview image per post: the thumbnail role, else the first image. Videos without one → none. */
async function thumbnailsFor(postIds: string[]) {
  const out = new Map<string, string>();
  if (postIds.length === 0) return out;
  const rows = await db
    .select({ postId: postMedia.postId, role: postMedia.role, position: postMedia.position, media })
    .from(postMedia)
    .innerJoin(media, eq(media.id, postMedia.mediaId))
    .where(and(inArray(postMedia.postId, postIds), eq(media.type, "image")))
    .orderBy(asc(postMedia.position));
  for (const postId of postIds) {
    const mine = rows.filter((r) => r.postId === postId);
    const pick = mine.find((r) => r.role === "thumbnail") ?? mine[0];
    if (!pick) continue;
    const url = await presignedUrl(MediaRowSchema.parse(pick.media));
    if (url) out.set(postId, url);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Post detail, best times, sync status
// ---------------------------------------------------------------------------

export async function analyticsPostDetail(userId: string, postId: string) {
  const [post] = await db
    .select({ id: posts.id, provider: socialConnections.provider })
    .from(posts)
    .innerJoin(socialConnections, eq(socialConnections.id, posts.socialConnectionId))
    .where(and(eq(posts.id, postId), eq(posts.userId, userId)))
    .limit(1);
  if (!post) return errors.notFound("Post");
  const rows = await db
    .select({ capturedAt: analyticsPostSnapshots.capturedAt, metrics: analyticsPostSnapshots.metrics })
    .from(analyticsPostSnapshots)
    .where(eq(analyticsPostSnapshots.postId, post.id))
    .orderBy(desc(analyticsPostSnapshots.capturedAt))
    .limit(200);
  const snapshots = rows.reverse().map((r) => ({ capturedAt: r.capturedAt.toISOString(), metrics: MetricsSchema.parse(r.metrics) }));
  const latest = snapshots.at(-1)?.metrics ?? null;
  return { postId: post.id, platform: platformForProvider(post.provider), latest, engagement: latest ? engagementOf(latest) : null, snapshots };
}

export async function analyticsBestTimes(userId: string, rawInput: BestTimesInput) {
  const input = BestTimesInputSchema.parse(rawInput);
  const range = resolveRange(input.range, input.timeZone);
  const conns = await userConnections(userId, input.connectionId);
  const latest = await latestPostMetrics(userId, conns.map((c) => c.id), range.from, range.to, input.timeZone);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" });
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const cells = new Map<string, { weekday: number; hour: number; posts: number; total: number }>();
  for (const p of latest) {
    const engagement = engagementOf(p.metrics);
    if (engagement === null) continue;
    const parts = fmt.formatToParts(new Date(p.publishedAt));
    const weekday = WEEKDAYS.indexOf(parts.find((x) => x.type === "weekday")?.value ?? "");
    const hour = Number(parts.find((x) => x.type === "hour")?.value);
    if (weekday < 0 || !Number.isInteger(hour)) continue;
    const key = `${weekday}|${hour}`;
    const cell = cells.get(key) ?? { weekday, hour, posts: 0, total: 0 };
    cell.posts += 1;
    cell.total += engagement;
    cells.set(key, cell);
  }
  return {
    timeZone: input.timeZone,
    cells: [...cells.values()].map((c) => ({ weekday: c.weekday, hour: c.hour, posts: c.posts, avgEngagement: c.total / c.posts })),
  };
}

export async function analyticsSyncStatus(userId: string, connectionId?: string) {
  const conns = await userConnections(userId, connectionId);
  const availability = await availabilityFor(conns);
  return {
    connections: availability.map(({ state, ...a }) => {
      const refreshAt = state?.lastManualRefreshAt ? new Date(state.lastManualRefreshAt.getTime() + MANUAL_REFRESH_INTERVAL_MS) : null;
      return {
        ...a,
        lastAccountSyncAt: state?.lastAccountSyncAt?.toISOString() ?? null,
        lastPostSyncAt: state?.lastPostSyncAt?.toISOString() ?? null,
        lastError: state?.lastError ?? null,
        refreshAvailableAt: refreshAt && refreshAt.getTime() > Date.now() ? refreshAt.toISOString() : null,
      };
    }),
  };
}

export { claimManualRefresh } from "./sync";
