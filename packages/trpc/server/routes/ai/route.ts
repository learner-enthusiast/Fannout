import { aiContentGenerateRequested, inngest } from "@repo/inngest";
import { createGeneration, getGeneration } from "@repo/services/ai-content";
import { GenerateInputBaseSchema, GenerationViewSchema } from "@repo/services/ai-content/model";
import { z } from "zod";
import { rateLimited, router, scoped } from "../../trpc";

/** The browser only talks to these; the OpenAI key and calls stay on the server. */
export const aiRouter = router({
  /** Queue a generation for the given cards/fields from the selected JSON and/or subtitles. */
  generate: rateLimited(scoped("ai:generate"), "ai")
    .meta({ openapi: { method: "POST", path: "/ai/generations", summary: "Queue AI-written compose fields from a social JSON or subtitles", protect: true } })
    .input(GenerateInputBaseSchema)
    .output(z.object({ generationId: z.uuid().describe("Poll GET /ai/generations/{generationId} for the result.") }))
    .mutation(async ({ ctx, input }) => {
      const { generationId } = await createGeneration(ctx.dbUserId, input);
      await inngest.send(aiContentGenerateRequested.create({ generationId, userId: ctx.dbUserId }, { id: `ai-generation:${generationId}` }));
      return { generationId };
    }),

  getGeneration: scoped("ai:generate")
    .meta({ openapi: { method: "GET", path: "/ai/generations/{generationId}", summary: "Get an AI generation's status and output", protect: true } })
    .input(z.object({ generationId: z.uuid().describe("Generation ID from POST /ai/generations.") }))
    .output(GenerationViewSchema)
    .query(({ ctx, input }) => getGeneration(ctx.dbUserId, input.generationId)),
});
