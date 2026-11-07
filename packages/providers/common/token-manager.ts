/**
 * Supplies access tokens to providers. Provider classes never read the
 * database: the factory passes a TokenProvider that can refresh via the OAuth
 * service, or tests pass a plain string.
 */
export interface TokenProvider {
  getAccessToken(): Promise<string>;
  /** Called once after a 401; return a fresh token or null if impossible. */
  refreshAccessToken?(): Promise<string | null>;
}

export type TokenSource = string | TokenProvider;

export class TokenManager {
  private readonly provider: TokenProvider;
  private inflightRefresh: Promise<string | null> | null = null;
  /** Token obtained by the last successful refresh; used until the next one. */
  private refreshed: string | null = null;

  constructor(source: TokenSource) {
    this.provider =
      typeof source === "string"
        ? { getAccessToken: async () => source }
        : source;
  }

  get canRefresh(): boolean {
    return typeof this.provider.refreshAccessToken === "function";
  }

  getAccessToken(): Promise<string> {
    return this.refreshed !== null ? Promise.resolve(this.refreshed) : this.provider.getAccessToken();
  }

  /** Coalesces concurrent refreshes into one call. */
  refresh(): Promise<string | null> {
    if (!this.provider.refreshAccessToken) return Promise.resolve(null);
    this.inflightRefresh ??= this.provider
      .refreshAccessToken()
      .then((token) => {
        if (token) this.refreshed = token;
        return token;
      })
      .finally(() => (this.inflightRefresh = null));
    return this.inflightRefresh;
  }
}
