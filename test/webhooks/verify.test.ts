import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebhookVerificationError } from "../../src/errors.js";
import { verifyWebhook } from "../../src/webhooks/verify.js";
import { loadFixture } from "./fixture.js";

const fixture = loadFixture();
const [testVector, callVector] = fixture.vectors;
const secret = fixture.secret;
const ts = fixture.timestamp;
const now = () => ts * 1000;

afterEach(() => {
  vi.unstubAllEnvs();
});

function headersFor(signature: string, timestamp: string = String(ts)) {
  return { "x-voice-timestamp": timestamp, "x-voice-signature": signature };
}

function expectReason(fn: () => unknown, reason: string): WebhookVerificationError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(WebhookVerificationError);
    const e = err as WebhookVerificationError;
    expect(e.reason).toBe(reason);
    expect(e.code).toBe(reason);
    expect(e.message).not.toContain(secret);
    return e;
  }
  throw new Error(`expected WebhookVerificationError(${reason})`);
}

describe("verifyWebhook", () => {
  it("verifies the fixture and returns the parsed event", () => {
    const event = verifyWebhook(testVector.body, headersFor(testVector.signature), {
      secret,
      now,
    });
    expect(event.type).toBe("webhook.test");
    expect(event.id).toBe("evt_01JDP9T4K7M2N5Q8R1S3V6X9Z0");
    expect(event.seq).toBe(0);
  });

  it("verifies the same body as string, Buffer and Uint8Array", () => {
    for (const vector of [testVector, callVector]) {
      const bytes = Buffer.from(vector.body, "utf8");
      const bodies = [vector.body, bytes, new Uint8Array(bytes)];
      for (const body of bodies) {
        const event = verifyWebhook(body, headersFor(vector.signature), { secret, now });
        expect(event.type).toBe(vector.name);
      }
    }
  });

  it("verifies the non-ASCII vector and keeps the character", () => {
    expect(callVector.body).toContain("ü");
    const event = verifyWebhook(callVector.body, headersFor(callVector.signature), {
      secret,
      now,
    });
    if (event.type !== "call.completed") throw new Error("wrong type");
    expect(event.data.call.externalUserId).toBe("user-ü-42");
  });

  it("rejects a changed byte in the body", () => {
    const body = testVector.body.replace('"seq": 0', '"seq": 1');
    expectReason(
      () => verifyWebhook(body, headersFor(testVector.signature), { secret, now }),
      "bad_signature",
    );
  });

  it("rejects a signature without v1=", () => {
    const sig = testVector.signature.slice(3);
    expectReason(
      () => verifyWebhook(testVector.body, headersFor(sig), { secret, now }),
      "bad_signature",
    );
  });

  it("rejects a signature of a different length without throwing from timingSafeEqual", () => {
    for (const sig of [`${testVector.signature}00`, testVector.signature.slice(0, -2), "v1="]) {
      expectReason(
        () => verifyWebhook(testVector.body, headersFor(sig), { secret, now }),
        "bad_signature",
      );
    }
  });

  it("rejects missing headers", () => {
    expectReason(
      () =>
        verifyWebhook(
          testVector.body,
          { "x-voice-signature": testVector.signature },
          {
            secret,
            now,
          },
        ),
      "missing_header",
    );
    expectReason(
      () => verifyWebhook(testVector.body, { "x-voice-timestamp": String(ts) }, { secret, now }),
      "missing_header",
    );
  });

  it("rejects a non-numeric timestamp", () => {
    for (const bad of ["abc", "", "12.5", "1e9"]) {
      expectReason(
        () =>
          verifyWebhook(testVector.body, headersFor(testVector.signature, bad), { secret, now }),
        "missing_header",
      );
    }
  });

  it("checks the timestamp window", () => {
    const at = (offsetSec: number) => () => (ts + offsetSec) * 1000;
    const headers = headersFor(testVector.signature);
    expectReason(
      () => verifyWebhook(testVector.body, headers, { secret, now: at(301) }),
      "stale_timestamp",
    );
    expect(verifyWebhook(testVector.body, headers, { secret, now: at(299) }).type).toBe(
      "webhook.test",
    );
    expectReason(
      () => verifyWebhook(testVector.body, headers, { secret, now: at(-301) }),
      "stale_timestamp",
    );
    expect(
      verifyWebhook(testVector.body, headers, { secret, now: at(301), toleranceSec: 600 }).type,
    ).toBe("webhook.test");
  });

  it("reads headers in any shape and case", () => {
    const shapes = [
      new Headers({ "X-Voice-Timestamp": String(ts), "X-Voice-Signature": testVector.signature }),
      { "X-VOICE-TIMESTAMP": String(ts), "X-VOICE-SIGNATURE": testVector.signature },
      { "x-voice-timestamp": [String(ts)], "x-voice-signature": [testVector.signature, "other"] },
    ];
    for (const headers of shapes) {
      expect(verifyWebhook(testVector.body, headers, { secret, now }).type).toBe("webhook.test");
    }
  });

  it("accepts any of several secrets", () => {
    const event = verifyWebhook(testVector.body, headersFor(testVector.signature), {
      secret: ["old", secret],
      now,
    });
    expect(event.type).toBe("webhook.test");
    expectReason(
      () =>
        verifyWebhook(testVector.body, headersFor(testVector.signature), {
          secret: ["old", "older"],
          now,
        }),
      "bad_signature",
    );
  });

  it("falls back to YOLLA_WEBHOOK_SECRET when secret is omitted, empty or an empty list", () => {
    vi.stubEnv("YOLLA_WEBHOOK_SECRET", secret);
    const headers = headersFor(testVector.signature);
    expect(verifyWebhook(testVector.body, headers, { now }).type).toBe("webhook.test");
    expect(verifyWebhook(testVector.body, headers, { secret: undefined, now }).type).toBe(
      "webhook.test",
    );
    expect(verifyWebhook(testVector.body, headers, { secret: "", now }).type).toBe("webhook.test");
    expect(verifyWebhook(testVector.body, headers, { secret: [], now }).type).toBe("webhook.test");
  });

  it("throws a missing-secret error when no secret is given or set", () => {
    vi.stubEnv("YOLLA_WEBHOOK_SECRET", "");
    const headers = headersFor(testVector.signature);
    const message = "Missing webhook secret: pass secret or set YOLLA_WEBHOOK_SECRET";
    expect(() => verifyWebhook(testVector.body, headers, { now })).toThrow(message);
    expect(() => verifyWebhook(testVector.body, headers, { secret: [], now })).toThrow(message);
  });

  it("throws TypeError on a rotation list with an empty secret", () => {
    expect(() =>
      verifyWebhook(testVector.body, headersFor(testVector.signature), {
        secret: [secret, ""],
        now,
      }),
    ).toThrow(TypeError);
  });

  it("throws TypeError naming express.raw when given a parsed body", () => {
    const parsed = JSON.parse(testVector.body) as unknown as string;
    expect(() => verifyWebhook(parsed, headersFor(testVector.signature), { secret, now })).toThrow(
      /express\.raw/,
    );
    expect(() => verifyWebhook(parsed, headersFor(testVector.signature), { secret, now })).toThrow(
      TypeError,
    );
  });

  it("rejects a validly signed body that is not JSON", () => {
    const body = "not json";
    const sig = sign(body);
    expectReason(() => verifyWebhook(body, headersFor(sig), { secret, now }), "invalid_payload");
  });

  it("rejects JSON without type or id", () => {
    for (const obj of [{ id: "evt_1", seq: 1 }, { type: "call.completed" }, [1], null, "str"]) {
      const body = JSON.stringify(obj);
      expectReason(
        () => verifyWebhook(body, headersFor(sign(body)), { secret, now }),
        "invalid_payload",
      );
    }
  });

  it("returns an event of unknown type without throwing", () => {
    const body = JSON.stringify({
      id: "evt_2",
      type: "call.transferred",
      seq: 7,
      createdAt: "2026-11-23T10:15:00.000Z",
      data: { foo: 1 },
    });
    const event = verifyWebhook(body, headersFor(sign(body)), { secret, now });
    expect(event.type).toBe("call.transferred");
    expect(event.data).toEqual({ foo: 1 });
  });

  it("never puts the secret or the expected signature in error messages", () => {
    const wrong = `v1=${"0".repeat(64)}`;
    const e = expectReason(
      () => verifyWebhook(testVector.body, headersFor(wrong), { secret, now }),
      "bad_signature",
    );
    expect(e.message).not.toContain(testVector.signature.slice(3));
    expect(e.message).not.toContain(wrong.slice(3));
    expect(String(e)).not.toContain(secret);
  });
});

function sign(body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
}
