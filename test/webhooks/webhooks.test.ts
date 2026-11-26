import { afterEach, describe, expect, it, vi } from "vitest";
import { YollaVoice } from "../../src/client.js";
import { Webhooks } from "../../src/webhooks/index.js";
import { loadFixture } from "./fixture.js";

const fixture = loadFixture();
const [testVector] = fixture.vectors;
const headers = {
  "X-Voice-Timestamp": String(fixture.timestamp),
  "X-Voice-Signature": testVector.signature,
};
const now = () => fixture.timestamp * 1000;
const clientOpts = { apiKey: "sk_test" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Webhooks", () => {
  it("uses the client webhookSecret", () => {
    const client = new YollaVoice({ ...clientOpts, webhookSecret: fixture.secret });
    expect(client.webhooks).toBeInstanceOf(Webhooks);
    expect(client.webhooks.verify(testVector.body, headers, { now }).type).toBe("webhook.test");
  });

  it("falls back to YOLLA_WEBHOOK_SECRET", () => {
    vi.stubEnv("YOLLA_WEBHOOK_SECRET", fixture.secret);
    const client = new YollaVoice(clientOpts);
    expect(client.webhooks.verify(testVector.body, headers, { now }).type).toBe("webhook.test");
  });

  it("lets a per-call secret override the client secret", () => {
    const client = new YollaVoice({ ...clientOpts, webhookSecret: "other" });
    const event = client.webhooks.verify(testVector.body, headers, { now, secret: fixture.secret });
    expect(event.type).toBe("webhook.test");
  });

  it("signs with the client secret", () => {
    const client = new YollaVoice({ ...clientOpts, webhookSecret: fixture.secret });
    const signed = client.webhooks.sign(testVector.body, { timestamp: fixture.timestamp });
    expect(signed.headers["X-Voice-Signature"]).toBe(testVector.signature);
  });

  it("signs with the first secret of a rotation list", () => {
    const client = new YollaVoice({ ...clientOpts, webhookSecret: [fixture.secret, "old"] });
    const signed = client.webhooks.sign(testVector.body, { timestamp: fixture.timestamp });
    expect(signed.headers["X-Voice-Signature"]).toBe(testVector.signature);
  });

  it("throws when no secret is known", () => {
    vi.stubEnv("YOLLA_WEBHOOK_SECRET", "");
    const client = new YollaVoice(clientOpts);
    const message = "Missing webhook secret: pass secret or set YOLLA_WEBHOOK_SECRET";
    expect(() => client.webhooks.verify(testVector.body, headers, { now })).toThrow(message);
    expect(() => client.webhooks.sign("{}")).toThrow(message);
  });

  it("does not expose the secret", () => {
    const client = new YollaVoice({ ...clientOpts, webhookSecret: fixture.secret });
    expect(JSON.stringify(client.webhooks)).not.toContain(fixture.secret);
  });
});

describe("Webhooks.createHandler", () => {
  it("falls back to the client secret", async () => {
    const client = new YollaVoice({ ...clientOpts, webhookSecret: fixture.secret });
    const onUnhandled = vi.fn();
    const handler = client.webhooks.createHandler({ on: {}, onUnhandled });
    const signed = client.webhooks.sign({ id: "e", type: "webhook.test", data: {} });
    expect(await handler.handle(signed.body, signed.headers)).toEqual({ status: 200 });
    expect(onUnhandled).toHaveBeenCalledTimes(1);
  });
});
