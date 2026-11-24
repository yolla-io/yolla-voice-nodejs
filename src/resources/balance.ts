import type { HttpClient, RequestOptions } from "../http.js";
import type { Balance } from "../types.js";

export class BalanceResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  async get(opts?: RequestOptions): Promise<Balance> {
    return (
      await this.#http.request<Balance>(
        { method: "GET", path: "/v1/balance", retryable: true },
        opts,
      )
    ).data;
  }
}
