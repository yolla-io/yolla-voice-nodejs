import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type AddressInfo, connect } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebhookHandler } from "../../src/webhooks/handler.js";
import { signWebhook } from "../../src/webhooks/sign.js";

const secret = "whsec_test";
const completed = { id: "evt_1", type: "call.completed", data: { callId: "c1" } };
let server: Server | undefined;

afterEach(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
  server = undefined;
});

async function serve(run: (req: IncomingMessage, res: ServerResponse) => unknown): Promise<string> {
  const created = createServer((req, res) => {
    void run(req, res);
  });
  server = created;
  await new Promise<void>((resolve) => created.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(created.address() as AddressInfo).port}/`;
}

function send(url: string, payload: object | string = completed, method = "POST") {
  const signed = signWebhook(payload, { secret });
  return fetch(url, {
    method,
    headers: signed.headers,
    ...(method === "POST" && { body: signed.body }),
  });
}

describe("createWebhookHandler node adapter", () => {
  it("verifies a raw stream body", async () => {
    const onCompleted = vi.fn();
    const handler = createWebhookHandler({ secret, on: { "call.completed": onCompleted } });
    const url = await serve(handler.node);
    const res = await send(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).toBe('{"received":true}');
    expect(onCompleted).toHaveBeenCalledWith(completed);
  });

  it("uses a Buffer req.body instead of the stream", async () => {
    const handler = createWebhookHandler({ secret, on: {} });
    const url = await serve((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        (req as IncomingMessage & { body?: unknown }).body = Buffer.concat(chunks);
        void handler.node(req, res);
      });
    });
    expect((await send(url)).status).toBe(200);
  });

  it("uses a string req.body as is", async () => {
    const handler = createWebhookHandler({ secret, on: {} });
    const url = await serve((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        (req as IncomingMessage & { body?: unknown }).body = Buffer.concat(chunks).toString();
        void handler.node(req, res);
      });
    });
    expect((await send(url)).status).toBe(200);
  });

  it("answers 500 and reports a TypeError naming express.raw for a parsed object body", async () => {
    const onError = vi.fn();
    const handler = createWebhookHandler({ secret, on: {}, onError });
    const url = await serve((req, res) => {
      (req as IncomingMessage & { body?: unknown }).body = completed;
      return handler.node(req, res);
    });
    const res = await send(url);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"handler failed"}');
    const err = onError.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(TypeError);
    expect((err as TypeError).message).toContain("express.raw");
  });

  it("answers 401 on a bad signature", async () => {
    const handler = createWebhookHandler({ secret: "other", on: {} });
    const url = await serve(handler.node);
    const res = await send(url);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('{"error":"invalid signature"}');
  });

  it("answers 405 to a non-POST request", async () => {
    const handler = createWebhookHandler({ secret, on: {} });
    const url = await serve(handler.node);
    const res = await send(url, completed, "GET");
    expect(res.status).toBe(405);
    expect(await res.text()).toBe('{"error":"method not allowed"}');
  });

  it("answers 413 for a body over 1 MiB without calling handlers", async () => {
    const onUnhandled = vi.fn();
    const handler = createWebhookHandler({ secret, on: {}, onUnhandled });
    const url = await serve(handler.node);
    const res = await send(url, JSON.stringify({ ...completed, pad: "x".repeat(1024 * 1024 + 1) }));
    expect(res.status).toBe(413);
    expect(await res.text()).toBe('{"error":"payload too large"}');
    expect(onUnhandled).not.toHaveBeenCalled();
  });

  it("answers 413 to a chunked body over 1 MiB without content-length", async () => {
    const onUnhandled = vi.fn();
    const handler = createWebhookHandler({ secret, on: {}, onUnhandled });
    const { port } = new URL(await serve(handler.node));
    // A raw socket: the server answers before the body ends, and Node's http client drops such
    // an early response when its own write then fails.
    const raw = await new Promise<string>((resolve) => {
      const socket = connect(Number(port), "127.0.0.1");
      let received = "";
      socket.setEncoding("utf8");
      socket.on("data", (c: string) => {
        received += c;
      });
      socket.on("error", () => {});
      socket.on("close", () => resolve(received));
      socket.write("POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n");
      const chunk = `10000\r\n${"x".repeat(0x10000)}\r\n`;
      let sent = 0;
      const write = () => {
        while (sent < 40 && !socket.destroyed) {
          sent++;
          if (!socket.write(chunk)) return void socket.once("drain", write);
        }
        if (!socket.destroyed) socket.end("0\r\n\r\n");
      };
      write();
    });
    expect(raw).toMatch(/^HTTP\/1\.1 413 /);
    expect(raw).toContain('{"error":"payload too large"}');
    expect(onUnhandled).not.toHaveBeenCalled();
  });
});
