import type { TokenSource } from "./token-manager";

export type ProviderName = "LINKEDIN" | "X" | "YOUTUBE" | "THREADS" | "FACEBOOK";

/** Minimal fetch signature; injectable for tests. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface RetryOptions {
  /** Extra attempts after the first (0 disables retries). */
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryOptions = { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 30_000 };
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Options every provider constructor accepts. No network calls happen at construction. */
export interface BaseProviderConfig {
  /** A token string, or a TokenProvider that can fetch/refresh one lazily. */
  accessToken: TokenSource;
  /** Override fetch (tests, proxies). Defaults to global fetch. */
  fetch?: FetchLike;
  timeoutMs?: number;
  retry?: Partial<RetryOptions>;
  /** Injected sleep (tests make retries instant). */
  sleep?: (ms: number) => Promise<void>;
}

/** Normalised identity of the connected account. */
export interface ProviderAccount {
  provider: ProviderName;
  id: string;
  username: string | null;
  displayName: string | null;
  profilePictureUrl: string | null;
}
