import { describe, expectTypeOf, it } from "vitest";
import { YollaVoice } from "../src/client.js";
import type { RequestOptions } from "../src/http.js";
import type { CreateCallOptions } from "../src/resources/calls.js";
import { createWebhookHandler, type WebhookHandlerOptions } from "../src/webhooks/handler.js";
import { type SignWebhookOptions, signWebhook } from "../src/webhooks/sign.js";
import { type VerifyWebhookOptions, verifyWebhook } from "../src/webhooks/verify.js";

// Values as they come from process.env or an optional config field. This project compiles with
// exactOptionalPropertyTypes, so these checks fail if an option rejects `undefined`.
declare const maybe: string | undefined;
declare const maybeNumber: number | undefined;
declare const maybeSignal: AbortSignal | undefined;
declare const maybeSecrets: string | string[] | undefined;

describe("options accept undefined values", () => {
  it("YollaVoice options", () => {
    new YollaVoice({
      apiKey: maybe,
      timeoutMs: maybeNumber,
      maxRetries: maybeNumber,
      fetch: undefined,
      webhookSecret: maybeSecrets,
    });
  });

  it("per-call options", () => {
    const opts: RequestOptions = {
      maxRetries: maybeNumber,
      timeoutMs: maybeNumber,
      signal: maybeSignal,
    };
    const create: CreateCallOptions = { ...opts, idempotencyKey: maybe };
    expectTypeOf(create).toMatchTypeOf<RequestOptions>();
  });

  it("webhook verify, sign and handler options", () => {
    const verify: VerifyWebhookOptions = {
      secret: maybeSecrets,
      toleranceSec: maybeNumber,
      now: undefined,
    };
    const sign: SignWebhookOptions = { secret: maybe, timestamp: maybeNumber };
    const handler: WebhookHandlerOptions = {
      secret: maybeSecrets,
      toleranceSec: maybeNumber,
      on: { "call.completed": undefined },
      onUnhandled: undefined,
      onError: undefined,
    };
    expectTypeOf(verifyWebhook).parameter(2).toMatchTypeOf<typeof verify | undefined>();
    expectTypeOf(signWebhook).parameter(1).toMatchTypeOf<typeof sign | undefined>();
    expectTypeOf(createWebhookHandler).parameter(0).toEqualTypeOf<typeof handler>();
  });

  it("client webhook helpers", () => {
    const client = new YollaVoice();
    client.webhooks.verify("{}", {}, { secret: maybeSecrets, toleranceSec: maybeNumber });
    client.webhooks.sign("{}", { secret: maybe, timestamp: maybeNumber });
    client.webhooks.createHandler({ secret: maybeSecrets, on: {} });
  });
});

describe("handler callbacks", () => {
  it("accept callbacks that return a value", () => {
    const insert = async (_row: unknown): Promise<number> => 1;
    createWebhookHandler({
      secret: "s",
      on: {
        "call.completed": (event) => insert(event.data.call),
        "balance.low": (event) => event.data.available.amount,
      },
      onUnhandled: (event) => insert(event),
      onError: (err) => String(err),
    });
  });
});
