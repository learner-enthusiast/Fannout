import type { AnySocialProvider } from "@repo/providers";
import type { Metrics } from "../model";

export type AnalyticsContext = {
  userId: string;
  connectionId: string;
  providerAccountId: string;
  provider: AnySocialProvider;
};

/** One day of account metrics (date = YYYY-MM-DD as the platform buckets it). */
export type AccountDay = { date: string; metrics: Metrics; raw: Record<string, unknown> };

export type PostRef = {
  postId: string;
  externalPostId: string;
  publishedAt: Date;
  mediaType: string | null;
  /** Platform post type stored at publish time (Instagram: reel | image | carousel). */
  postType?: string | null;
};
export type PostMetricsResult = { postId: string; metrics: Metrics; raw: Record<string, unknown>; source: string };

/**
 * One file per platform. Called ONLY from the Inngest analytics sync.
 * Unsupported metrics are left out (absent), never set to 0.
 */
export type PlatformAnalytics = {
  /** Account metrics for each day in [from, to] (inclusive, YYYY-MM-DD). */
  accountDays(ctx: AnalyticsContext, from: string, to: string): Promise<AccountDay[]>;
  /** Current lifetime metrics for these posts (batched where the API allows). */
  posts(ctx: AnalyticsContext, refs: PostRef[]): Promise<PostMetricsResult[]>;
};

export const num = (value: unknown): number | undefined => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

export const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Inclusive list of YYYY-MM-DD dates. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
