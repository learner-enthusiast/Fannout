import * as oauth from "oauth4webapi";
import type { z } from "zod";
import { ProviderIdentityError, type HttpOptions, type ProviderCredentials } from "./types";

const DISCOVERY_TTL_MS = 60 * 60 * 1000;

/** OIDC discovery via oauth4webapi, cached in memory for an hour. */
export function cachedDiscovery(issuer: URL) {
  let cached: { as: oauth.AuthorizationServer; expiresAt: number } | undefined;
  return async (http: HttpOptions): Promise<oauth.AuthorizationServer> => {
    if (cached && cached.expiresAt > Date.now()) return cached.as;
    const response = await oauth.discoveryRequest(issuer, { ...http, algorithm: "oidc" });
    const as = await oauth.processDiscoveryResponse(issuer, response);
    cached = { as, expiresAt: Date.now() + DISCOVERY_TTL_MS };
    return as;
  };
}

export function splitScopes(value: string | undefined): string[] {
  return value ? value.split(/[\s,]+/).filter(Boolean) : [];
}

export function requireCredentials(credentials: ProviderCredentials, name: string) {
  if (!credentials.clientId) throw new Error(`${name} client id is not configured`);
  return credentials.clientId;
}

export function stringClaim(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * GET a provider JSON API through the same fetch/timeout options as
 * oauth4webapi (so tests can mock it). Errors never include the URL query,
 * which may carry tokens or the client secret.
 */
export async function providerGetJson<T>(
  url: URL,
  http: HttpOptions,
  schema: z.ZodType<T>,
  headers: Record<string, string> = {},
): Promise<T> {
  const doFetch = http[oauth.customFetch] ?? ((input, init) => fetch(input, init as RequestInit));
  const response = await doFetch(url.href, {
    method: "GET",
    headers: { accept: "application/json", ...headers },
    redirect: "manual",
    body: undefined,
    signal: http.signal?.(url.href),
  });
  const where = `${url.host}${url.pathname}`;
  if (!response.ok) throw new ProviderIdentityError(`${where} failed`, response.status);
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new ProviderIdentityError(`Unexpected response from ${where}`);
  return parsed.data;
}

/** Long-lived token response shared by Meta APIs. */
export function expiryFrom(expiresIn: number | undefined, now: Date): Date | null {
  return typeof expiresIn === "number" ? new Date(now.getTime() + expiresIn * 1000) : null;
}
