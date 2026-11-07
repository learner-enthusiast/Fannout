import { logger } from "@repo/logger";
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { aiEnv } from "./env";
import { AiError } from "./errors";

export type AiUsage = { inputTokens: number; outputTokens: number; totalTokens: number };

export type GenerateStructuredInput<T extends z.ZodType> = {
  system: string;
  user: string;
  /** Structure the model must return (strict JSON schema). Keep hard limits out; validate after. */
  schema: T;
  schemaName: string;
  model?: string;
};

export type GenerateStructuredResult<T> = { data: T; usage: AiUsage; model: string };

/** The small surface the rest of the app depends on (another provider can implement it later). */
export interface AiClient {
  generateStructured<T extends z.ZodType>(input: GenerateStructuredInput<T>): Promise<GenerateStructuredResult<z.infer<T>>>;
}

function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof APIConnectionTimeoutError) return new AiError("timeout", "The AI request timed out", { cause: error });
  if (error instanceof APIConnectionError) return new AiError("unavailable", "Couldn't reach the AI service", { cause: error });
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new AiError("auth", "The AI service rejected our API key", { status: error.status, cause: error });
  }
  if (error instanceof RateLimitError) return new AiError("rate_limit", "The AI service is busy, try again shortly", { status: 429, cause: error });
  if (error instanceof BadRequestError || error instanceof UnprocessableEntityError) {
    return new AiError("invalid_request", `The AI request was rejected: ${error.message}`, { status: error.status, cause: error });
  }
  if (error instanceof APIError) {
    return new AiError((error.status ?? 500) >= 500 ? "unavailable" : "invalid_request", "The AI service failed", {
      status: error.status ?? null,
      cause: error,
    });
  }
  // zod/parse failures from the structured-output helper.
  if (error instanceof Error && /parse|schema|json/i.test(error.message)) {
    return new AiError("schema_mismatch", "The AI returned an unexpected shape", { cause: error });
  }
  return new AiError("unavailable", "The AI request failed", { cause: error });
}

/** OpenAI (official SDK): 60 s timeout, 2 retries (the SDK retries 429/5xx/timeouts). */
export function createAiClient(options: { apiKey?: string; model?: string; openai?: OpenAI } = {}): AiClient {
  let client = options.openai;
  const getClient = () => {
    client ??= new OpenAI({ apiKey: options.apiKey ?? aiEnv().OPENAI_API_KEY, timeout: 60_000, maxRetries: 2 });
    return client;
  };

  return {
    async generateStructured(input) {
      const model = input.model ?? options.model ?? aiEnv().OPENAI_MODEL;
      const log = aiEnv().AI_LOG_PROMPTS;
      if (log) logger.debug("AI request", { model, schemaName: input.schemaName, system: input.system, user: input.user });
      try {
        const response = await getClient().responses.parse({
          model,
          input: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          text: { format: zodTextFormat(input.schema, input.schemaName) },
        });
        if (response.output_parsed == null) {
          throw new AiError("schema_mismatch", "The AI returned no structured output");
        }
        const usage: AiUsage = {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        };
        if (log) logger.debug("AI response", { model: response.model, output: response.output_parsed });
        return { data: response.output_parsed as z.infer<typeof input.schema>, usage, model: response.model ?? model };
      } catch (error) {
        throw toAiError(error);
      }
    },
  };
}

let shared: AiClient | undefined;
export const getAiClient = (): AiClient => (shared ??= createAiClient());
