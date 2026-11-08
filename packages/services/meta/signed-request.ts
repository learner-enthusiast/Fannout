import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Meta `signed_request` = "<base64url sig>.<base64url JSON payload>", signed with
 * HMAC-SHA256(payload, app secret). Used by the Facebook deauthorize / data-deletion
 * callbacks and the Threads uninstall / delete callbacks.
 * https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 *
 * Never log the raw value.
 */
export const SignedRequestPayloadSchema = z.looseObject({
  user_id: z.union([z.string().min(1), z.number().int()]).transform(String),
  algorithm: z.string().refine((a) => a.toUpperCase() === "HMAC-SHA256", "Unsupported algorithm"),
  issued_at: z.number().int(),
  expires: z.number().int().optional(),
});
export type SignedRequestPayload = z.infer<typeof SignedRequestPayloadSchema>;

const fromBase64Url = (value: string) => Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Returns the verified payload, or null for anything malformed/forged (callers answer 400, no details). */
export function verifySignedRequest(signedRequest: unknown, appSecret: string | undefined): SignedRequestPayload | null {
  if (typeof signedRequest !== "string" || !appSecret || signedRequest.length > 4096) return null;
  const dot = signedRequest.indexOf(".");
  if (dot <= 0 || dot === signedRequest.length - 1) return null;
  const encodedSig = signedRequest.slice(0, dot);
  const payload = signedRequest.slice(dot + 1);

  const expected = createHmac("sha256", appSecret).update(payload).digest();
  const actual = fromBase64Url(encodedSig);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const parsed = SignedRequestPayloadSchema.safeParse(JSON.parse(fromBase64Url(payload).toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
