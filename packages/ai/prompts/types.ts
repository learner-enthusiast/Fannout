import type { z } from "zod";
import type { AiPlatform, PostType } from "./length-targets";
import type { PlaybookTargets } from "./shared-rules";

/** One platform × post type: system prompt + output schema + version. */
export type Playbook = {
  platform: AiPlatform;
  postType: PostType;
  /** Saved in ai_generations with every generation. */
  version: string;
  schema: z.ZodType;
  schemaName: string;
  /** Length numbers come in resolved from length-targets.ts; never hardcode them here. */
  system: (targets: PlaybookTargets) => string;
};
