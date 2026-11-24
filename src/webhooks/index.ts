import type { WebhookEvent } from "./events.js";
import {
  createWebhookHandler,
  type WebhookHandler,
  type WebhookHandlerOptions,
} from "./handler.js";
import type { HeadersLike } from "./headers.js";
import type { WebhookSecret } from "./secret.js";
import { type SignedWebhook, type SignWebhookOptions, signWebhook } from "./sign.js";
import { type VerifyWebhookOptions, verifyWebhook } from "./verify.js";

/** Webhook helpers that default `secret` to the client's `webhookSecret`. */
export class Webhooks {
  readonly #secret: WebhookSecret | undefined;

  constructor(secret: WebhookSecret | undefined) {
    this.#secret = secret;
  }

  /** Verifies a webhook request and returns the parsed event. See `verifyWebhook`. */
  verify(
    rawBody: string | Uint8Array,
    headers: HeadersLike,
    opts: VerifyWebhookOptions = {},
  ): WebhookEvent {
    return verifyWebhook(rawBody, headers, { ...opts, secret: opts.secret ?? this.#secret });
  }

  /** Signs a payload for tests. With a rotation list, signs with the first secret. */
  sign(payload: object | string, opts: SignWebhookOptions = {}): SignedWebhook {
    return signWebhook(payload, { ...opts, secret: opts.secret ?? this.#secret });
  }

  /** Creates a webhook endpoint handler. See `createWebhookHandler`. */
  createHandler(opts: WebhookHandlerOptions): WebhookHandler {
    return createWebhookHandler({ ...opts, secret: opts.secret ?? this.#secret });
  }
}
