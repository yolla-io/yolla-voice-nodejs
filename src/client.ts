import { HttpClient, type RequestOptions } from "./http.js";
import { BalanceResource } from "./resources/balance.js";
import { Calls } from "./resources/calls.js";
import { Pricing } from "./resources/pricing.js";

export type { RequestOptions };

export interface YollaVoiceOptions {
  /** Defaults to the YOLLA_API_KEY environment variable. */
  apiKey?: string;
  /** Defaults to the YOLLA_BASE_URL environment variable. */
  baseUrl?: string;
  /** Per-attempt timeout. Default 30000. */
  timeoutMs?: number;
  /** Retries after a 429, 5xx, network error or timeout. Default 2. */
  maxRetries?: number;
  fetch?: typeof fetch;
  /** Webhook signing secret (or several, during rotation). Defaults to YOLLA_WEBHOOK_SECRET. */
  webhookSecret?: string | string[];
}

export class YollaVoice {
  readonly calls: Calls;
  readonly balance: BalanceResource;
  readonly pricing: Pricing;
  readonly #webhookSecret: string | string[] | undefined;

  constructor(opts: YollaVoiceOptions = {}) {
    const apiKey = opts.apiKey || process.env.YOLLA_API_KEY;
    if (!apiKey) throw new Error("Missing API key: pass apiKey or set YOLLA_API_KEY");
    const baseUrl = opts.baseUrl || process.env.YOLLA_BASE_URL;
    if (!baseUrl) throw new Error("Missing baseUrl: pass baseUrl or set YOLLA_BASE_URL");
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const maxRetries = opts.maxRetries ?? 2;
    if (!(timeoutMs > 0)) throw new RangeError("timeoutMs must be greater than 0");
    if (!(maxRetries >= 0)) throw new RangeError("maxRetries must be 0 or greater");

    this.#webhookSecret = opts.webhookSecret || process.env.YOLLA_WEBHOOK_SECRET || undefined;
    const http = new HttpClient({
      apiKey,
      baseUrl,
      timeoutMs,
      maxRetries,
      fetch: opts.fetch ?? globalThis.fetch,
    });
    this.calls = new Calls(http);
    this.balance = new BalanceResource(http);
    this.pricing = new Pricing(http);
  }
}
