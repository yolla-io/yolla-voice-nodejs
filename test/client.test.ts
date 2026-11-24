import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { YollaVoice } from "../src/index.js";

const base = { apiKey: "yk_test_secret", baseUrl: "https://api.example.test" };

afterEach(() => vi.unstubAllEnvs());

describe("YollaVoice options", () => {
  it("requires an API key", () => {
    vi.stubEnv("YOLLA_API_KEY", "");
    expect(() => new YollaVoice({ baseUrl: base.baseUrl })).toThrow(
      new Error("Missing API key: pass apiKey or set YOLLA_API_KEY"),
    );
  });

  it("requires a base URL", () => {
    vi.stubEnv("YOLLA_BASE_URL", "");
    expect(() => new YollaVoice({ apiKey: base.apiKey })).toThrow(
      new Error("Missing baseUrl: pass baseUrl or set YOLLA_BASE_URL"),
    );
  });

  it("falls back to environment variables", () => {
    vi.stubEnv("YOLLA_API_KEY", "yk_test_env");
    vi.stubEnv("YOLLA_BASE_URL", "https://env.example.test");
    expect(() => new YollaVoice()).not.toThrow();
  });

  it("uses the env base URL when options are omitted", async () => {
    vi.stubEnv("YOLLA_API_KEY", "yk_test_env");
    vi.stubEnv("YOLLA_BASE_URL", "https://env.example.test");
    const urls: string[] = [];
    const client = new YollaVoice({
      fetch: (async (url: string) => {
        urls.push(String(url));
        return new Response("{}", { headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });
    await client.balance.get();
    expect(urls).toEqual(["https://env.example.test/v1/balance"]);
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
