import { describe, expectTypeOf, it } from "vitest";
import type { components } from "../../src/generated/openapi.js";
import type { Balance, Call, QualitySummary } from "../../src/types.js";
import {
  type BalanceLowEvent,
  type CallQualityEvent,
  isKnownWebhookEvent,
  type KnownWebhookEvent,
  type UnknownWebhookEvent,
  type WebhookEvent,
  type WebhookEventOf,
  type WebhookEventType,
  type WebhookTestEvent,
} from "../../src/webhooks/events.js";

declare const event: WebhookEvent;

describe("webhook event types", () => {
  it("narrows call events to data.call", () => {
    if (event.type === "call.completed") {
      expectTypeOf(event.data.call).toEqualTypeOf<Call>();
      expectTypeOf(event.seq).toEqualTypeOf<number>();
      expectTypeOf(event.data.hold).toEqualTypeOf<
        | { initiator?: "client" | "server"; action?: "hold" | "unhold"; leg?: "caller" | "callee" }
        | undefined
      >();
    }
  });

  it("narrows balance.low to Balance", () => {
    if (event.type === "balance.low") {
      expectTypeOf(event.data).toEqualTypeOf<Balance>();
    }
  });

  it("gives call.quality a quality summary", () => {
    expectTypeOf<
      WebhookEventOf<"call.quality">["data"]["quality"]
    >().toEqualTypeOf<QualitySummary>();
    expectTypeOf<WebhookEventOf<"call.quality">["type"]>().toEqualTypeOf<"call.quality">();
  });

  it("lists the eleven known types", () => {
    expectTypeOf<WebhookEventType>().toEqualTypeOf<
      | "call.initiated"
      | "call.answered"
      | "call.held"
      | "call.unheld"
      | "call.hold_failed"
      | "call.completed"
      | "call.billed"
      | "call.expired"
      | "call.quality"
      | "balance.low"
      | "webhook.test"
    >();
  });

  it("keeps unknown events in the union, with data that must be cast", () => {
    expectTypeOf<UnknownWebhookEvent["type"]>().toEqualTypeOf<string>();
    expectTypeOf<UnknownWebhookEvent["data"]>().toBeNever();
    expectTypeOf<UnknownWebhookEvent>().toMatchTypeOf<WebhookEvent>();
    expectTypeOf(event.type).toMatchTypeOf<string>();
  });

  it("takes the envelope and payloads from the contract", () => {
    type Schemas = components["schemas"];
    expectTypeOf<CallQualityEvent>().toEqualTypeOf<Schemas["QualityEvent"]>();
    expectTypeOf<BalanceLowEvent>().toEqualTypeOf<Schemas["BalanceEvent"]>();
    expectTypeOf<WebhookTestEvent>().toEqualTypeOf<Schemas["TestEvent"]>();
    expectTypeOf<WebhookTestEvent["seq"]>().toEqualTypeOf<0>();
    expectTypeOf<WebhookEventOf<"call.completed">["data"]>().toEqualTypeOf<
      Schemas["CallEvent"]["data"]
    >();
  });

  it("isKnownWebhookEvent narrows to the known union", () => {
    if (isKnownWebhookEvent(event)) {
      expectTypeOf(event).toEqualTypeOf<KnownWebhookEvent>();
    }
  });
});
