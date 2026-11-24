import { describe, expect, test } from "vitest";
import {
  AuthenticationError,
  ConflictError,
  ConnectionError,
  errorFromResponse,
  InsufficientBalanceError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  TimeoutError,
  ValidationError,
  WebhookVerificationError,
  YollaVoiceError,
} from "../src/errors.js";

function body(code: string, message: string, requestId: string) {
  return { error: { code, message, requestId } };
}

describe("errorFromResponse", () => {
  const cases = [
    [400, ValidationError, "invalid_request"],
    [401, AuthenticationError, "invalid_api_key"],
    [402, InsufficientBalanceError, "insufficient_balance"],
    [403, PermissionError, "destination_not_allowed"],
    [404, NotFoundError, "call_not_found"],
    [409, ConflictError, "idempotency_conflict"],
    [422, ValidationError, "invalid_params"],
    [429, RateLimitError, "rate_limited"],
    [500, ServerError, "internal_error"],
    [503, ServerError, "service_unavailable"],
  ] as const;

  test.each(cases)("%i maps to %O and keeps the body fields", (status, cls, code) => {
    const err = errorFromResponse(status, body(code, "Something failed", "req_1"), new Headers());
    expect(err).toBeInstanceOf(cls);
    expect(err).toBeInstanceOf(YollaVoiceError);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(err.message).toBe("Something failed");
    expect(err.requestId).toBe("req_1");
    expect(err.name).toBe(cls.name);
  });

  test.each([413, 426])("%i maps to exactly YollaVoiceError", (status) => {
    const err = errorFromResponse(status, body("too_large", "Too large", "req_2"), new Headers());
    expect(err.constructor).toBe(YollaVoiceError);
    expect(err.name).toBe("YollaVoiceError");
    expect(err.status).toBe(status);
    expect(err.code).toBe("too_large");
  });

  test("an HTML body on 502 gives unknown_error with the request id from the header", () => {
    const err = errorFromResponse(
      502,
      "<html><body>Bad Gateway</body></html>",
      new Headers({ "X-Request-Id": "req_hdr" }),
    );
    expect(err).toBeInstanceOf(ServerError);
    expect(err.code).toBe("unknown_error");
    expect(err.message).toBe("HTTP 502");
    expect(err.requestId).toBe("req_hdr");
  });

  test("the header request id is used when the body has none", () => {
    const err = errorFromResponse(
      404,
      { error: { code: "call_not_found", message: "Call not found" } },
      new Headers({ "x-request-id": "req_hdr" }),
    );
    expect(err.code).toBe("call_not_found");
    expect(err.requestId).toBe("req_hdr");
  });

  test("an empty body and no header leave requestId undefined", () => {
    const err = errorFromResponse(500, undefined, new Headers());
    expect(err.code).toBe("unknown_error");
    expect(err.message).toBe("HTTP 500");
    expect(err.requestId).toBeUndefined();
  });

  test("429 reads Retry-After into retryAfterMs", () => {
    const err = errorFromResponse(
      429,
      body("rate_limited", "Slow down", "req_3"),
      new Headers({ "Retry-After": "3" }),
    );
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(3000);
  });
});

describe("SDK-side errors", () => {
  test("every class is a YollaVoiceError and has its class name", () => {
    const cause = new TypeError("fetch failed");
    const errors = [
      new ConnectionError("Connection failed", { cause }),
      new TimeoutError("Request timed out after 50 ms"),
      new WebhookVerificationError("bad_signature", "Signature does not match"),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(YollaVoiceError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe(err.constructor.name);
      expect(err.status).toBeUndefined();
    }
    expect(errors[0]?.code).toBe("connection_error");
    expect(errors[0]?.cause).toBe(cause);
    expect(errors[1]?.code).toBe("timeout");
  });

  test("WebhookVerificationError uses its reason as the code", () => {
    const err = new WebhookVerificationError(
      "stale_timestamp",
      "Timestamp is outside the tolerance",
    );
    expect(err.reason).toBe("stale_timestamp");
    expect(err.code).toBe("stale_timestamp");
    expect(err.message).toBe("Timestamp is outside the tolerance");
  });
});
