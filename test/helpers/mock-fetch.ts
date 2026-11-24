export type MockReply = Response | Error | ((init: RequestInit) => Promise<Response>);

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

export interface MockFetch {
  fetch: typeof fetch;
  calls: RecordedCall[];
}

/** A fetch stub that answers with the given replies in order and records every call. */
export function mockFetch(...replies: MockReply[]): MockFetch {
  const calls: RecordedCall[] = [];
  const fetchStub = async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const reply = replies.shift();
    if (reply === undefined) throw new Error(`mockFetch: unexpected call #${calls.length}`);
    if (reply instanceof Error) throw reply;
    if (typeof reply === "function") return reply(init);
    return reply;
  };
  return { fetch: fetchStub as typeof fetch, calls };
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(status, { error: { code, message, requestId } }, headers);
}

/** A reply that never answers; it rejects with the abort reason once the request signal aborts. */
export function hang(): (init: RequestInit) => Promise<Response> {
  return (init) =>
    new Promise((_, reject) => {
      const signal = init.signal;
      if (!signal) return;
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
}
