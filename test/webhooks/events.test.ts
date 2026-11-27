import { describe, expect, it } from "vitest";
import { isKnownWebhookEvent, type WebhookEvent } from "../../src/webhooks/events.js";

const event = (type: string) =>
  ({ id: "e", type, seq: 0, createdAt: "", data: {} }) as WebhookEvent;

describe("isKnownWebhookEvent", () => {
  it("is true for the event types of the contract", () => {
    for (const type of [
      "call.initiated",
      "call.completed",
      "call.billed",
      "call.quality",
      "balance.low",
    ]) {
      expect(isKnownWebhookEvent(event(type))).toBe(true);
    }
    expect(isKnownWebhookEvent(event("webhook.test"))).toBe(true);
  });

  it("is false for unknown types and Object.prototype names", () => {
    for (const type of ["call.transferred", "toString", "constructor", ""]) {
      expect(isKnownWebhookEvent(event(type))).toBe(false);
    }
  });
});
