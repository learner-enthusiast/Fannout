import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta webhook helpers (Facebook Pages and Threads share the mechanism).
 * Verification: GET with hub.mode=subscribe, hub.verify_token, hub.challenge.
 * Events: POST signed with X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(appSecret, rawBody).
 */
export function verifyMetaWebhookSubscription(
  query: Record<string, unknown>,
  verifyToken: string,
): string | null {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode !== "subscribe" || typeof token !== "string" || typeof challenge !== "string") return null;
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  return a.length === b.length && timingSafeEqual(a, b) ? challenge : null;
}

/** Must be called with the exact raw request body bytes. */
export function verifyMetaWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined | null,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const given = signatureHeader.slice("sha256=".length);
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
