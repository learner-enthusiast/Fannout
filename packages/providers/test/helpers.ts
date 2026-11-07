import type { FetchLike } from "../common/provider.types";

export interface RecordedCall {
  method: string;
  url: URL;
  headers: Headers;
  body: BodyInit | null | undefined;
  /** Form-encoded or JSON body, decoded for assertions. */
  form: URLSearchParams | null;
  json: unknown;
}

export type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
type Handler = (call: RecordedCall) => Reply | Promise<Reply>;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Reply => ({ status, body, headers });

/**
 * A fetch that answers queued replies in order and records every request.
 * Fails loudly when more requests arrive than replies were queued.
 */
export function mockFetch(...replies: (Reply | Handler)[]) {
  const calls: RecordedCall[] = [];
  const queue = [...replies];
  const fetch: FetchLike = async (input, init) => {
    const headers = new Headers(init.headers);
    let form: URLSearchParams | null = null;
    let parsed: unknown = null;
    if (typeof init.body === "string") {
      if ((headers.get("content-type") ?? "").includes("x-www-form-urlencoded")) form = new URLSearchParams(init.body);
      else {
        try {
          parsed = JSON.parse(init.body);
        } catch {
          parsed = init.body;
        }
      }
    }
    const call: RecordedCall = { method: init.method ?? "GET", url: new URL(input), headers, body: init.body, form, json: parsed };
    calls.push(call);
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected request: ${call.method} ${call.url}`);
    const reply = typeof next === "function" ? await next(call) : next;
    const body = reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return new Response(body || null, {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  return { fetch, calls, pending: () => queue.length };
}

export const noSleep = async () => {};
