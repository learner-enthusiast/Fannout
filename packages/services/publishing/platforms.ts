import { FACEBOOK_COMPOSE, FacebookComposeInputSchema } from "@repo/providers/facebook";
import { LINKEDIN_COMMUNITY_COMPOSE, LINKEDIN_COMPOSE, LinkedInComposeInputSchema } from "@repo/providers/linkedin";
import { THREADS_COMPOSE, ThreadsComposeInputSchema } from "@repo/providers/threads";
import { X_COMPOSE, XComposeInputSchema } from "@repo/providers/x";
import { YOUTUBE_COMPOSE, YouTubeComposeInputSchema } from "@repo/providers/youtube";
import type { ComposeCapabilities } from "@repo/providers";
import { z } from "zod";
import { env } from "../env";

/**
 * Composer platforms. Schemas and capabilities live in each provider's
 * model.ts (single source of truth); this only maps connection providers
 * to them. Instagram has no provider yet, so it isn't listed.
 */
export const PlatformSchema = z.enum(["youtube", "x", "linkedin", "threads", "facebook"]);
export type Platform = z.infer<typeof PlatformSchema>;

export type PlatformDefinition = {
  platform: Platform;
  label: string;
  schema: z.ZodObject;
  capabilities: ComposeCapabilities;
  /** Field holding the post's main text (stored as posts.caption). */
  captionField: string;
};

export const PLATFORMS: Record<Platform, PlatformDefinition> = {
  youtube: { platform: "youtube", label: "YouTube", schema: YouTubeComposeInputSchema, capabilities: YOUTUBE_COMPOSE, captionField: "title" },
  x: { platform: "x", label: "X", schema: XComposeInputSchema, capabilities: X_COMPOSE, captionField: "text" },
  linkedin: {
    platform: "linkedin",
    label: "LinkedIn",
    schema: LinkedInComposeInputSchema,
    // Share on LinkedIn (UGC) has no custom thumbnail and fewer images than the Community API.
    capabilities: env.LINKEDIN_USE_COMMUNITY_API ? LINKEDIN_COMMUNITY_COMPOSE : LINKEDIN_COMPOSE,
    captionField: "commentary",
  },
  threads: { platform: "threads", label: "Threads", schema: ThreadsComposeInputSchema, capabilities: THREADS_COMPOSE, captionField: "text" },
  facebook: { platform: "facebook", label: "Facebook", schema: FacebookComposeInputSchema, capabilities: FACEBOOK_COMPOSE, captionField: "message" },
};

/** social_connections.provider (YOUTUBE, X, …) → composer platform. */
export function platformForProvider(provider: string): Platform | null {
  const parsed = PlatformSchema.safeParse(provider.toLowerCase());
  return parsed.success ? parsed.data : null;
}
