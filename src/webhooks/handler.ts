import type { IncomingMessage, ServerResponse } from "node:http";
import { WebhookVerificationError } from "../errors.js";
import type { WebhookEvent, WebhookEventOf, WebhookEventType } from "./events.js";
import type { HeadersLike } from "./headers.js";
import { verifyWebhook } from "./verify.js";

/** Largest request body the adapters accept. */
const MAX_BODY_BYTES = 1024 * 1024;

export interface WebhookHandlerOptions {
  /** Webhook secret, or several during rotation. */
  secret: string | string[];
  /** Allowed distance between the timestamp header and the clock. Default 300. */
  toleranceSec?: number;
  /** Handlers by event type. */
  on: { [T in WebhookEventType]?: (event: WebhookEventOf<T>) => void | Promise<void> };
  /** Called for events without a handler, including unknown types. */
  onUnhandled?: (event: WebhookEvent) => void | Promise<void>;
  /** Called with the real error when a handler fails; the response never contains it. */
  onError?: (err: unknown) => void;
}

export interface WebhookHandler {
  /** Verifies and dispatches a request body you already read. Never throws. */
  handle(rawBody: string | Uint8Array, headers: HeadersLike): Promise<{ status: 200 | 401 | 500 }>;
  /** `(req, res)` for `http.createServer`, Express or Fastify. Needs the raw body. */
  node: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  /** `Request` to `Response` for Next.js route handlers, Hono, Bun, Deno and workers. */
  fetch: (request: Request) => Promise<Response>;
}

const BODIES = {
  200: '{"received":true}',
  401: '{"error":"invalid signature"}',
  405: '{"error":"method not allowed"}',
  413: '{"error":"payload too large"}',
  500: '{"error":"handler failed"}',
} as const;

type Status = keyof typeof BODIES;

const NOT_RAW =
  "The request body was already parsed (req.body is an object). Mount the webhook route with " +
  "express.raw({ type: 'application/json' }) before any body parser, or do not set req.body.";

/** Creates a webhook endpoint handler with adapters for Node `http` and Fetch. */
export function createWebhookHandler(opts: WebhookHandlerOptions): WebhookHandler {
  const report = (err: unknown): void => {
    try {
      opts.onError?.(err);
    } catch {
      // A failing error hook must not change the response.
    }
  };

  async function handle(
    rawBody: string | Uint8Array,
    headers: HeadersLike,
  ): Promise<{ status: 200 | 401 | 500 }> {
    let event: WebhookEvent;
    try {
      event = verifyWebhook(rawBody, headers, {
        secret: opts.secret,
        ...(opts.toleranceSec !== undefined && { toleranceSec: opts.toleranceSec }),
      });
    } catch (err) {
      if (err instanceof WebhookVerificationError) return { status: 401 };
      report(err);
      return { status: 500 };
    }
    try {
      const fn = (opts.on as Record<string, ((e: WebhookEvent) => unknown) | undefined>)[
        event.type
      ];
      if (fn) await fn(event);
      else await opts.onUnhandled?.(event);
    } catch (err) {
      report(err);
      return { status: 500 };
    }
    return { status: 200 };
  }

  async function fetchAdapter(request: Request): Promise<Response> {
    const respond = (status: Status) =>
      new Response(BODIES[status], {
        status,
        headers: { "content-type": "application/json", ...(status === 405 && { allow: "POST" }) },
      });
    if (request.method !== "POST") return respond(405);
    const declared = Number(request.headers.get("content-length"));
    if (declared > MAX_BODY_BYTES) return respond(413);
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > MAX_BODY_BYTES) return respond(413);
    return respond((await handle(body, request.headers)).status);
  }

  async function nodeAdapter(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const respond = (status: Status) => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (status === 405) headers.allow = "POST";
      if (status === 413) headers.connection = "close";
      res.writeHead(status, headers).end(BODIES[status]);
    };
    if (req.method !== "POST") {
      req.resume();
      return respond(405);
    }
    const declared = Number(req.headers["content-length"]);
    if (declared > MAX_BODY_BYTES) {
      req.resume();
      return respond(413);
    }

    const parsed = (req as IncomingMessage & { body?: unknown }).body;
    let body: string | Uint8Array;
    if (parsed === undefined) {
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of req) {
          const buf = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
          size += buf.length;
          if (size > MAX_BODY_BYTES) {
            req.resume();
            return respond(413);
          }
          chunks.push(buf);
        }
      } catch (err) {
        report(err);
        return respond(500);
      }
      body = Buffer.concat(chunks);
    } else if (typeof parsed === "string" || parsed instanceof Uint8Array) {
      body = parsed;
    } else {
      report(new TypeError(NOT_RAW));
      return respond(500);
    }
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return respond(413);
    respond((await handle(body, req.headers)).status);
  }

  return { handle, node: nodeAdapter, fetch: fetchAdapter };
}
