import { randomUUID } from "node:crypto";
import { resolveWebhookSecret } from "./secret.js";
import { bodyBytes, computeSignature } from "./verify.js";

export interface SignWebhookOptions {
  /**
   * Webhook secret; with a rotation list, the first one signs. Defaults to the
   * YOLLA_WEBHOOK_SECRET environment variable.
   */
  secret?: string | string[] | undefined;
  /** Unix time in seconds. Default: now. */
  timestamp?: number | undefined;
}

export interface SignedWebhook {
  body: string;
  headers: {
    "X-Voice-Timestamp": string;
    "X-Voice-Signature": string;
    "X-Voice-Delivery-Id": string;
  };
}

/**
 * Signs a payload the way the platform does, for tests of your webhook endpoint.
 * A string payload is signed as is; an object is serialized with `JSON.stringify`.
 */
export function signWebhook(
  payload: object | string,
  opts: SignWebhookOptions = {},
): SignedWebhook {
  const [secret] = resolveWebhookSecret(opts.secret) as [string, ...string[]];
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  return {
    body,
    headers: {
      "X-Voice-Timestamp": timestamp,
      "X-Voice-Signature": `v1=${computeSignature(secret, timestamp, bodyBytes(body))}`,
      "X-Voice-Delivery-Id": `dlv_${randomUUID().replaceAll("-", "")}`,
    },
  };
}
