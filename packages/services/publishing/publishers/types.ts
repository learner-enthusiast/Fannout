import type { MediaRow } from "../../media/model";
import type { SocialConnectionRow } from "../../social-connections/model";
import type { ComposeMediaType } from "../model";

export type PublishContext = {
  userId: string;
  connection: SocialConnectionRow;
  /** Already validated with the platform's compose schema. */
  input: Record<string, unknown>;
  mediaType: ComposeMediaType;
  /** The video (one) or the photos in carousel order. */
  media: MediaRow[];
  thumbnail: MediaRow | null;
  /** Resume data from earlier attempts (posts.config.progress). */
  progress: Record<string, unknown>;
  /** Persist resume data + the step shown on the status page. */
  save: (patch: Record<string, unknown>, step?: string) => Promise<void>;
  /** Scheduled post: prepare runs ahead of time, finalize at scheduled_at. */
  scheduled: boolean;
};

export type PublishOutcome = { externalPostId: string; postUrl: string | null };

/**
 * Publishing in two resumable halves. prepare = slow work (uploads,
 * processing) that leaves nothing public; progress lives in ctx.progress.
 * finalize = the call that makes the post live. Platforms that can't split
 * use a no-op prepare. Instant posts run both back to back.
 */
export type Publisher<P> = {
  prepare(provider: P, ctx: PublishContext): Promise<void>;
  finalize(provider: P, ctx: PublishContext): Promise<PublishOutcome>;
};
