import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { YollaVoice } from "../src/index.js";

const base = { apiKey: "yk_test_secret" };

afterEach(() => vi.unstubAllEnvs());

describe("YollaVoice options", () => {
  it("requires an API key", () => {
    vi.stubEnv("YOLLA_API_KEY", "");
    expect(() => new YollaVoice()).toThrow(
      new Error("Missing API key: pass apiKey or set YOLLA_API_KEY"),
    );
  });

  it("falls back to environment variables", () => {
    vi.stubEnv("YOLLA_API_KEY", "yk_test_env");
    expect(() => new YollaVoice()).not.toThrow();
  });

  it("calls the Yolla API at platform.yolla.io", async () => {
    vi.stubEnv("YOLLA_API_KEY", "yk_test_env");
    const urls: string[] = [];
    const client = new YollaVoice({
      fetch: (async (url: string) => {
        urls.push(String(url));
        return new Response("{}", { headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });
    await client.balance.get();
    expect(urls).toEqual(["https://platform.yolla.io/api/v1/balance"]);
  });

  it("never exposes the key", () => {
    const client = new YollaVoice(base);
    expect(String(client)).not.toContain("yk_test_secret");
    expect(JSON.stringify(client)).not.toContain("yk_test_secret");
    expect(inspect(client, { depth: 10, showHidden: true })).not.toContain("yk_test_secret");
  });

  it("rejects invalid numeric options", () => {
    expect(() => new YollaVoice({ ...base, maxRetries: -1 })).toThrow(RangeError);
    expect(() => new YollaVoice({ ...base, timeoutMs: 0 })).toThrow(RangeError);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(() => new YollaVoice({ ...base, maxRetries: bad })).toThrow(RangeError);
    }
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new YollaVoice({ ...base, timeoutMs: bad })).toThrow(RangeError);
    }
  });
});
