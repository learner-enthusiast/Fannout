/**
 * @repo/providers — direct integrations with LinkedIn, X, YouTube, Threads,
 * Facebook Pages and Instagram. Provider classes never touch the database: build them with
 * the factory in @repo/services (createProviderForConnection) or pass tokens directly.
 *
 * Each provider's schemas/types are exported as a namespace (several providers
 * define e.g. `CreatePostInputSchema`); import a provider folder directly
 * (`@repo/providers/threads`) to get its names unprefixed.
 */
export * from "./common";

export { LinkedInProvider, type LinkedInProviderConfig } from "./linkedin";
export { XProvider, type XProviderConfig } from "./x";
export { YouTubeProvider, type YouTubeProviderConfig } from "./youtube";
export { YouTubeAnalyticsProvider, type YouTubeAnalyticsProviderConfig } from "./youtube-analytics";
export { ThreadsProvider, type ThreadsProviderConfig, type ThreadsPublishResult } from "./threads";
export { FacebookProvider, type FacebookProviderConfig } from "./facebook";
export { InstagramProvider, type InstagramProviderConfig } from "./instagram";

export * as linkedin from "./linkedin";
export * as x from "./x";
export * as youtube from "./youtube";
export * as youtubeAnalytics from "./youtube-analytics";
export * as threads from "./threads";
export * as facebook from "./facebook";
export * as instagram from "./instagram";

import type { FacebookProvider } from "./facebook";
import type { InstagramProvider } from "./instagram";
import type { LinkedInProvider } from "./linkedin";
import type { ThreadsProvider } from "./threads";
import type { XProvider } from "./x";
import type { YouTubeProvider } from "./youtube";

/** Any initialised provider, discriminated by `name`. */
export type AnySocialProvider = LinkedInProvider | XProvider | YouTubeProvider | ThreadsProvider | FacebookProvider | InstagramProvider;
