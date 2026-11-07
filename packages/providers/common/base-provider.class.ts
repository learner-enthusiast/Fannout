import type { z } from "zod";
import { ProviderError } from "./provider-error";
import type { SocialProviderClient } from "./provider.interface";
import type { BaseProviderConfig, ProviderAccount, ProviderName } from "./provider.types";
import { TokenManager } from "./token-manager";

/**
 * Base for all provider classes: holds the token manager and validates every
 * input with Zod before a request is made.
 */
export abstract class BaseProvider<C extends BaseProviderConfig = BaseProviderConfig>
  implements SocialProviderClient
{
  abstract readonly name: ProviderName;
  protected readonly tokens: TokenManager;

  protected constructor(protected readonly config: C) {
    this.tokens = new TokenManager(config.accessToken);
  }

  /** Parse input; throws ProviderError(VALIDATION) listing the failing paths. */
  protected validate<S extends z.ZodType>(schema: S, input: unknown, operation: string): z.output<S> {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new ProviderError({
        provider: this.name,
        code: "VALIDATION",
        message: `Invalid input for ${operation}: ${result.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
          .join("; ")}`,
        details: result.error.issues,
      });
    }
    return result.data;
  }

  /** Validate an SDK response that bypasses the shared HttpClient. */
  protected parseResponse<S extends z.ZodType>(schema: S, data: unknown, operation: string): z.output<S> {
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new ProviderError({
        provider: this.name,
        code: "INVALID_RESPONSE",
        message: `Unexpected ${this.name} response for ${operation}`,
        details: result.error.issues,
      });
    }
    return result.data;
  }

  abstract getAuthenticatedAccount(): Promise<ProviderAccount>;
}
