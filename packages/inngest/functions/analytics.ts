import { ACCOUNT_SYNC_DAYS, BACKFILL_DAYS, analyticsConnections, syncAccountMetrics, syncPostMetrics } from "@repo/services/analytics/sync";
import { inngest } from "../client";
import { analyticsAccountSyncRequested, analyticsPostSyncRequested } from "../events";

/**
 * Analytics sync — the ONLY place platform analytics APIs are called.
 * Dashboards read analytics_* tables (services/analytics/index.ts).
 */

const today = () => new Date().toISOString().slice(0, 10);
const hourKey = () => new Date().toISOString().slice(0, 13);

/** Daily 02:30 Asia/Kolkata: last 3 days of account metrics per connection (late data re-upserted). */
export const analyticsAccountCron = inngest.createFunction(
  { id: "analytics-account-cron", triggers: [{ cron: "TZ=Asia/Kolkata 30 2 * * *" }], retries: 2 },
  async ({ step }) => {
    const connections = await step.run("list-connections", () => analyticsConnections());
    if (connections.length === 0) return { sent: 0 };
    await step.sendEvent(
      "fan-out",
      connections.map((c) =>
        analyticsAccountSyncRequested.create(
          { connectionId: c.connectionId, platform: c.platform, days: c.needsBackfill ? BACKFILL_DAYS : ACCOUNT_SYNC_DAYS },
          { id: `analytics-account:${c.connectionId}:${today()}` },
        ),
      ),
    );
    return { sent: connections.length };
  },
);

/**
 * Hourly: post snapshots for every connection (each run only reads posts that are due by
 * age), and a 28-day account backfill for connections that have never been synced.
 */
export const analyticsPostCron = inngest.createFunction(
  { id: "analytics-post-cron", triggers: [{ cron: "0 * * * *" }], retries: 2 },
  async ({ step }) => {
    const connections = await step.run("list-connections", () => analyticsConnections());
    if (connections.length === 0) return { sent: 0 };
    const backfill = connections.filter((c) => c.needsBackfill);
    await step.sendEvent("fan-out", [
      ...connections.map((c) =>
        analyticsPostSyncRequested.create({ connectionId: c.connectionId, platform: c.platform }, { id: `analytics-posts:${c.connectionId}:${hourKey()}` }),
      ),
      ...backfill.map((c) =>
        analyticsAccountSyncRequested.create(
          { connectionId: c.connectionId, platform: c.platform, days: BACKFILL_DAYS },
          { id: `analytics-backfill:${c.connectionId}:${today()}` },
        ),
      ),
    ]);
    return { posts: connections.length, backfills: backfill.length };
  },
);

/** One connection's account metrics. 3 at a time overall; per-platform throttle protects quotas. */
export const analyticsAccountSync = inngest.createFunction(
  {
    id: "analytics-account-sync",
    triggers: [analyticsAccountSyncRequested],
    concurrency: [{ limit: 3 }, { limit: 1, key: "event.data.connectionId" }],
    throttle: { limit: 20, period: "1m", key: "event.data.platform" },
    retries: 4,
  },
  async ({ event, step }) => step.run("sync", () => syncAccountMetrics(event.data.connectionId, event.data.days)),
);

/** One connection's due post snapshots. */
export const analyticsPostSync = inngest.createFunction(
  {
    id: "analytics-post-sync",
    triggers: [analyticsPostSyncRequested],
    concurrency: [{ limit: 3 }, { limit: 1, key: "event.data.connectionId" }],
    throttle: { limit: 20, period: "1m", key: "event.data.platform" },
    retries: 4,
  },
  async ({ event, step }) => step.run("sync", () => syncPostMetrics(event.data.connectionId)),
);
