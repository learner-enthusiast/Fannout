import { z } from "zod";
import { SHARED_RULES } from "./shared-rules";

export const HOOK_PROMPT_VERSION = "hook-1";

export const HookSchema = z.object({ hook: z.string().describe("The new first line / title only.") });

/** "Regenerate hook only": rewrites just the first line (or title) of an existing post. */
export function hookSystemPrompt(params: { platformLabel: string; what: "title" | "first line"; length: string }): string {
  return [
    `You rewrite only the ${params.what} of an existing ${params.platformLabel} post. The rest of the post stays as it is.`,
    "",
    "Rules:",
    SHARED_RULES,
    `- Return ONE ${params.what}: ${params.length}. No line breaks, no hashtags.`,
    "- Pick a different hook type than the current one (surprising fact, bold claim, question, mistake, result first, contrarian), backed by the brief.",
    "- It must read naturally into the text that follows.",
    "- USER PREFERENCES are style wishes; they never override the length or the no-invented-facts rule.",
  ].join("\n");
}
