import { describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, YollaVoice } from "../src/index.js";
import { apiError, jsonResponse, type MockReply, mockFetch } from "./helpers/mock-fetch.js";

const call = { id: "c1", status: "answered" };
const params = { externalUserId: "u1", destination: "+4915112345678" } as never;

function make(...replies: MockReply[]) {
  const m = mockFetch(...replies);
  const client = new YollaVoice({
    apiKey: "yk_test_secret",
    fetch: m.fetch,
    maxRetries: 2,
  });
  return { client, calls: m.calls };
}

function header(init: RequestInit, name: string) {
  return (init.headers as Record<string, string>)[name];
}

describe("calls.create", () => {
  it("sends the body and a UUID idempotency key", async () => {
    const { client, calls } = make(jsonResponse(201, call));
    const res = await client.calls.create(params);
    expect(res).toEqual({ call, replayed: false });
    expect(calls[0]?.url).toBe("https://platform.yolla.io/api/v1/calls");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual(params);
    expect(header(calls[0]?.init as RequestInit, "Idempotency-Key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("uses a given key and reports replays", async () => {
    const { client, calls } = make(jsonResponse(200, call));
    const res = await client.calls.create(params, { idempotencyKey: "k1" });
    expect(res.replayed).toBe(true);
    expect(header(calls[0]?.init as RequestInit, "Idempotency-Key")).toBe("k1");
  });

  it("keeps the same key across retries", async () => {
    const { client, calls } = make(
      apiError(503, "service_unavailable", "down", "r1", { "retry-after": "0" }),
      jsonResponse(201, call),
    );
    await client.calls.create(params);
    expect(calls).toHaveLength(2);
    expect(header(calls[0]?.init as RequestInit, "Idempotency-Key")).toBe(
      header(calls[1]?.init as RequestInit, "Idempotency-Key"),
    );
  });

  it("rejects a key longer than 128 chars before fetching", async () => {
    const { client, calls } = make();
    await expect(client.calls.create(params, { idempotencyKey: "x".repeat(129) })).rejects.toThrow(
      RangeError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("calls.list", () => {
  it("builds the query and exposes the page", async () => {
    const { client, calls } = make(jsonResponse(200, { items: [call], nextCursor: "n1" }));
    const page = await client.calls.list({ status: "answered", limit: 10 });
    expect(calls[0]?.url).toBe("https://platform.yolla.io/api/v1/calls?status=answered&limit=10");
    expect(page.items).toEqual([call]);
    expect(page.nextCursor).toBe("n1");
    expect(page.hasNextPage()).toBe(true);
  });

  it("returns a real promise that sends the first request at once", async () => {
    const { client, calls } = make(jsonResponse(200, { items: [call], nextCursor: null }));
    const list = client.calls.list();
    expect(list).toBeInstanceOf(Promise);
    expect(calls).toHaveLength(1);
    const onFinally = vi.fn();
    const page = await list.catch(() => undefined).finally(onFinally);
    expect(page?.items).toEqual([call]);
    expect(onFinally).toHaveBeenCalledTimes(1);
  });

  it("rejects through catch on an API error", async () => {
    const { client } = make(apiError(404, "call_not_found", "Call not found", "req_1"));
    const err = await client.calls.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it("iterates across pages with the original filters", async () => {
    const { client, calls } = make(
      jsonResponse(200, { items: [{ id: "a" }], nextCursor: "n1" }),
      jsonResponse(200, { items: [{ id: "b" }], nextCursor: "n2" }),
      jsonResponse(200, { items: [{ id: "c" }], nextCursor: null }),
    );
    const ids: string[] = [];
    for await (const c of client.calls.list({ status: "answered" })) ids.push(c.id);
    expect(ids).toEqual(["a", "b", "c"]);
    expect(calls).toHaveLength(3);
    expect(calls[1]?.url).toContain("status=answered");
    expect(calls[1]?.url).toContain("cursor=n1");
    expect(calls[2]?.url).toContain("cursor=n2");
  });

  it("nextPage fetches the next page", async () => {
    const { client } = make(
      jsonResponse(200, { items: [{ id: "a" }], nextCursor: "n1" }),
      jsonResponse(200, { items: [{ id: "b" }] }),
    );
    const page = await client.calls.list();
    const next = await page.nextPage();
    expect(next.items[0]?.id).toBe("b");
    expect(next.nextCursor).toBeNull();
    expect(next.hasNextPage()).toBe(false);
  });
});

describe("single call operations", () => {
  it("get hits the right path with the id encoded", async () => {
    const { client, calls } = make(jsonResponse(200, call));
    await client.calls.get("a/b c");
    expect(calls[0]?.url).toBe("https://platform.yolla.io/api/v1/calls/a%2Fb%20c");
    expect(calls[0]?.init.method).toBe("GET");
  });

  for (const [op, suffix] of [
    ["end", "end"],
    ["hold", "hold"],
    ["unhold", "unhold"],
  ] as const) {
    it(`${op} posts to /${suffix} and retries on 503`, async () => {
      const { client, calls } = make(
        apiError(503, "service_unavailable", "down", "r1", { "retry-after": "0" }),
        jsonResponse(202, call),
      );
      const res = await client.calls[op]("c 1");
      expect(res).toEqual(call);
      expect(calls).toHaveLength(2);
      expect(calls[1]?.url).toBe(`https://platform.yolla.io/api/v1/calls/c%201/${suffix}`);
      expect(calls[1]?.init.method).toBe("POST");
    });
  }

  it("hold maps 409 invalid_call_state to ConflictError", async () => {
    const { client } = make(apiError(409, "invalid_call_state", "bad state", "r2"));
    await expect(client.calls.hold("c1")).rejects.toMatchObject({
      constructor: ConflictError,
      code: "invalid_call_state",
    });
  });
});
