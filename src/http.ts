import {
  ConnectionError,
  errorFromResponse,
  parseRetryAfter,
  TimeoutError,
  YollaVoiceError,
} from "./errors.js";
import { VERSION } from "./version.js";

/** Per-call overrides of the client settings. */
export interface RequestOptions {
  maxRetries?: number | undefined;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface HttpClientConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetch: typeof fetch;
}

export interface HttpRequest {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Whether the request may be sent again after a 429, 5xx, network error or timeout. */
  retryable: boolean;
}

export interface HttpResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

const MAX_BACKOFF_MS = 8000;
const BASE_BACKOFF_MS = 500;
const MAX_RETRY_AFTER_MS = 60_000;

/** The outcome of one attempt: a response under 400, or an error and whether to retry it. */
type Attempt =
  | { res: HttpResponse<unknown> }
  | { error: YollaVoiceError; retry: false }
  | { error: YollaVoiceError; retry: true; retryAfterMs?: number | undefined };

export class HttpClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #fetch: typeof fetch;

  constructor(cfg: HttpClientConfig) {
    this.#apiKey = cfg.apiKey;
    this.#baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.#timeoutMs = checkTimeout(cfg.timeoutMs);
    this.#maxRetries = checkRetries(cfg.maxRetries);
    this.#fetch = cfg.fetch;
  }

  /** Sends a request and returns the parsed body. */
  async json<T>(req: HttpRequest, opts?: RequestOptions): Promise<T> {
    return (await this.request<T>(req, opts)).data;
  }

  /** Sends a request with retries; throws the typed error of the last attempt. */
  async request<T>(req: HttpRequest, opts: RequestOptions = {}): Promise<HttpResponse<T>> {
    const maxRetries = checkRetries(opts.maxRetries ?? this.#maxRetries);
    const timeoutMs = checkTimeout(opts.timeoutMs ?? this.#timeoutMs);
    const retries = req.retryable ? maxRetries : 0;
    const url = this.#url(req);
    const init = this.#init(req);

    for (let attempt = 0; ; attempt++) {
      opts.signal?.throwIfAborted();
      const result = await this.#attempt(url, init, timeoutMs, opts.signal);
      if ("res" in result) return result.res as HttpResponse<T>;
      if (!result.retry || attempt >= retries) throw result.error;
      await sleep(result.retryAfterMs ?? backoff(attempt), opts.signal);
    }
  }

  async #attempt(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    callerSignal: AbortSignal | undefined,
  ): Promise<Attempt> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
    let res: Response;
    let data: unknown;
    try {
      res = await this.#fetch(url, { ...init, signal });
      data = await readBody(res);
    } catch (err) {
      if (callerSignal?.aborted) throw callerSignal.reason;
      if (timeoutSignal.aborted) {
        return { error: new TimeoutError(`Request timed out after ${timeoutMs} ms`), retry: true };
      }
      if (err instanceof YollaVoiceError) return { error: err, retry: false };
      const error = new ConnectionError("Connection to the Yolla Voice API failed", { cause: err });
      return { error, retry: true };
    }
    if (res.status < 400) return { res: { data, status: res.status, headers: res.headers } };
    const error = errorFromResponse(res.status, data, res.headers);
    if (!isRetryableStatus(res.status)) return { error, retry: false };
    const retryAfter = parseRetryAfter(res.headers);
    return {
      error,
      retry: true,
      retryAfterMs: retryAfter === undefined ? undefined : Math.min(MAX_RETRY_AFTER_MS, retryAfter),
    };
  }

  #url(req: HttpRequest): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query ?? {})) {
      if (value !== undefined) params.append(key, String(value));
    }
    const qs = params.toString();
    return `${this.#baseUrl}${req.path}${qs ? `?${qs}` : ""}`;
  }

  #init(req: HttpRequest): RequestInit {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      "User-Agent": `yolla-voice-nodejs/${VERSION} node/${process.versions.node}`,
      Accept: "application/json",
      ...req.headers,
    };
    const init: RequestInit = { method: req.method, headers };
    if (req.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(req.body);
    }
    return init;
  }
}

function checkRetries(n: number): number {
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError("maxRetries must be an integer, 0 or more");
  return n;
}

function checkTimeout(n: number): number {
  if (!Number.isFinite(n) || n <= 0) {
    throw new RangeError("timeoutMs must be a finite number greater than 0");
  }
  return n;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Full-jitter exponential backoff. */
function backoff(attempt: number): number {
  return Math.random() * Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
}

/** Reads a JSON body; a non-JSON or empty body gives undefined. */
async function readBody(res: Response): Promise<unknown> {
  const type = res.headers.get("content-type") ?? "";
  if (!/[/+]json\b/i.test(type)) {
    await res.body?.cancel();
    return undefined;
  }
  const text = await res.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    if (res.status >= 400) return undefined;
    throw new YollaVoiceError(`Invalid JSON in the response (HTTP ${res.status})`, {
      status: res.status,
      code: "invalid_response",
      requestId: res.headers.get("x-request-id") ?? undefined,
    });
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
