import express, { Router, type Request, type Response } from "express";
import { inngest, metaDataDeletionRequested, metaEffects } from "@repo/inngest";
import { logger } from "@repo/logger";
import {
  deletionStatusByCode,
  findMetaConnections,
  handleDeauthorize,
  metaAppSecret,
  recentDeletionRequest,
  recordDeletionRequest,
  verifySignedRequest,
  type MetaProvider,
} from "@repo/services/meta";
import { expressRateLimit } from "@repo/services/rate-limit/rate-limiter";

/**
 * Public Meta callbacks (no auth; the signed_request is the proof).
 *   POST /webhooks/meta/facebook/deauthorize   POST /webhooks/meta/threads/uninstall
 *   POST /webhooks/meta/facebook/data-deletion POST /webhooks/meta/threads/delete
 *   GET  /webhooks/meta/data-deletion/status?code=…  (JSON for the web status page)
 * Facebook: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 * The raw signed_request is never logged.
 */
export function createMetaWebhookRouter(deps: { webUrl: string }) {
  const router = Router();
  // urlencoded only on these routes (Meta posts application/x-www-form-urlencoded).
  const form = express.urlencoded({ extended: false, limit: "16kb" });
  const limit = expressRateLimit("webhook", (req) => req.ip ?? null);

  const verified = (provider: MetaProvider, req: Request) =>
    verifySignedRequest((req.body as Record<string, unknown> | undefined)?.signed_request, metaAppSecret(provider));

  const deauthorize = (provider: MetaProvider) => async (req: Request, res: Response) => {
    const payload = verified(provider, req);
    if (!payload) return res.status(400).json({});
    try {
      await handleDeauthorize(provider, payload.user_id, metaEffects);
    } catch (error) {
      // Answer 200 anyway: Meta doesn't retry deauthorize pings usefully; the failure is logged.
      logger.error("meta.deauthorize_failed", { provider, message: (error as Error).message });
    }
    return res.status(200).json({});
  };

  const deletion = (provider: MetaProvider) => async (req: Request, res: Response) => {
    const payload = verified(provider, req);
    if (!payload) return res.status(400).json({});
    // Idempotent: a retry within 24 h gets the same confirmation code.
    let request = await recentDeletionRequest(provider, payload.user_id);
    if (!request) {
      const matches = await findMetaConnections(provider, payload.user_id);
      request = await recordDeletionRequest({ provider, platformUserId: payload.user_id, kind: "deletion", matchedConnectionIds: matches.map((m) => m.id) });
    }
    // Sent on first receipt and again while still "received" (a lost send can't strand the job; the id dedupes).
    if (request.status === "received") {
      await inngest.send(metaDataDeletionRequested.create({ requestId: request.id }, { id: `meta-data-deletion:${request.id}` }));
    }
    const url = new URL("/data-deletion/status", deps.webUrl);
    url.searchParams.set("code", request.confirmationCode);
    return res.status(200).type("application/json").json({ url: url.toString(), confirmation_code: request.confirmationCode });
  };

  router.post("/facebook/deauthorize", limit, form, deauthorize("facebook"));
  router.post("/threads/uninstall", limit, form, deauthorize("threads"));
  router.post("/facebook/data-deletion", limit, form, deletion("facebook"));
  router.post("/threads/delete", limit, form, deletion("threads"));

  router.get("/data-deletion/status", limit, async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const status = await deletionStatusByCode(code);
    res.set("Cache-Control", "no-store");
    if (!status) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Request not found" } });
    return res.json(status);
  });

  return router;
}
