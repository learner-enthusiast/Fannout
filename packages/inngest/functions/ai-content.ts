import {
  finishGeneration,
  generationErrorCode,
  isPermanentGenerationError,
  markGenerationFailed,
  markGenerationRunning,
  prepareGenerationJob,
  writeGenerationTarget,
} from "@repo/services/ai-content";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import { inngest } from "../client";
import { aiContentGenerateRequested } from "../events";

/**
 * ai/content.generate.requested →
 *   "brief"    Stage 1: one brief per set of inputs (cached by input hash)
 *   "write-N"  Stage 2 + 3: one step per account, in parallel — platform
 *              playbook, code validation, one repair, trim
 *   "finish"   totals + notes
 *
 * Inngest persists every step's return value, and source text / generated
 * copy must not end up in run history: the brief and the copy are written to
 * ai_generations inside their step, and steps return only ids, counts and
 * limit notes.
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

    const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
      try {
        return await work();
      } catch (error) {
        if (isPermanentGenerationError(error)) {
          await markGenerationFailed(generationId, generationErrorCode(error), (error as Error).message);
          throw new NonRetriableError((error as Error).message, { cause: error });
        }
        throw error;
      }
    };

    const brief = await step.run("brief", () => guarded(() => prepareGenerationJob(generationId)));
    const writers = await Promise.all(
      Array.from({ length: brief.targets }, (_, index) =>
        step.run(`write-${index + 1}`, () => guarded(() => writeGenerationTarget(generationId, index))),
      ),
    );
    return step.run("finish", () => finishGeneration(generationId, { brief, writers }));
  },
);
