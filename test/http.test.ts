import { inspect } from "node:util";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ConnectionError,
  RateLimitError,
  ServerError,
  TimeoutError,
  YollaVoiceError,
} from "../src/errors.js";
import { HttpClient } from "../src/http.js";
import { VERSION } from "../src/version.js";
import { apiError, hang, jsonResponse, mockFetch } from "./helpers/mock-fetch.js";

const API_KEY = "sk_test_secret_key_123";
const BASE = "https://api.example.test";

const thrown: unknown[] = [];

function client(
  fetch: typeof globalThis.fetch,
  extra: { maxRetries?: number; timeoutMs?: number } = {},
) {
  return new HttpClient({
    apiKey: API_KEY,
    baseUrl: BASE,
    timeoutMs: extra.timeoutMs ?? 30_000,
    maxRetries: extra.maxRetries ?? 2,
    fetch,
  });
}

/** Resolves to the rejection reason and records it for the API-key check. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    thrown.push(err);
    return err;
  }
  throw new Error("expected a rejection");
}

const get = { method: "GET", path: "/v1/balance", retryable: true } as const;

afterAll(() => {
  expect(thrown.length).toBeGreaterThan(0);
  for (const err of thrown) {
    const e = err as Error;
    expect(e.message).not.toContain(API_KEY);
    expect(String(e)).not.toContain(API_KEY);
    expect(JSON.stringify(e)).not.toContain(API_KEY);
    expect(inspect(e, { depth: 10 })).not.toContain(API_KEY);
  }
});

describe("request building", () => {
  test("sends the standard headers and parses JSON", async () => {
    const m = mockFetch(jsonResponse(200, { amount: "1.00" }, { "x-request-id": "req_ok" }));
    const res = await client(m.fetch).request<{ amount: string }>(get);
    expect(res.data).toEqual({ amount: "1.00" });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("req_ok");
    const headers = new Headers(m.calls[0]?.init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(headers.get("user-agent")).toBe(
      `yolla-voice-nodejs/${VERSION} node/${process.versions.node}`,
    );
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.has("content-type")).toBe(false);
    expect(m.calls[0]?.init.method).toBe("GET");
  });

  test("a body is sent as JSON with Content-Type and extra headers", async () => {
    const m = mockFetch(jsonResponse(201, { id: "call_1" }));
    await client(m.fetch).request({
      method: "POST",
      path: "/v1/calls",
      body: { to: "4915112345678" },
      headers: { "Idempotency-Key": "key-1" },
      retryable: true,
    });
    const headers = new Headers(m.calls[0]?.init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("idempotency-key")).toBe("key-1");
    expect(m.calls[0]?.init.body).toBe('{"to":"4915112345678"}');
  });

  test.each([BASE, `${BASE}/`])("joins baseUrl %s with the path", async (baseUrl) => {
    const m = mockFetch(jsonResponse(200, {}));
    const c = new HttpClient({
      apiKey: API_KEY,
      baseUrl,
      timeoutMs: 1000,
      maxRetries: 0,
      fetch: m.fetch,
    });
    await c.request(get);
    expect(m.calls[0]?.url).toBe(`${BASE}/v1/balance`);
  });

  test("query skips undefined values; encoded path segments survive", async () => {
    const m = mockFetch(jsonResponse(200, {}));
    await client(m.fetch).request({
      method: "GET",
      path: `/v1/pricing/${encodeURIComponent("a/b c")}`,
      query: { limit: 10, cursor: undefined, status: "completed" },
      retryable: true,
    });
    expect(m.calls[0]?.url).toBe(`${BASE}/v1/pricing/a%2Fb%20c?limit=10&status=completed`);
  });

  test("an empty or non-JSON body gives undefined data", async () => {
    const m = mockFetch(new Response(null, { status: 204 }), new Response("ok", { status: 200 }));
    const c = client(m.fetch);
    expect((await c.request(get)).data).toBeUndefined();
    expect((await c.request(get)).data).toBeUndefined();
  });
});

describe("retries", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("503, 503, 200 with retryable: 3 attempts with jittered backoff", async () => {
    const m = mockFetch(
      apiError(503, "service_unavailable", "Unavailable", "r1"),
      apiError(503, "service_unavailable", "Unavailable", "r2"),
      jsonResponse(200, { ok: true }),
    );
    const promise = client(m.fetch, { maxRetries: 2 }).request(get);
    await vi.advanceTimersByTimeAsync(0);
    expect(m.calls).toHaveLength(1);
    // attempt 0: 0.5 * min(8000, 500 * 2^0) = 250 ms
    await vi.advanceTimersByTimeAsync(249);
    expect(m.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(m.calls).toHaveLength(2);
    // attempt 1: 0.5 * 1000 = 500 ms
    await vi.advanceTimersByTimeAsync(499);
    expect(m.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(m.calls).toHaveLength(3);
    await expect(promise).resolves.toMatchObject({ data: { ok: true }, status: 200 });
  });

  test("503 with retryable: false is not retried", async () => {
    const m = mockFetch(apiError(503, "service_unavailable", "Unavailable", "r1"));
    const err = await rejection(client(m.fetch).request({ ...get, retryable: false }));
    expect(err).toBeInstanceOf(ServerError);
    expect(m.calls).toHaveLength(1);
  });

  test("retry exhaustion rejects with the last attempt's ServerError", async () => {
    const m = mockFetch(
      apiError(500, "internal_error", "Internal error", "req_a"),
      apiError(500, "internal_error", "Internal error", "req_b"),
      apiError(500, "internal_error", "Internal error", "req_c"),
    );
    const promise = rejection(client(m.fetch, { maxRetries: 2 }).request(get));
    await vi.runAllTimersAsync();
    const err = await promise;
    expect(err).toBeInstanceOf(ServerError);
    expect((err as ServerError).requestId).toBe("req_c");
    expect((err as ServerError).code).toBe("internal_error");
    expect(m.calls).toHaveLength(3);
  });

  test("429 Retry-After in seconds overrides the backoff", async () => {
    const m = mockFetch(
      apiError(429, "rate_limited", "Too many requests", "r1", { "Retry-After": "2" }),
      jsonResponse(200, {}),
    );
    const promise = client(m.fetch).request(get);
    await vi.advanceTimersByTimeAsync(1999);
    expect(m.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(m.calls).toHaveLength(2);
    await expect(promise).resolves.toMatchObject({ status: 200 });
  });

  test("429 Retry-After as an HTTP date is honoured", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const m = mockFetch(
      apiError(429, "rate_limited", "Too many requests", "r1", {
        "Retry-After": new Date("2026-01-01T00:00:03Z").toUTCString(),
      }),
      jsonResponse(200, {}),
    );
    const promise = client(m.fetch).request(get);
    await vi.advanceTimersByTimeAsync(2999);
    expect(m.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(m.calls).toHaveLength(2);
    await expect(promise).resolves.toMatchObject({ status: 200 });
  });

  test("Retry-After is capped at 60 s", async () => {
    const m = mockFetch(
      apiError(429, "rate_limited", "Too many requests", "r1", { "Retry-After": "3600" }),
      jsonResponse(200, {}),
    );
    const promise = client(m.fetch).request(get);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(m.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(m.calls).toHaveLength(2);
    await expect(promise).resolves.toMatchObject({ status: 200 });
  });

  test("429 exhaustion rejects with RateLimitError", async () => {
    const m = mockFetch(
      apiError(429, "rate_limited", "Too many requests", "r1", { "Retry-After": "1" }),
    );
    const err = await rejection(client(m.fetch, { maxRetries: 0 }).request(get));
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(1000);
  });

  test.each([400, 401, 402, 403, 404, 409, 422])("%i is never retried", async (status) => {
    const m = mockFetch(apiError(status, "some_code", "Failed", "r1"));
    const err = await rejection(client(m.fetch).request(get));
    expect(err).toBeInstanceOf(YollaVoiceError);
    expect((err as YollaVoiceError).status).toBe(status);
    expect(m.calls).toHaveLength(1);
  });

  test("a network TypeError is retried, then ConnectionError with cause", async () => {
    const cause = new TypeError("fetch failed");
    const m = mockFetch(cause, new TypeError("fetch failed"), new TypeError("fetch failed"));
    const promise = rejection(client(m.fetch).request(get));
    await vi.runAllTimersAsync();
    const err = await promise;
    expect(err).toBeInstanceOf(ConnectionError);
    expect((err as ConnectionError).code).toBe("connection_error");
    expect((err as ConnectionError).cause).toBeInstanceOf(TypeError);
    expect(m.calls).toHaveLength(3);
  });

  test("per-call maxRetries: 0 overrides the client value", async () => {
    const m = mockFetch(apiError(503, "service_unavailable", "Unavailable", "r1"));
    const err = await rejection(client(m.fetch, { maxRetries: 5 }).request(get, { maxRetries: 0 }));
    expect(err).toBeInstanceOf(ServerError);
    expect(m.calls).toHaveLength(1);
  });

  test("invalid per-call maxRetries or timeoutMs rejects before any request", async () => {
    const m = mockFetch(jsonResponse(200, {}));
    const http = client(m.fetch);
    for (const opts of [
      { maxRetries: Number.NaN },
      { maxRetries: Number.POSITIVE_INFINITY },
      { maxRetries: -1 },
      { timeoutMs: Number.NaN },
      { timeoutMs: 0 },
    ]) {
      expect(await rejection(http.request(get, opts))).toBeInstanceOf(RangeError);
    }
    expect(m.calls).toHaveLength(0);
  });

  test("caller abort during the backoff sleep rejects with the abort reason", async () => {
    const m = mockFetch(
      apiError(503, "service_unavailable", "Unavailable", "r1"),
      jsonResponse(200, {}),
    );
    const controller = new AbortController();
    const reason = new Error("caller gave up");
    const promise = rejection(client(m.fetch).request(get, { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(100);
    expect(m.calls).toHaveLength(1);
    controller.abort(reason);
    expect(await promise).toBe(reason);
    await vi.runAllTimersAsync();
    expect(m.calls).toHaveLength(1);
  });
});

describe("abort and timeout", () => {
  afterEach(() => vi.restoreAllMocks());

  test("a signal aborted before the call makes no fetch", async () => {
    const m = mockFetch(jsonResponse(200, {}));
    const reason = new Error("already aborted");
    const err = await rejection(
      client(m.fetch).request(get, { signal: AbortSignal.abort(reason) }),
    );
    expect(err).toBe(reason);
    expect(m.calls).toHaveLength(0);
  });

  test("caller abort during fetch rejects with the abort reason, no retry", async () => {
    const m = mockFetch(hang(), jsonResponse(200, {}));
    const controller = new AbortController();
    const reason = new Error("caller gave up");
    const promise = rejection(client(m.fetch).request(get, { signal: controller.signal }));
    await new Promise((r) => setTimeout(r, 5));
    controller.abort(reason);
    expect(await promise).toBe(reason);
    expect(m.calls).toHaveLength(1);
  });

  test("no answer within timeoutMs gives TimeoutError, retried like a network error", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const m = mockFetch(hang(), hang());
    const err = await rejection(client(m.fetch, { timeoutMs: 50, maxRetries: 1 }).request(get));
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).code).toBe("timeout");
    expect((err as TimeoutError).message).toContain("50 ms");
    expect(m.calls).toHaveLength(2);
  });

  test("the timeout applies per attempt", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const m = mockFetch(hang(), jsonResponse(200, { ok: true }));
    const res = await client(m.fetch, { timeoutMs: 50, maxRetries: 1 }).request(get);
    expect(res.data).toEqual({ ok: true });
  });

  test("the per-call timeoutMs overrides the client value", async () => {
    const m = mockFetch(hang());
    const err = await rejection(
      client(m.fetch, { timeoutMs: 30_000, maxRetries: 0 }).request(get, { timeoutMs: 20 }),
    );
    expect(err).toBeInstanceOf(TimeoutError);
  });
});

describe("secrecy", () => {
  test("the client does not expose the API key", () => {
    const c = client(mockFetch().fetch);
    expect(JSON.stringify(c)).not.toContain(API_KEY);
    expect(inspect(c, { depth: 10, showHidden: true })).not.toContain(API_KEY);
    expect(String(c)).not.toContain(API_KEY);
  });
});
