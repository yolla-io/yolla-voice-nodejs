import type { HttpClient, RequestOptions } from "../http.js";
import type { NumberPrice } from "../types.js";

export class Pricing {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  async getNumberPrice(number: string, opts?: RequestOptions): Promise<NumberPrice> {
    const res = await this.#http.request<NumberPrice>(
      { method: "GET", path: `/v1/pricing/numbers/${encodeURIComponent(number)}`, retryable: true },
      opts,
    );
    return res.data;
  }
}
