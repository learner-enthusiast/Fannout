import { facebookPlaybooks } from "./platforms/facebook";
import { instagramPlaybooks } from "./platforms/instagram";
import { linkedinPlaybooks } from "./platforms/linkedin";
import { threadsPlaybooks } from "./platforms/threads";
import { xPlaybooks } from "./platforms/x";
import { youtubePlaybooks } from "./platforms/youtube";
import { postTypeFor, type AiPlatform, type PostType } from "./length-targets";
import type { Playbook } from "./types";

export * from "./brief";
export * from "./hook";
export * from "./length-targets";
export * from "./shared-rules";
export type { Playbook } from "./types";
export { FacebookOutputSchema } from "./platforms/facebook";
export { InstagramOutputSchema } from "./platforms/instagram";
export { LinkedInOutputSchema } from "./platforms/linkedin";
export { ThreadsOutputSchema } from "./platforms/threads";
export { XOutputSchema } from "./platforms/x";
export { YouTubeCarouselOutputSchema, YouTubeOutputSchema } from "./platforms/youtube";

/** Every playbook (platform × post type). A new platform or post type adds a file/entry here. */
export const PLAYBOOKS: Playbook[] = [
  ...youtubePlaybooks,
  ...linkedinPlaybooks,
  ...instagramPlaybooks,
  ...facebookPlaybooks,
  ...xPlaybooks,
  ...threadsPlaybooks,
];

export function getPlaybook(platform: AiPlatform, wanted: PostType): Playbook {
  const postType = postTypeFor(platform, wanted);
  const playbook = PLAYBOOKS.find((p) => p.platform === platform && p.postType === postType);
  if (!playbook) throw new Error(`No AI playbook for ${platform}/${postType}`);
  return playbook;
}
