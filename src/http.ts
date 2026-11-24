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
  maxRetries?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
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

export class HttpClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #fetch: typeof fetch;

  constructor(cfg: HttpClientConfig) {
    this.#apiKey = cfg.apiKey;
    this.#baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.#timeoutMs = cfg.timeoutMs;
    this.#maxRetries = cfg.maxRetries;
    this.#fetch = cfg.fetch;
  }

  async request<T>(req: HttpRequest, opts: RequestOptions = {}): Promise<HttpResponse<T>> {
    const maxRetries = req.retryable ? (opts.maxRetries ?? this.#maxRetries) : 0;
    const timeoutMs = opts.timeoutMs ?? this.#timeoutMs;
    const url = this.#url(req);
    const init = this.#init(req);

    for (let attempt = 0; ; attempt++) {
      opts.signal?.throwIfAborted();
      let error: YollaVoiceError;
      let retryAfterMs: number | undefined;
      try {
        const res = await this.#attempt(url, init, timeoutMs, opts.signal);
        if (res.status < 400) return res as HttpResponse<T>;
        error = errorFromResponse(res.status, res.data, res.headers);
        if (!isRetryableStatus(res.status)) throw error;
        const retryAfter = parseRetryAfter(res.headers);
        if (retryAfter !== undefined) retryAfterMs = Math.min(MAX_RETRY_AFTER_MS, retryAfter);
      } catch (err) {
        if (!(err instanceof ConnectionError || err instanceof TimeoutError)) throw err;
        error = err;
      }
      if (attempt >= maxRetries) throw error;
      await sleep(retryAfterMs ?? backoff(attempt), opts.signal);
    }
  }

  async #attempt(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    callerSignal: AbortSignal | undefined,
  ): Promise<HttpResponse<unknown>> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
    try {
      const res = await this.#fetch(url, { ...init, signal });
      const data = await readBody(res);
      return { data, status: res.status, headers: res.headers };
    } catch (err) {
      if (callerSignal?.aborted) throw callerSignal.reason;
      if (timeoutSignal.aborted) throw new TimeoutError(`Request timed out after ${timeoutMs} ms`);
      if (err instanceof YollaVoiceError) throw err;
      throw new ConnectionError("Connection to the Yolla Voice API failed", { cause: err });
    }
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
