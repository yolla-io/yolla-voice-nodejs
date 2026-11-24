import { randomUUID } from "node:crypto";
import { bodyBytes, computeSignature } from "./verify.js";

export interface SignWebhookOptions {
  secret: string;
  /** Unix time in seconds. Default: now. */
  timestamp?: number;
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
export function signWebhook(payload: object | string, opts: SignWebhookOptions): SignedWebhook {
  if (!opts.secret) throw new TypeError("Webhook secret must be a non-empty string");
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  return {
    body,
    headers: {
      "X-Voice-Timestamp": timestamp,
      "X-Voice-Signature": `v1=${computeSignature(opts.secret, timestamp, bodyBytes(body))}`,
      "X-Voice-Delivery-Id": `dlv_${randomUUID().replaceAll("-", "")}`,
    },
  };
}
