import { afterEach, describe, expect, it, vi } from "vitest";
import { WebhookVerificationError } from "../../src/errors.js";
import { createWebhookHandler } from "../../src/webhooks/handler.js";
import { signWebhook } from "../../src/webhooks/sign.js";

const secret = "whsec_test";
const completed = { id: "evt_1", type: "call.completed", data: { callId: "c1" } };

function post(payload: object | string, opts: { secret?: string; method?: string } = {}) {
  const signed = signWebhook(payload, { secret: opts.secret ?? secret });
  return new Request("https://app.example.test/hook", {
    method: opts.method ?? "POST",
    headers: signed.headers,
    ...(opts.method !== "GET" && { body: signed.body }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

async function expectJson(res: Response, status: number, body: object) {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toBe("application/json");
  expect(await res.text()).toBe(JSON.stringify(body));
}

describe("createWebhookHandler fetch adapter", () => {
  it("calls the typed handler once and answers 200", async () => {
    const onCompleted = vi.fn();
    const handler = createWebhookHandler({ secret, on: { "call.completed": onCompleted } });
    await expectJson(await handler.fetch(post(completed)), 200, { received: true });
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledWith(completed);
  });

  it("routes events without a handler and unknown types to onUnhandled", async () => {
    const onUnhandled = vi.fn();
    const handler = createWebhookHandler({ secret, on: {}, onUnhandled });
    await expectJson(await handler.fetch(post({ id: "e", type: "webhook.test", data: {} })), 200, {
      received: true,
    });
    await expectJson(await handler.fetch(post({ id: "e2", type: "future.thing", data: {} })), 200, {
      received: true,
    });
    expect(onUnhandled).toHaveBeenCalledTimes(2);
  });

  it("answers 200 for an unhandled event without onUnhandled", async () => {
    const handler = createWebhookHandler({ secret, on: {} });
    expect((await handler.fetch(post(completed))).status).toBe(200);
  });

  it("answers 401 on a bad signature without calling handlers", async () => {
    const onCompleted = vi.fn();
    const handler = createWebhookHandler({ secret, on: { "call.completed": onCompleted } });
    await expectJson(await handler.fetch(post(completed, { secret: "wrong" })), 401, {
      error: "invalid signature",
    });
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it("passes a verification failure to onError and keeps the 401 body generic", async () => {
    const onError = vi.fn();
    const handler = createWebhookHandler({ secret, on: {}, onError });
    await expectJson(await handler.fetch(post(completed, { secret: "wrong" })), 401, {
      error: "invalid signature",
    });
    expect(onError).toHaveBeenCalledTimes(1);
    const [err] = onError.mock.calls[0] as [WebhookVerificationError];
    expect(err).toBeInstanceOf(WebhookVerificationError);
    expect(err.reason).toBe("bad_signature");
  });

  it("does not dispatch an event type named like an Object.prototype member", async () => {
    const onUnhandled = vi.fn();
    const handler = createWebhookHandler({ secret, on: {}, onUnhandled });
    for (const type of ["toString", "hasOwnProperty", "constructor"]) {
      expect((await handler.fetch(post({ id: "e", type, data: {} }))).status).toBe(200);
    }
    expect(onUnhandled).toHaveBeenCalledTimes(3);
  });

  it("answers 500 without leaking the error and reports it to onError", async () => {
    const boom = new Error("secret stack detail");
    const onError = vi.fn();
    const handler = createWebhookHandler({
      secret,
      on: {
        "call.completed": () => {
          throw boom;
        },
      },
      onError,
    });
    const res = await handler.fetch(post(completed));
    await expectJson(res, 500, { error: "handler failed" });
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it("answers 405 to a non-POST request", async () => {
    const handler = createWebhookHandler({ secret, on: {} });
    await expectJson(await handler.fetch(post(completed, { method: "GET" })), 405, {
      error: "method not allowed",
    });
  });

  it("answers 413 when content-length is over 1 MiB", async () => {
    const onCompleted = vi.fn();
    const handler = createWebhookHandler({ secret, on: { "call.completed": onCompleted } });
    const big = JSON.stringify({ ...completed, pad: "x".repeat(1024 * 1024 + 1) });
    const res = await handler.fetch(post(big));
    await expectJson(res, 413, { error: "payload too large" });
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it("stops reading a streamed body without content-length at 1 MiB and answers 413", async () => {
    const onUnhandled = vi.fn();
    const handler = createWebhookHandler({ secret, on: {}, onUnhandled });
    const chunk = new Uint8Array(64 * 1024).fill(120);
    let pulled = 0;
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= 20 * 1024 * 1024) return controller.close();
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        canceled = true;
      },
    });
    const request = new Request("https://app.example.test/hook", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();
    await expectJson(await handler.fetch(request), 413, { error: "payload too large" });
    expect(pulled).toBeLessThan(2 * 1024 * 1024);
    expect(canceled).toBe(true);
    expect(onUnhandled).not.toHaveBeenCalled();
  });

  it("falls back to YOLLA_WEBHOOK_SECRET", async () => {
    vi.stubEnv("YOLLA_WEBHOOK_SECRET", secret);
    const handler = createWebhookHandler({ secret: undefined, on: {} });
    expect((await handler.fetch(post(completed))).status).toBe(200);
  });

  it("throws at creation, not per request, when no secret is given or set", () => {
    vi.stubEnv("YOLLA_WEBHOOK_SECRET", "");
    expect(() => createWebhookHandler({ on: {} })).toThrow("Missing webhook secret");
    expect(() => createWebhookHandler({ secret: [secret, ""], on: {} })).toThrow(TypeError);
  });

  it("handle() returns only the status", async () => {
    const handler = createWebhookHandler({ secret, on: {} });
    const signed = signWebhook(completed, { secret });
    expect(await handler.handle(signed.body, signed.headers)).toEqual({ status: 200 });
    expect(await handler.handle("{}", {})).toEqual({ status: 401 });
  });
});
