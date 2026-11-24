import type { WebhookEvent } from "./events.js";
import type { HeadersLike } from "./headers.js";
import { type SignedWebhook, signWebhook } from "./sign.js";
import { verifyWebhook } from "./verify.js";

export interface WebhooksVerifyOptions {
  /** Overrides the client secret. */
  secret?: string | string[];
  toleranceSec?: number;
  now?: () => number;
}

export interface WebhooksSignOptions {
  /** Overrides the client secret. */
  secret?: string;
  timestamp?: number;
}

const MISSING_SECRET = "Missing webhook secret: pass secret or set YOLLA_WEBHOOK_SECRET";

/** Webhook helpers bound to the client's webhook secret. */
export class Webhooks {
  readonly #secret: string | string[] | undefined;

  constructor(secret: string | string[] | undefined) {
    this.#secret = secret;
  }

  #resolve(secret: string | string[] | undefined): string | string[] {
    const resolved = secret || this.#secret || process.env.YOLLA_WEBHOOK_SECRET;
    if (!resolved || (Array.isArray(resolved) && resolved.length === 0)) {
      throw new Error(MISSING_SECRET);
    }
    return resolved;
  }

  /** Verifies a webhook request and returns the parsed event. See `verifyWebhook`. */
  verify(
    rawBody: string | Uint8Array,
    headers: HeadersLike,
    opts: WebhooksVerifyOptions = {},
  ): WebhookEvent {
    return verifyWebhook(rawBody, headers, { ...opts, secret: this.#resolve(opts.secret) });
  }

  /** Signs a payload for tests. With a rotation list, signs with the first secret. */
  sign(payload: object | string, opts: WebhooksSignOptions = {}): SignedWebhook {
    const resolved = this.#resolve(opts.secret);
    const secret = typeof resolved === "string" ? resolved : (resolved[0] as string);
    return signWebhook(payload, { ...opts, secret });
  }
}
