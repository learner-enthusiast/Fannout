import type { OAuthProviderSlug } from "../model";
import { createFacebookProvider } from "./facebook";
import { createLinkedInProvider } from "./linkedin";
import { createThreadsProvider } from "./threads";
import type { OAuthProviderAdapter, ProviderCredentials } from "./types";
import { createXProvider } from "./x";
import { createYouTubeProvider } from "./youtube";

export type ProvidersConfig = Record<OAuthProviderSlug, ProviderCredentials>;
export type ProviderRegistry = Record<OAuthProviderSlug, OAuthProviderAdapter>;

export function createProviderRegistry(config: ProvidersConfig): ProviderRegistry {
  return {
    linkedin: createLinkedInProvider(config.linkedin),
    x: createXProvider(config.x),
    youtube: createYouTubeProvider(config.youtube),
    facebook: createFacebookProvider(config.facebook),
    threads: createThreadsProvider(config.threads),
  };
}

export type { OAuthProviderAdapter, ProviderCredentials, HttpOptions } from "./types";
export { ProviderIdentityError } from "./types";
