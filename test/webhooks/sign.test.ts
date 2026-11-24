import { afterEach, describe, expect, it, vi } from "vitest";
import { signWebhook } from "../../src/webhooks/sign.js";
import { verifyWebhook } from "../../src/webhooks/verify.js";
import { loadFixture } from "./fixture.js";

const fixture = loadFixture();
const [testVector] = fixture.vectors;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("signWebhook", () => {
  it("round-trips an object payload", () => {
    const payload = {
      id: "evt_1",
      type: "call.completed",
      seq: 3,
      createdAt: "2026-11-23T10:15:00.000Z",
      data: { call: { callId: "call_1", externalUserId: "ü" } },
    };
    const { body, headers } = signWebhook(payload, { secret: "s3cret" });
    expect(body).toBe(JSON.stringify(payload));
    expect(headers["X-Voice-Signature"]).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(headers["X-Voice-Delivery-Id"]).toMatch(/^dlv_[0-9a-f]{32}$/);
    const event = verifyWebhook(body, headers, { secret: "s3cret" });
    expect(event).toEqual(payload);
  });

  it("round-trips a string payload unchanged", () => {
    const { body, headers } = signWebhook(testVector.body, { secret: "s3cret" });
    expect(body).toBe(testVector.body);
    expect(verifyWebhook(body, headers, { secret: "s3cret" }).type).toBe("webhook.test");
  });

  it("defaults the timestamp to the current unix second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_800_000_000_999));
    const { headers } = signWebhook({ id: "evt_1", type: "webhook.test" }, { secret: "s" });
    expect(headers["X-Voice-Timestamp"]).toBe("1800000000");
  });

  it("reproduces the fixture signature", () => {
    const { headers } = signWebhook(testVector.body, {
      secret: fixture.secret,
      timestamp: fixture.timestamp,
    });
    expect(headers["X-Voice-Timestamp"]).toBe(String(fixture.timestamp));
    expect(headers["X-Voice-Signature"]).toBe(testVector.signature);
  });

  it("uses a new delivery id per call", () => {
    const a = signWebhook("{}", { secret: "s" }).headers["X-Voice-Delivery-Id"];
    const b = signWebhook("{}", { secret: "s" }).headers["X-Voice-Delivery-Id"];
    expect(a).not.toBe(b);
  });

  it("signs with the first secret of a list and falls back to YOLLA_WEBHOOK_SECRET", () => {
    const opts = { timestamp: fixture.timestamp };
    const expected = testVector.signature;
    const sig = (o: Parameters<typeof signWebhook>[1]) =>
      signWebhook(testVector.body, o).headers["X-Voice-Signature"];
    expect(sig({ ...opts, secret: [fixture.secret, "old"] })).toBe(expected);
    vi.stubEnv("YOLLA_WEBHOOK_SECRET", fixture.secret);
    expect(sig(opts)).toBe(expected);
    vi.stubEnv("YOLLA_WEBHOOK_SECRET", "");
    expect(() => sig(opts)).toThrow("Missing webhook secret");
  });
});
