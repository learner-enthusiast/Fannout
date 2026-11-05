import type { InngestFunction } from "inngest";

/**
 * Every Inngest function served by the API. Define a function with
 * `inngest.createFunction({ id, triggers: [someEvent] }, async ({ event, step }) => …)`
 * in its own file and add it here to register it.
 */
export const functions: InngestFunction.Any[] = [];
