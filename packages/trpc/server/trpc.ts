import { initTRPC, TRPCError } from "@trpc/server";
import { OpenApiMeta } from "trpc-to-openapi";
import { AppError, ErrorCode, toTRPCError } from "@repo/errors";
import { logger } from "@repo/logger";
import type { ApiKeyScope } from "@repo/services/api-keys/model";
import {
  consume,
  rateLimitHeaders,
  RateLimitExceededError,
  type Bucket,
  type RateLimitResult,
} from "@repo/services/rate-limit/rate-limiter";
import { ensureUser } from "@repo/services/users";
import { createContext } from "./context";

type AgentDocsMeta = {
  /** Generated-guide access metadata. Set by the procedure builders below. */
  agentDocsSessionOnly?: true;
  agentDocsScope?: ApiKeyScope;
  agentDocsRateLimit?: Bucket;
};

export const tRPCContext = initTRPC
  .meta<OpenApiMeta & AgentDocsMeta>()
  .context<typeof createContext>()
  .create({
    errorFormatter({ shape, error }) {
      const appError = error.cause instanceof AppError ? error.cause : null;

      return {
        ...shape,
        data: {
          ...shape.data,
          appCode: appError?.code,
          details: appError?.details,
        },
      };
    },
  });

const baseProcedure = tRPCContext.procedure.use(async ({ path, type, next }) => {
  try {
    return await next();
  } catch (error) {
    logger.error("tRPC procedure failed", { path, type, error });
    throw toTRPCError(error);
  }
});

export const router = tRPCContext.router;
export const publicProcedure = baseProcedure;

const unauthorized = (message = "Not authenticated") =>
  new TRPCError({ code: "UNAUTHORIZED", message, cause: new AppError({ code: ErrorCode.UNAUTHORIZED, message }) });

function tooMany(result: RateLimitResult) {
  const error = new RateLimitExceededError(result);
  return new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: error.message,
    cause: new AppError({
      code: ErrorCode.TOO_MANY_REQUESTS,
      message: error.message,
      details: { bucket: result.bucket, retryAfterSeconds: error.retryAfterSeconds },
    }),
  });
}

/**
 * Signed in with a Clerk session OR an API key. ctx.dbUserId is users.id.
 * Every API-key request consumes the "api" bucket and gets X-RateLimit-* headers.
 */
export const protectedProcedure = baseProcedure.use(async ({ ctx, next }) => {
  if (ctx.apiKey) {
    const result = await consume("api", ctx.apiKey.apiKeyId, { tier: ctx.apiKey.tier as "free" });
    ctx.res.set(rateLimitHeaders(result));
    if (!result.allowed) throw tooMany(result);
    return next({ ctx: { ...ctx, dbUserId: ctx.apiKey.userId, auth: "apiKey" as const } });
  }
  if (ctx.apiKeyError === "blocked") {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many invalid API keys from this address. Try again in 15 minutes." });
  }
  if (ctx.apiKeyError === "invalid") throw unauthorized("Invalid, revoked or expired API key");
  if (!ctx.userId) throw unauthorized();

  // ctx.userId is the Clerk id; ctx.dbUserId is users.id (uuid) for service calls.
  const dbUserId = await ensureUser(ctx.userId);
  return next({ ctx: { ...ctx, userId: ctx.userId, dbUserId, auth: "session" as const } });
});

/** Browser session only — API keys can't manage keys, connect accounts or change settings. */
type AgentDocsMiddleware = ((opts: never) => unknown) & {
  agentDocsSessionOnly?: true;
  agentDocsScope?: ApiKeyScope;
  agentDocsRateLimit?: Bucket;
};

const sessionOnly = Object.assign(tRPCContext.middleware(({ ctx, next }) => {
  if ((ctx as { auth?: string }).auth !== "session") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "API keys can't do this; sign in to Fannout instead",
      cause: new AppError({ code: ErrorCode.FORBIDDEN, message: "API keys can't do this; sign in to Fannout instead" }),
    });
  }
  return next();
}), { agentDocsSessionOnly: true as const });

export const sessionOnlyProcedure = protectedProcedure
  .use(sessionOnly)
  .meta({ agentDocsSessionOnly: true });

/** Session users have every scope; API keys need the scope. */
export const requireScope = (scope: ApiKeyScope) => {
  const middleware = tRPCContext.middleware(({ ctx, next }) => {
    const apiKey = (ctx as { apiKey?: { scopes: string[] } | null }).apiKey;
    if (apiKey && !apiKey.scopes.includes(scope)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `missing scope ${scope}`,
        cause: new AppError({ code: ErrorCode.FORBIDDEN, message: `missing scope ${scope}`, details: { scope } }),
      });
    }
    return next();
  });
  return Object.assign(middleware, { agentDocsScope: scope }) as typeof middleware & AgentDocsMiddleware;
};

/**
 * Extra bucket for expensive procedures (publish/delete/edit/ai). Keyed by
 * API key, or by user id for the browser (3× points). The limiter lives in
 * services/rate-limit/rate-limiter.ts; this is only the tRPC adapter.
 */
export const rateLimit = (bucket: Bucket) => {
  const middleware = tRPCContext.middleware(async ({ ctx, next }) => {
    const c = ctx as { apiKey?: { apiKeyId: string; tier: string } | null; dbUserId?: string; res: { set(h: Record<string, string>): void } };
    const key = c.apiKey ? `k:${c.apiKey.apiKeyId}` : c.dbUserId ? `u:${c.dbUserId}` : null;
    if (!key) return next();
    const result = await consume(bucket, key, { tier: (c.apiKey?.tier ?? "free") as "free", session: !c.apiKey });
    if (c.apiKey) c.res.set(rateLimitHeaders(result));
    if (!result.allowed) {
      if (!c.apiKey) c.res.set(rateLimitHeaders(result));
      throw tooMany(result);
    }
    return next();
  });
  return Object.assign(middleware, { agentDocsRateLimit: bucket }) as typeof middleware & AgentDocsMiddleware;
};

/** protectedProcedure + scope. */
export const scoped = (scope: ApiKeyScope) => protectedProcedure
  .use(requireScope(scope))
  .meta({ agentDocsScope: scope });

/** Adds the runtime limiter and the generated-guide metadata together. */
export const rateLimited = (procedure: ReturnType<typeof scoped>, bucket: Bucket) =>
  procedure.use(rateLimit(bucket)).meta({ agentDocsRateLimit: bucket });
