import type { ProviderAccount, ProviderName } from "./provider.types";

/** The contract shared by all provider classes. */
export interface SocialProviderClient {
  readonly name: ProviderName;
  /** The account the access token belongs to (Page / channel / profile). */
  getAuthenticatedAccount(): Promise<ProviderAccount>;
}
