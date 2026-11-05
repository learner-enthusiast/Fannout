/**
 * Typed event definitions (inngest v4 `eventType`). Zod schemas are used for
 * runtime validation; they must not use transforms.
 *
 * @example
 * export const socialConnectionConnected = eventType("social-connection/connected", {
 *   schema: z.object({ connectionId: z.uuid(), userId: z.uuid() }),
 * });
 *
 * // send:  await inngest.send(socialConnectionConnected.create({ connectionId, userId }));
 */
export {};
