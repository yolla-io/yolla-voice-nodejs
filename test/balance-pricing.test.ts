import { describe, expect, it } from "vitest";
import { ValidationError, YollaVoice } from "../src/index.js";
import { apiError, jsonResponse, type MockReply, mockFetch } from "./helpers/mock-fetch.js";

function make(...replies: MockReply[]) {
  const m = mockFetch(...replies);
  const client = new YollaVoice({
    apiKey: "yk_test_secret",
    fetch: m.fetch,
  });
  return { client, calls: m.calls };
}

describe("balance and pricing", () => {
  it("balance.get reads /v1/balance", async () => {
    const body = { available: { amount: "1.00", currency: "USD" } };
    const { client, calls } = make(jsonResponse(200, body));
    expect(await client.balance.get()).toEqual(body);
    expect(calls[0]?.url).toBe("https://platform.yolla.io/api/v1/balance");
  });

  it("getNumberPrice puts the number in the path", async () => {
    const { client, calls } = make(jsonResponse(200, {}));
    await client.pricing.getNumberPrice("4915112345678");
    expect(calls[0]?.url).toBe("https://platform.yolla.io/api/v1/pricing/numbers/4915112345678");
  });

  it("getNumberPrice encodes the path segment", async () => {
    const { client, calls } = make(jsonResponse(200, {}));
    await client.pricing.getNumberPrice("49/151");
    expect(calls[0]?.url).toBe("https://platform.yolla.io/api/v1/pricing/numbers/49%2F151");
  });

  it("maps 422 invalid_number to ValidationError", async () => {
    const { client } = make(apiError(422, "invalid_number", "bad", "r1"));
    await expect(client.pricing.getNumberPrice("x")).rejects.toBeInstanceOf(ValidationError);
  });
});
