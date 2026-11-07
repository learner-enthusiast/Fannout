import {
  generationErrorCode,
  isPermanentGenerationError,
  markGenerationFailed,
  markGenerationRunning,
  runGenerationJob,
} from "@repo/services/ai-content";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import { inngest } from "../client";
import { aiContentGenerateRequested } from "../events";

/**
 * ai/content.generate.requested → load sources (JSON first, then subtitles),
 * build the v1 prompt, generate, validate/repair, save.
 *
 * Load → prompt → generate → validate run inside ONE step on purpose: Inngest
 * persists every step's return value, and source text / generated copy must
 * not end up in run history. Only ids and counts leave the step.
 */
export const generateContent = inngest.createFunction(
  {
    id: "generate-content",
    triggers: [aiContentGenerateRequested],
    throttle: { limit: 10, period: "1m", key: "event.data.userId" },
    concurrency: { limit: 2, key: "event.data.userId" },
    retries: 2,
    onFailure: async ({ event, error, step }) => {
      const original = z.object({ generationId: z.uuid() }).safeParse(event.data.event.data);
      if (!original.success) return;
      await step.run("mark-failed", () =>
        markGenerationFailed(original.data.generationId, generationErrorCode(error.cause ?? error), error.message || "Generation failed"),
      );
    },
  },
  async ({ event, step }) => {
    const { generationId } = event.data;
    const claimed = await step.run("mark-running", () => markGenerationRunning(generationId));
    if (!claimed) return { skipped: true };

    return step.run("generate", async () => {
      try {
        return await runGenerationJob(generationId);
      } catch (error) {
        if (isPermanentGenerationError(error)) {
          await markGenerationFailed(generationId, generationErrorCode(error), (error as Error).message);
          throw new NonRetriableError((error as Error).message, { cause: error });
        }
        throw error;
      }
    });
  },
);
