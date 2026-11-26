/** Error codes the API-key operations can return, plus the SDK's own codes. */
export type ErrorCode =
  | "invalid_request"
  | "invalid_params"
  | "invalid_api_key"
  | "call_not_found"
  | "idempotency_conflict"
  | "invalid_call_state"
  | "invalid_number"
  | "insufficient_balance"
  | "destination_not_allowed"
  | "partner_blocked"
  | "caller_blocked"
  | "caller_id_not_allowed"
  | "caller_id_invalid"
  | "destination_blocked"
  | "user_blocked"
  | "service_unavailable"
  | "internal_error"
  | "rate_limited"
  | "concurrent_limit"
  | "payload_too_large"
  | "connection_error"
  | "timeout"
  | "invalid_response"
  | "unknown_error"
  | "missing_header"
  | "bad_signature"
  | "stale_timestamp"
  | "invalid_payload"
  | (string & {});

export interface YollaVoiceErrorInit {
  status?: number | undefined;
  code: ErrorCode;
  requestId?: string | undefined;
  cause?: unknown;
}

/** Base class of every error the SDK throws. */
export class YollaVoiceError extends Error {
  override name = "YollaVoiceError";
  /** HTTP status, or undefined when there was no response. */
  readonly status: number | undefined;
  readonly code: ErrorCode;
  /** Request id from the API, for support requests. */
  readonly requestId: string | undefined;

  constructor(message: string, init: YollaVoiceErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
  }
}

/** 400 or 422: the request is malformed or its parameters are invalid. */
export class ValidationError extends YollaVoiceError {
  override name = "ValidationError";
}

/** 401: the API key is missing or invalid. */
export class AuthenticationError extends YollaVoiceError {
  override name = "AuthenticationError";
}

/** 402: the balance is too low. */
export class InsufficientBalanceError extends YollaVoiceError {
  override name = "InsufficientBalanceError";
}

/** 403: the operation is not allowed (blocked partner, user, destination, caller id). */
export class PermissionError extends YollaVoiceError {
  override name = "PermissionError";
}

/** 404: the resource does not exist. */
export class NotFoundError extends YollaVoiceError {
  override name = "NotFoundError";
}

/** 409: idempotency conflict or the call is in a state that does not allow the operation. */
export class ConflictError extends YollaVoiceError {
  override name = "ConflictError";
}

/** 429: too many requests or too many concurrent calls. */
export class RateLimitError extends YollaVoiceError {
  override name = "RateLimitError";
  /** Delay from the `Retry-After` header, if present. */
  readonly retryAfterMs: number | undefined;

  constructor(message: string, init: YollaVoiceErrorInit & { retryAfterMs?: number | undefined }) {
    super(message, init);
    this.retryAfterMs = init.retryAfterMs;
  }
}

/** 5xx: the API failed to handle the request. */
export class ServerError extends YollaVoiceError {
  override name = "ServerError";
}

/** The request got no response: DNS, TCP, TLS or socket failure. `cause` holds the original error. */
export class ConnectionError extends YollaVoiceError {
  override name = "ConnectionError";

  constructor(message: string, init: { cause: unknown }) {
    super(message, { code: "connection_error", cause: init.cause });
  }
}

/** No response arrived within `timeoutMs`. */
export class TimeoutError extends YollaVoiceError {
  override name = "TimeoutError";

  constructor(message: string) {
    super(message, { code: "timeout" });
  }
}

export type WebhookVerificationReason =
  | "missing_header"
  | "bad_signature"
  | "stale_timestamp"
  | "invalid_payload";

/** A webhook request failed verification. The message never contains the secret or signature. */
export class WebhookVerificationError extends YollaVoiceError {
  override name = "WebhookVerificationError";
  readonly reason: WebhookVerificationReason;

  constructor(reason: WebhookVerificationReason, message: string) {
    super(message, { code: reason });
    this.reason = reason;
  }
}

/**
 * Parses a `Retry-After` header (delay in seconds or an HTTP date) into milliseconds.
 * Returns undefined when the header is absent or unreadable.
 */
export function parseRetryAfter(headers: Headers): number | undefined {
  const value = headers.get("retry-after")?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}

function readErrorBody(
  body: unknown,
): { code: string; message: string; requestId?: string } | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  const { code, message, requestId } = error as Record<string, unknown>;
  if (typeof code !== "string" || typeof message !== "string") return undefined;
  return typeof requestId === "string" ? { code, message, requestId } : { code, message };
}

/** Builds the typed error for a non-2xx response. */
export function errorFromResponse(
  status: number,
  body: unknown,
  headers: Headers,
): YollaVoiceError {
  const parsed = readErrorBody(body);
  const message = parsed?.message ?? `HTTP ${status}`;
  const init: YollaVoiceErrorInit = {
    status,
    code: parsed?.code ?? "unknown_error",
    requestId: parsed?.requestId ?? headers.get("x-request-id") ?? undefined,
  };
  switch (status) {
    case 400:
    case 422:
      return new ValidationError(message, init);
    case 401:
      return new AuthenticationError(message, init);
    case 402:
      return new InsufficientBalanceError(message, init);
    case 403:
      return new PermissionError(message, init);
    case 404:
      return new NotFoundError(message, init);
    case 409:
      return new ConflictError(message, init);
    case 429:
      return new RateLimitError(message, { ...init, retryAfterMs: parseRetryAfter(headers) });
    default:
      if (status >= 500) return new ServerError(message, init);
      return new YollaVoiceError(message, init);
  }
}
