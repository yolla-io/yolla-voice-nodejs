import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookVerificationError } from "../errors.js";
import type { WebhookEvent } from "./events.js";
import { getHeader, type HeadersLike } from "./headers.js";

export const TIMESTAMP_HEADER = "X-Voice-Timestamp";
export const SIGNATURE_HEADER = "X-Voice-Signature";
export const DELIVERY_ID_HEADER = "X-Voice-Delivery-Id";
export const DEFAULT_TOLERANCE_SEC = 300;

export interface VerifyWebhookOptions {
  /** Webhook secret, or several during rotation: the signature must match any one of them. */
  secret: string | string[];
  /** Allowed distance between the timestamp header and the clock. Default 300. */
  toleranceSec?: number;
  /** Clock in milliseconds. Default `Date.now`. */
  now?: () => number;
}

/** Bytes of the raw body: strings as UTF-8, so a string and its Buffer sign the same. */
export function bodyBytes(rawBody: unknown): Buffer {
  if (typeof rawBody === "string") return Buffer.from(rawBody, "utf8");
  if (rawBody instanceof Uint8Array) {
    return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  }
  throw new TypeError(
    "Webhook body must be the raw request body (string, Buffer or Uint8Array), not a parsed " +
      "object. With Express use express.raw({ type: 'application/json' }) on the webhook route.",
  );
}

/** HMAC-SHA256 hex of `${timestamp}.${body}`. */
export function computeSignature(secret: string, timestamp: string, body: Buffer): string {
  return createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), body]))
    .digest("hex");
}

/**
 * Checks the timestamp and signature of a webhook request and returns the parsed event.
 * Throws `WebhookVerificationError` when the request is not authentic.
 */
export function verifyWebhook(
  rawBody: string | Uint8Array,
  headers: HeadersLike,
  opts: VerifyWebhookOptions,
): WebhookEvent {
  const secrets = typeof opts.secret === "string" ? [opts.secret] : opts.secret;
  if (!Array.isArray(secrets) || secrets.length === 0 || secrets.some((s) => !s)) {
    throw new TypeError("Webhook secret must be a non-empty string or a non-empty list of them");
  }
  const body = bodyBytes(rawBody);

  const timestamp = getHeader(headers, TIMESTAMP_HEADER)?.trim();
  const signature = getHeader(headers, SIGNATURE_HEADER)?.trim();
  if (!timestamp || !signature) {
    throw new WebhookVerificationError(
      "missing_header",
      `Missing ${TIMESTAMP_HEADER} or ${SIGNATURE_HEADER} header`,
    );
  }
  if (!/^\d+$/.test(timestamp)) {
    throw new WebhookVerificationError("missing_header", `Invalid ${TIMESTAMP_HEADER} header`);
  }

  const toleranceSec = opts.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  const nowSec = (opts.now ?? Date.now)() / 1000;
  if (Math.abs(nowSec - Number(timestamp)) > toleranceSec) {
    throw new WebhookVerificationError(
      "stale_timestamp",
      `Webhook timestamp is more than ${toleranceSec} s away from the current time`,
    );
  }

  const received = signature.startsWith("v1=") ? Buffer.from(signature.slice(3), "utf8") : null;
  const matches =
    received !== null &&
    secrets.some((secret) => {
      const expected = Buffer.from(computeSignature(secret, timestamp, body), "utf8");
      return expected.length === received.length && timingSafeEqual(expected, received);
    });
  if (!matches) {
    throw new WebhookVerificationError("bad_signature", "Webhook signature does not match");
  }

  let event: unknown;
  try {
    event = JSON.parse(body.toString("utf8"));
  } catch {
    throw new WebhookVerificationError("invalid_payload", "Webhook body is not valid JSON");
  }
  if (
    typeof event !== "object" ||
    event === null ||
    Array.isArray(event) ||
    typeof (event as { id?: unknown }).id !== "string" ||
    typeof (event as { type?: unknown }).type !== "string"
  ) {
    throw new WebhookVerificationError(
      "invalid_payload",
      "Webhook body is not an event: id and type are required",
    );
  }
  return event as WebhookEvent;
}
