import { HttpClient, type RequestOptions } from "./http.js";
import { BalanceResource } from "./resources/balance.js";
import { Calls } from "./resources/calls.js";
import { Pricing } from "./resources/pricing.js";
import { Webhooks } from "./webhooks/index.js";

export type { RequestOptions };

export interface YollaVoiceOptions {
  /** Defaults to the YOLLA_API_KEY environment variable. */
  apiKey?: string | undefined;
  /** Defaults to the YOLLA_BASE_URL environment variable. */
  baseUrl?: string | undefined;
  /** Per-attempt timeout. Default 30000. */
  timeoutMs?: number | undefined;
  /** Retries after a 429, 5xx, network error or timeout. Default 2. */
  maxRetries?: number | undefined;
  /** Custom `fetch`, for proxies or tests. Default: the global `fetch`. */
  fetch?: typeof fetch | undefined;
  /** Webhook signing secret (or several, during rotation). Defaults to YOLLA_WEBHOOK_SECRET. */
  webhookSecret?: string | string[] | undefined;
}

export class YollaVoice {
  readonly calls: Calls;
  readonly balance: BalanceResource;
  readonly pricing: Pricing;
  readonly webhooks: Webhooks;

  constructor(opts: YollaVoiceOptions = {}) {
    const apiKey = opts.apiKey || process.env.YOLLA_API_KEY;
    if (!apiKey) throw new Error("Missing API key: pass apiKey or set YOLLA_API_KEY");
    const baseUrl = opts.baseUrl || process.env.YOLLA_BASE_URL;
    if (!baseUrl) throw new Error("Missing baseUrl: pass baseUrl or set YOLLA_BASE_URL");
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const maxRetries = opts.maxRetries ?? 2;
    if (!(timeoutMs > 0)) throw new RangeError("timeoutMs must be greater than 0");
    if (!(maxRetries >= 0)) throw new RangeError("maxRetries must be 0 or greater");

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
    this.webhooks = new Webhooks(opts.webhookSecret);
  }
}
