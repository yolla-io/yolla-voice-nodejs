import { randomUUID } from "node:crypto";
import type { HttpClient, RequestOptions } from "../http.js";
import { type CallPagePromise, listCallPages } from "../pagination.js";
import type {
  Call,
  CallList,
  CreateCallParams,
  CreateCallResponse,
  ListCallsParams,
} from "../types.js";

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export interface CreateCallOptions extends RequestOptions {
  /** Defaults to a random UUID, which stays the same across the SDK's own retries. */
  idempotencyKey?: string | undefined;
}

export interface CreateCallResult {
  call: CreateCallResponse;
  /** True when the API answered 200: the same idempotency key had already created this call. */
  replayed: boolean;
}

export class Calls {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  async create(params: CreateCallParams, opts: CreateCallOptions = {}): Promise<CreateCallResult> {
    const { idempotencyKey = randomUUID(), ...requestOpts } = opts;
    if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new RangeError(
        `idempotencyKey must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
      );
    }
    const res = await this.#http.request<CreateCallResponse>(
      {
        method: "POST",
        path: "/v1/calls",
        body: params,
        headers: { "Idempotency-Key": idempotencyKey },
        retryable: true,
      },
      requestOpts,
    );
    return { call: res.data, replayed: res.status === 200 };
  }

  list(params: ListCallsParams = {}, opts: RequestOptions = {}): CallPagePromise {
    return listCallPages((cursor) =>
      this.#http.json<CallList>(
        {
          method: "GET",
          path: "/v1/calls",
          query: { ...params, ...(cursor === undefined ? {} : { cursor }) },
          retryable: true,
        },
        opts,
      ),
    );
  }

  get(callId: string, opts?: RequestOptions): Promise<Call> {
    return this.#http.json<Call>({ method: "GET", path: path(callId), retryable: true }, opts);
  }

  end(callId: string, opts?: RequestOptions): Promise<Call> {
    return this.#action(callId, "end", opts);
  }

  hold(callId: string, opts?: RequestOptions): Promise<Call> {
    return this.#action(callId, "hold", opts);
  }

  unhold(callId: string, opts?: RequestOptions): Promise<Call> {
    return this.#action(callId, "unhold", opts);
  }

  #action(callId: string, action: string, opts?: RequestOptions): Promise<Call> {
    const req = { method: "POST", path: `${path(callId)}/${action}`, retryable: true } as const;
    return this.#http.json<Call>(req, opts);
  }
}

function path(callId: string): string {
  return `/v1/calls/${encodeURIComponent(callId)}`;
}
