import { getAuth } from "@clerk/express";
import type { ApiKeyPrincipal } from "@repo/services/api-keys/model";
import { verifyApiKey } from "@repo/services/api-keys";
import { isAuthBlocked, penalizeAuthFail } from "@repo/services/rate-limit/rate-limiter";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

const API_KEY_BEARER = /^Bearer\s+(fn_live_\S+)$/i;

/**
 * Two ways in: `Authorization: Bearer fn_live_…` (API key) or the Clerk
 * session (browser). Invalid keys count against the caller's IP.
 */
export async function createContext({ req, res }: CreateExpressContextOptions) {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const match = API_KEY_BEARER.exec(req.headers.authorization ?? "");
  if (match) {
    if (await isAuthBlocked(ip)) {
      return { userId: null, apiKey: null, apiKeyError: "blocked" as const, ip, res };
    }
    // Writes check the key in Postgres directly; only reads may use the 5-minute cached lookup.
    const principal = await verifyApiKey(match[1]!, ip, new Date(), { fresh: req.method !== "GET" && req.method !== "HEAD" });
    if (!principal) {
      await penalizeAuthFail(ip);
      return { userId: null, apiKey: null, apiKeyError: "invalid" as const, ip, res };
    }
    return { userId: null, apiKey: principal as ApiKeyPrincipal, apiKeyError: null, ip, res };
  }
  const { userId } = getAuth(req);
  return { userId, apiKey: null, apiKeyError: null, ip, res };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
