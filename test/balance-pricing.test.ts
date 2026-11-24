import { describe, expect, it } from "vitest";
import { ValidationError, YollaVoice } from "../src/index.js";
import { apiError, jsonResponse, type MockReply, mockFetch } from "./helpers/mock-fetch.js";

function make(...replies: MockReply[]) {
  const m = mockFetch(...replies);
  const client = new YollaVoice({
    apiKey: "yk_test_secret",
    baseUrl: "https://api.example.test",
    fetch: m.fetch,
  });
  return { client, calls: m.calls };
}

describe("balance and pricing", () => {
  it("balance.get reads /v1/balance", async () => {
    const body = { available: { amount: "1.00", currency: "USD" } };
    const { client, calls } = make(jsonResponse(200, body));
    expect(await client.balance.get()).toEqual(body);
    expect(calls[0]?.url).toBe("https://api.example.test/v1/balance");
  });

  it("getNumberPrice encodes the number", async () => {
    const { client, calls } = make(jsonResponse(200, {}));
    await client.pricing.getNumberPrice("+4915112345678");
    expect(calls[0]?.url).toBe("https://api.example.test/v1/pricing/numbers/%2B4915112345678");
  });

  it("maps 422 invalid_number to ValidationError", async () => {
    const { client } = make(apiError(422, "invalid_number", "bad", "r1"));
    await expect(client.pricing.getNumberPrice("x")).rejects.toBeInstanceOf(ValidationError);
  });
});
