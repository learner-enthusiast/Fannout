import { getAuth } from "@clerk/express";
import { AppError } from "@repo/errors";
import {
  handleOAuthCallback,
  OAUTH_TRANSACTION_TTL_MS,
  startOAuthConnection,
  type HandleCallbackInput,
} from "@repo/services/oauth";
import {
  DEFAULT_RETURN_TO,
  OAuthProviderSlugSchema,
  PROVIDER_BY_SLUG,
  ReturnToSchema,
  type OAuthCallbackResult,
  type OAuthProviderSlug,
  type StartConnectionInput,
  type StartConnectionResult,
} from "@repo/services/oauth/model";
import { ensureUser } from "@repo/services/users";
import { Router, type Request, type Response } from "express";

export type OAuthRouterDependencies = {
  startConnection: (input: StartConnectionInput) => Promise<StartConnectionResult>;
  handleCallback: (input: HandleCallbackInput) => Promise<OAuthCallbackResult>;
  /** Internal user id (uuid) of the signed-in Clerk user, or null. */
  resolveUserId: (req: Request) => Promise<string | null>;
  webUrl: string;
  secureCookies: boolean;
};

const bindingCookieName = (slug: OAuthProviderSlug) => `fannout_oauth_${slug}`;
const bindingCookiePath = (slug: OAuthProviderSlug) => `/api/oauth/${slug}`;

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Builds the post-callback redirect. Destination is always on WEB_URL; the
 * path comes from a returnTo validated when the flow started.
 */
export function buildWebRedirect(
  webUrl: string,
  slug: OAuthProviderSlug | null,
  result: Pick<OAuthCallbackResult, "status" | "returnTo"> & {
    reason?: string;
    selectionId?: string;
  },
): string {
  const origin = new URL(webUrl).origin;
  const safePath = ReturnToSchema.safeParse(result.returnTo).success
    ? result.returnTo
    : DEFAULT_RETURN_TO;
  const target = new URL(safePath, origin);
  if (target.origin !== origin) return new URL(DEFAULT_RETURN_TO, origin).href;

  target.searchParams.set("oauth", result.status === "failed" ? "error" : result.status);
  if (slug) target.searchParams.set("provider", slug);
  if (result.reason) target.searchParams.set("reason", result.reason);
  if (result.selectionId) target.searchParams.set("selection", result.selectionId);
  return target.href;
}

function wantsJson(req: Request) {
  return req.query.mode === "json" || (req.get("accept") ?? "").includes("application/json");
}

export function createOAuthRouter(deps: OAuthRouterDependencies) {
  const router = Router();

  /**
   * GET /api/oauth/:provider/connect[?returnTo=/path][&mode=json]
   * Requires a Clerk session (Bearer token or cookie). Browsers navigating
   * here get a 302; fetch() callers (Accept: application/json) get the URL.
   */
  router.get("/:provider/connect", async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    const slug = OAuthProviderSlugSchema.safeParse(req.params.provider);
    if (!slug.success) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown provider" } });
    }

    const userId = await deps.resolveUserId(req);
    if (!userId) {
      return res
        .status(401)
        .json({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    }

    const rawReturnTo =
      typeof req.query.returnTo === "string" ? req.query.returnTo : DEFAULT_RETURN_TO;
    const returnTo = ReturnToSchema.safeParse(rawReturnTo);
    if (!returnTo.success) {
      return res
        .status(400)
        .json({ error: { code: "BAD_REQUEST", message: "returnTo must be a relative path" } });
    }

    let result: StartConnectionResult;
    try {
      result = await deps.startConnection({ userId, provider: slug.data, returnTo: returnTo.data });
    } catch (error) {
      if (error instanceof AppError) {
        return res
          .status(error.status)
          .json({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }

    res.cookie(bindingCookieName(slug.data), result.bindingToken, {
      httpOnly: true,
      secure: deps.secureCookies,
      sameSite: "lax",
      path: bindingCookiePath(slug.data),
      maxAge: OAUTH_TRANSACTION_TTL_MS,
    });

    if (wantsJson(req)) return res.json({ authorizationUrl: result.authorizationUrl });
    return res.redirect(302, result.authorizationUrl);
  });

  /** GET /api/oauth/:provider/callback — always ends in a redirect to the web app. */
  router.get("/:provider/callback", async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    const slug = OAuthProviderSlugSchema.safeParse(req.params.provider);
    if (!slug.success) {
      return res.redirect(
        302,
        buildWebRedirect(deps.webUrl, null, {
          status: "failed",
          returnTo: DEFAULT_RETURN_TO,
          reason: "invalid_request",
        }),
      );
    }

    const cookieName = bindingCookieName(slug.data);
    const bindingToken = readCookie(req, cookieName);
    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: deps.secureCookies,
      sameSite: "lax",
      path: bindingCookiePath(slug.data),
    });

    let result: OAuthCallbackResult;
    try {
      const sessionUserId = await deps.resolveUserId(req).catch(() => null);
      result = await deps.handleCallback({
        provider: slug.data,
        // Only the query string is read; the base is irrelevant.
        callbackUrl: new URL(req.originalUrl, "http://callback.invalid"),
        bindingToken,
        sessionUserId,
      });
    } catch {
      result = {
        status: "failed",
        provider: PROVIDER_BY_SLUG[slug.data],
        returnTo: DEFAULT_RETURN_TO,
        reason: "server_error",
      };
    }

    return res.redirect(
      302,
      buildWebRedirect(deps.webUrl, slug.data, {
        status: result.status,
        returnTo: result.returnTo,
        reason: result.status === "failed" ? result.reason : undefined,
        selectionId: result.status === "select_channel" ? result.selectionId : undefined,
      }),
    );
  });

  return router;
}

export async function resolveClerkUserId(req: Request): Promise<string | null> {
  const { userId } = getAuth(req);
  return userId ? ensureUser(userId) : null;
}

export function createDefaultOAuthRouter(options: { webUrl: string; secureCookies: boolean }) {
  return createOAuthRouter({
    startConnection: startOAuthConnection,
    handleCallback: handleOAuthCallback,
    resolveUserId: resolveClerkUserId,
    ...options,
  });
}
