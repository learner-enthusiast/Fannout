import { serve } from "inngest/express";
import { inngest } from "./client";
import { functions } from "./functions";

export { inngest } from "./client";
export { functions } from "./functions";
export * from "./events";
export { eventType, NonRetriableError, RetryAfterError, cron, type InngestFunction } from "inngest";

/**
 * Express handler that registers `functions` with Inngest. Mount it at
 * /api/inngest with a JSON body parser in front of it.
 */
export const inngestHandler = serve({ client: inngest, functions });
