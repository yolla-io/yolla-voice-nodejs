import type { HttpClient, RequestOptions } from "../http.js";
import type { NumberPrice } from "../types.js";

export class Pricing {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  getNumberPrice(number: string, opts?: RequestOptions): Promise<NumberPrice> {
    const path = `/v1/pricing/numbers/${encodeURIComponent(number)}`;
    return this.#http.json<NumberPrice>({ method: "GET", path, retryable: true }, opts);
  }
}
