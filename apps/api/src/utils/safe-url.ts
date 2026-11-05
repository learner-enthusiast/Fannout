import type { Request } from "express";

/** Paths whose query strings carry OAuth secrets (code, state). */
const REDACT_QUERY_PREFIXES = ["/api/oauth/"];

/** originalUrl for logs, with the query string dropped on sensitive routes. */
export function loggableUrl(req: Request): string {
  const url = req.originalUrl;
  return REDACT_QUERY_PREFIXES.some((prefix) => url.startsWith(prefix)) ? url.split("?")[0]! : url;
}
