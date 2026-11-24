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
    const respond = (status: Status) => {
      const { headers, body } = answer(status);
      return new Response(body, { status, headers });
    };
    if (request.method !== "POST") return respond(405);
    if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return respond(413);
    let body: Buffer | undefined;
    try {
      body = request.body ? await readCapped(request.body) : Buffer.alloc(0);
    } catch (err) {
      report(err);
      return respond(500);
    }
    if (!body) return respond(413);
    return respond((await handle(body, request.headers)).status);
  }

  async function nodeAdapter(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const respond = (status: Status) => {
      const { headers, body } = answer(status);
      res.writeHead(status, headers).end(body);
    };
    if (req.method !== "POST") {
      req.resume();
      return respond(405);
    }
    if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) {
      req.resume();
      return respond(413);
    }

    const parsed = (req as IncomingMessage & { body?: unknown }).body;
    let body: string | Uint8Array | undefined;
    if (parsed === undefined) {
      try {
        // On overflow keep the request alive: the rest is drained below, then the 413 is sent.
        // Destroying it would reset the socket and the client would not see the answer.
        body = await readCapped(req.iterator({ destroyOnReturn: false }));
      } catch (err) {
        report(err);
        return respond(500);
      }
    } else if (typeof parsed === "string" || parsed instanceof Uint8Array) {
      body = Buffer.byteLength(parsed) > MAX_BODY_BYTES ? undefined : parsed;
    } else {
      report(new TypeError(NOT_RAW));
      return respond(500);
    }
    if (body === undefined) {
      req.resume();
      return respond(413);
    }
    respond((await handle(body, req.headers)).status);
  }

  return { handle, node: nodeAdapter, fetch: fetchAdapter };
}

/** The response of the adapters for a status; each adapter only renders it. */
function answer(status: Status): { headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (status === 405) headers.allow = "POST";
  return { headers, body: BODIES[status] };
}

/**
 * Reads a body stream into one Buffer and stops at `MAX_BODY_BYTES`: returns undefined when the
 * body is larger. Leaving the loop early calls the iterator's `return`, which cancels a Fetch
 * stream.
 */
async function readCapped(source: AsyncIterable<Uint8Array | string>): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    const buf =
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    size += buf.length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(buf);
  }
  return Buffer.concat(chunks, size);
}
