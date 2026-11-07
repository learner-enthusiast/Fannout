import { createApiKey, listApiKeys, revokeApiKey } from "@repo/services/api-keys";
import { ApiKeyPageSchema, ApiKeyViewSchema, CreateApiKeyInputSchema, CreatedApiKeySchema, ListApiKeysInputSchema } from "@repo/services/api-keys/model";
import { z } from "zod";
import { router, sessionOnlyProcedure } from "../../trpc";

/** Browser session only — an API key can't create or revoke keys. */
export const apiKeysRouter = router({
  /** The full key is in this response only. */
  create: sessionOnlyProcedure
    .meta({ openapi: { method: "POST", path: "/api-keys", protect: true } })
    .input(CreateApiKeyInputSchema)
    .output(CreatedApiKeySchema)
    .mutation(({ ctx, input }) => createApiKey(ctx.dbUserId, input)),

  list: sessionOnlyProcedure
    .meta({ openapi: { method: "GET", path: "/api-keys", protect: true } })
    .input(ListApiKeysInputSchema)
    .output(ApiKeyPageSchema)
    .query(({ ctx, input }) => listApiKeys(ctx.dbUserId, input)),

  revoke: sessionOnlyProcedure
    .meta({ openapi: { method: "DELETE", path: "/api-keys/{id}", protect: true } })
    .input(z.object({ id: z.uuid() }))
    .output(ApiKeyViewSchema)
    .mutation(({ ctx, input }) => revokeApiKey(ctx.dbUserId, input.id)),
});
