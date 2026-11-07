# SDK comparison and decisions

| Provider | Official SDK evaluated | Decision | Why |
|---|---|---|---|
| LinkedIn | `linkedin-api-client` (LinkedIn, beta) | **Direct HTTP** | Unmaintained beta. It offers only generic Rest.li verbs, no typed Posts/Images/Videos APIs, and no upload helpers. |
| X | `@xdevplatform/xdk` (X, official TypeScript SDK) | **SDK** | Covers every v2 operation used here. The provider swaps in its own transport for lazy tokens, refresh, retries and injectable `fetch`. |
| YouTube | `@googleapis/youtube` (Google, official) | **SDK** | Covers the Data API v3, including Live Streaming and resumable uploads. Schemas and methods are generated from its typings. |
| YouTube Analytics | `@googleapis/youtubeanalytics` (Google, official) | **SDK** | Separate module, as requested. |
| Threads | None from Meta (only unofficial / reverse-engineered npm packages) | **Direct HTTP** | Per the rules, unofficial SDKs aren't used. |
| Facebook Pages | `facebook-nodejs-business-sdk` (Meta, official) | **Direct HTTP** | Built for the Marketing API. Auth goes through a process-wide `FacebookAdsApi.init` singleton, which is unsafe with one Page token per request. It has no TypeScript types and no Reels or chunked-upload helpers. |

## Shared infrastructure (`packages/providers/common`)

- `HttpClient`: base URLs, bearer or query-param auth, timeouts, retries with exponential backoff (idempotent methods, and 429 for all methods),
  one 401 refresh per request through `TokenManager`, rate-limit header parsing, Graph/LinkedIn error normalisation and Zod response parsing.
- `TokenManager` / `TokenProvider`: providers never read the database. The factory gives them a token source backed by the OAuth service.
- `ProviderError`: one error type with `code`, `status`, `providerCode`, `retryable` and `rateLimit`. Messages never include tokens or URLs.
- `MediaSource`: buffer, stream (with `size`) or URL. It is storage-agnostic, so a future S3 layer only needs to produce one of these.
- `meta-graph.ts`: Graph paging, error parsing, form encoding and `appsecret_proof`, shared by Threads and Facebook.
- `webhooks.ts`: Meta webhook verification and signature checks.

## Provider factory (`packages/services/provider-factory`)

`createProviderForConnection({ userId, connectionId })`:

1. Loads the connection scoped to `userId`, so another user's connection is `NOT_FOUND`.
2. Rejects inactive or token-less connections (`CONFLICT`, `reason: reconnect_required`).
3. Picks the class from `provider` and passes provider-specific identity:
   Facebook gets the Page id, the Page token and `appsecret_proof`. Threads gets the Threads user id and token.
   YouTube gets the channel id and the Google subject. X gets the user id.
4. Supplies tokens lazily through `oauthService.getValidAccessToken`, which decrypts them and refreshes or renews them near expiry.
   After a 401 it re-reads the token once and surfaces the error if the token didn't change.

No BullMQ, Redis or object storage is involved.
