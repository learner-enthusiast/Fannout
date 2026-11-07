import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Page } from "./pagination";

/*
 * Shared pieces of Meta's Graph API conventions, used by both the Threads
 * (graph.threads.net) and Facebook Pages (graph.facebook.com) providers.
 */

/** Cursor paging block returned by Graph edges. */
export const GraphPagingSchema = z.looseObject({
  cursors: z.looseObject({ before: z.string().optional(), after: z.string().optional() }).optional(),
  next: z.string().optional(),
  previous: z.string().optional(),
});

export function graphListSchema<T extends z.ZodType>(item: T) {
  return z.looseObject({ data: z.array(item), paging: GraphPagingSchema.optional() });
}

/** `{ success: true }` returned by most Graph mutations. */
export const GraphSuccessSchema = z.looseObject({ success: z.boolean() });
export type GraphSuccess = z.infer<typeof GraphSuccessSchema>;

/** `{ id }` returned by Graph create calls. */
export const GraphIdSchema = z.looseObject({ id: z.string() });
export type GraphId = z.infer<typeof GraphIdSchema>;

/** Cursor-based paging inputs shared by Graph edges. `before` and `after` are mutually exclusive. */
export const graphCursorFields = {
  limit: z.number().int().min(1).max(100).optional(),
  before: z.string().min(1).optional(),
  after: z.string().min(1).optional(),
};

export const noBeforeAndAfter = (v: { before?: string; after?: string }) => !(v.before && v.after);
export const NO_BEFORE_AND_AFTER = { message: "`before` and `after` cannot be used together", path: ["after"] };

/** Convert a Graph list response into the shared Page shape (next cursor only when a next page exists). */
export function toGraphPage<T>(data: { data: T[]; paging?: z.infer<typeof GraphPagingSchema> }): Page<T> {
  return {
    items: data.data,
    nextCursor: data.paging?.next ? (data.paging.cursors?.after ?? null) : null,
    previousCursor: data.paging?.previous ? (data.paging.cursors?.before ?? null) : null,
  };
}

/** Graph error body: `{ error: { message, type, code, error_subcode, fbtrace_id } }`. */
export function parseGraphError(_status: number, body: unknown): { message?: string; providerCode?: string | null } {
  const error = (body as { error?: Record<string, unknown> } | null)?.error;
  if (!error || typeof error !== "object") return {};
  const code = error.code != null ? String(error.code) : null;
  const sub = error.error_subcode != null ? String(error.error_subcode) : null;
  return {
    message: typeof error.message === "string" ? error.message : undefined,
    providerCode: code && sub ? `${code}:${sub}` : code,
  };
}

/** `appsecret_proof` = HMAC-SHA256(access_token, app_secret), hex. */
export function appSecretProof(accessToken: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

/** Graph `fields` parameter: arrays are comma-joined by the HTTP client. */
export const graphFields = <T extends readonly [string, ...string[]]>(values: T) => z.array(z.enum(values)).min(1);

type FormValue = string | number | boolean | undefined;

/**
 * Encode a Graph POST body as form fields: primitive arrays are comma-joined
 * (e.g. `children`), objects and object arrays are sent as JSON strings
 * (e.g. `poll_attachment`, `text_entities`), undefined/null are dropped.
 */
export function toGraphForm(input: Record<string, unknown>): Record<string, FormValue> {
  const out: Record<string, FormValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.every((v) => typeof v !== "object")) out[key] = value.join(",");
    else if (typeof value === "object") out[key] = JSON.stringify(value);
    else out[key] = value as FormValue;
  }
  return out;
}
