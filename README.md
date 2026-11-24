# @yolla-io/yolla-voice-nodejs

Node.js server SDK for the Yolla Voice Reseller API: create and manage calls, read the balance and
number prices, and receive signed webhooks. TypeScript types included, no runtime dependencies.

> Pre-release (0.x). The API contract is still a draft, so minor versions may change the API.

## Installation

```sh
npm install @yolla-io/yolla-voice-nodejs
```

## Quick start

```ts
import { YollaVoice } from "@yolla-io/yolla-voice-nodejs";

const yolla = new YollaVoice({
  apiKey: process.env.YOLLA_API_KEY,
  baseUrl: process.env.YOLLA_BASE_URL,
});

const { call } = await yolla.calls.create({
  to: "+14155550100",
  externalUserId: "user-42",
});

// Pass call.callToken to your mobile app. The app uses it to start the call.
console.log(call.id, call.callToken, call.expiresAt);
```

## Configuration

```ts
const yolla = new YollaVoice({ apiKey, baseUrl, timeoutMs: 10_000, maxRetries: 3 });
```

| Option          | Environment variable   | Default | Description                                         |
| --------------- | ---------------------- | ------- | --------------------------------------------------- |
| `apiKey`        | `YOLLA_API_KEY`        | none    | Reseller API key. Required.                         |
| `baseUrl`       | `YOLLA_BASE_URL`       | none    | API base URL. Required.                             |
| `webhookSecret` | `YOLLA_WEBHOOK_SECRET` | none    | Signing secret, or an array during rotation.        |
| `timeoutMs`     |                        | `30000` | Timeout of one attempt.                             |
| `maxRetries`    |                        | `2`     | Retries after a 429, 5xx, network error or timeout. |
| `fetch`         |                        | global  | Custom `fetch`, for proxies or tests.               |

The constructor throws when the API key or base URL is missing. The API key never appears in error
messages, `JSON.stringify` or `util.inspect` output of the client or of any error.

Every method takes optional per-call `{ timeoutMs, maxRetries, signal }`:

```ts
await yolla.balance.get({ signal: AbortSignal.timeout(5_000), maxRetries: 0 });
```

## Calls

```ts
// Create. The result says whether the call already existed for this idempotency key.
const { call, replayed } = await yolla.calls.create(
  {
    to: "+14155550100",
    from: "+14155550199", // optional caller id
    externalUserId: "user-42",
    customParams: { orderId: "A-1001" },
    maxDuration: 600, // seconds, optional
  },
  { idempotencyKey: "order-A-1001" }, // optional, a random UUID by default
);

const current = await yolla.calls.get(call.id);
await yolla.calls.hold(call.id);
await yolla.calls.unhold(call.id);
const ended = await yolla.calls.end(call.id);

// Balance and prices
const balance = await yolla.balance.get(); // { billingMode, balance, creditLimit, available }
const price = await yolla.pricing.getNumberPrice("+14155550100"); // { number, country, rate }
```

## Pagination

`calls.list` returns a promise of the first page that is also async-iterable over every call of
every page. The first request starts when you call it; later pages are fetched as you iterate.

```ts
// Every call, fetching the next page only when needed
for await (const call of yolla.calls.list({ status: "completed", limit: 100 })) {
  console.log(call.id, call.duration);
}

// Page by page
let page = await yolla.calls.list({ externalUserId: "user-42" });
while (true) {
  console.log(page.items.length);
  if (!page.hasNextPage()) break;
  page = await page.nextPage();
}
```

Filters: `status`, `externalUserId`, `from`, `to`, `limit`, `cursor`.

## Errors

All errors extend `YollaVoiceError` and carry `status`, `code` and `requestId`. Quote the
`requestId` in support requests.

| Class                      | When                                                    |
| -------------------------- | ------------------------------------------------------- |
| `ValidationError`          | 400, 422: malformed request or invalid parameters       |
| `AuthenticationError`      | 401: missing or invalid API key                         |
| `InsufficientBalanceError` | 402: not enough balance                                 |
| `PermissionError`          | 403: blocked reseller, user, destination or caller id   |
| `NotFoundError`            | 404: call not found                                     |
| `ConflictError`            | 409: idempotency conflict or wrong call state           |
| `RateLimitError`           | 429: rate limit or concurrent calls; has `retryAfterMs` |
| `ServerError`              | 5xx                                                     |
| `ConnectionError`          | no response (DNS, TCP, TLS); the original is in `cause` |
| `TimeoutError`             | no response within `timeoutMs`                          |
| `WebhookVerificationError` | webhook failed verification; has `reason`               |

Branch on the class, then on `code` for the exact reason:

```ts
import { ConflictError, PermissionError, YollaVoiceError } from "@yolla-io/yolla-voice-nodejs";

try {
  await yolla.calls.create({ to, externalUserId });
} catch (err) {
  if (err instanceof PermissionError && err.code === "destination_blocked") {
    // tell the user this destination is not available
  } else if (err instanceof ConflictError && err.code === "idempotency_conflict") {
    // the same idempotency key was used with different parameters
  } else if (err instanceof YollaVoiceError) {
    console.error(err.status, err.code, err.requestId);
  } else {
    throw err;
  }
}
```

## Retries and idempotency

The SDK retries a 429, a 5xx, a network error and a timeout, up to `maxRetries` times, with
exponential backoff and jitter. It honors `Retry-After`. Other 4xx answers are never retried. When
the retries run out, the thrown error is the one from the last attempt, with its `requestId`. An
aborted `signal` stops the SDK at once, also during a backoff pause.

`calls.create` sends an `Idempotency-Key` header. The SDK generates one per call and reuses it on its
own retries, so a retried create never starts a second call. To make your own retries safe too, pass
the same `idempotencyKey` (for example, your order id):

```ts
const { call, replayed } = await yolla.calls.create(params, { idempotencyKey: "order-A-1001" });
if (replayed) {
  // The call was created by an earlier request with this key.
  // call.callToken may be spent or expired: check call.expiresAt and create a new call if needed.
}
```

`hold`, `unhold` and `end` are retried too. If the first attempt reached the API but the response
was lost, the retry can answer `409 invalid_call_state` (for example, a second `hold`). Treat it as
"already done" after reading the call with `calls.get`.

## Webhooks

The platform sends events to your endpoint as `POST` with a JSON body and these headers:

| Header                | Value                                                                  |
| --------------------- | ---------------------------------------------------------------------- |
| `X-Voice-Timestamp`   | Unix time in seconds                                                   |
| `X-Voice-Signature`   | `v1=` plus hex HMAC-SHA256 of `<timestamp>.<raw body>` with the secret |
| `X-Voice-Delivery-Id` | Id of this delivery attempt                                            |

Verification needs the raw body, exactly as received. Do not parse it first.

### Express

```ts
import { createWebhookHandler } from "@yolla-io/yolla-voice-nodejs";
import express from "express";

const handler = createWebhookHandler({
  secret: process.env.YOLLA_WEBHOOK_SECRET,
  on: {
    "call.completed": async (event) => {
      console.log(event.data.call.id, event.data.call.billedDuration);
    },
    "balance.low": (event) => console.log(event.data.available.amount),
  },
  onUnhandled: (event) => console.log("ignored", event.type),
  onError: (err) => console.error(err),
});

const app = express();
app.post("/webhooks/yolla", express.raw({ type: "application/json" }), handler.node);
```

Mount `express.raw` on this route and keep `express.json()` away from it. If the body is already
parsed, the handler answers 500 and passes `onError` a `TypeError` that names `express.raw`.
`handler.node` also works with `http.createServer` and Fastify (with a raw body parser).

### Next.js and other Fetch runtimes

```ts
// app/api/webhooks/yolla/route.ts
import { createWebhookHandler } from "@yolla-io/yolla-voice-nodejs";

const handler = createWebhookHandler({
  secret: process.env.YOLLA_WEBHOOK_SECRET,
  on: { "call.completed": async (event) => console.log(event.data.call.id) },
});

export const POST = handler.fetch;
```

`handler.fetch` maps `Request` to `Response`, so it also fits Hono, Bun, Deno and workers. If you
already created a client with a `webhookSecret`, use `yolla.webhooks.createHandler({ on })`.

The handler answers `200 {"received":true}`, `401` for a bad signature or timestamp, `500` when
your handler throws (the error goes to `onError`, never into the response), `405` for non-POST
requests and `413` for a body over 1 MiB.

### Verifying yourself

```ts
import { WebhookVerificationError } from "@yolla-io/yolla-voice-nodejs";

try {
  const event = yolla.webhooks.verify(rawBody, request.headers); // string, Buffer or Uint8Array
  switch (event.type) {
    case "call.completed":
      console.log(event.data.call.endReason);
      break;
    case "call.quality":
      console.log(event.data.quality.mosEstimate);
      break;
    default:
      // Event types added later arrive here. Their data is typed `never` on purpose;
      // read it with `event.data as unknown`.
      break;
  }
} catch (err) {
  if (err instanceof WebhookVerificationError) {
    // err.reason: "missing_header" | "bad_signature" | "stale_timestamp" | "invalid_payload"
  }
}
```

`verifyWebhook(rawBody, headers, { secret })` does the same without a client. Headers can be a
`Headers` object or a Node header map, in any case. The timestamp must be within 5 minutes of your
clock (`toleranceSec`, default 300).

### Events

`call.initiated`, `call.answered`, `call.held`, `call.unheld`, `call.hold_failed`, `call.completed`,
`call.expired`, `call.quality`, `balance.low`, `webhook.test`.

Every event has `id`, `type`, `seq`, `createdAt` and `data`.

- **Retries and duplicates.** The platform retries a delivery when your endpoint answers non-2xx or
  does not answer. `event.id` is the same across attempts, and `X-Voice-Delivery-Id` is new for
  each attempt. Deduplicate by `event.id`.
- **Order.** Deliveries can arrive out of order. For `call.*` events with `data.call`, `seq` orders
  the events of one call: apply the event only if its `seq` is greater than the last one you stored.
  `seq` is 0 for `call.quality`, `balance.low` and `webhook.test`.
- **Answer fast.** Store the event and answer 200, then do slow work in a queue.
- **Secret rotation.** Rotate the secret in the dashboard. The new secret works immediately. During
  your own switch, pass both: `secret: [newSecret, oldSecret]`. A signature matching any of them is
  accepted. Remove the old one when done.

## Testing webhooks

In the dashboard, open Integration and press "Send test event". It sends a `webhook.test` event to
your endpoint.

In unit tests, sign a payload the way the platform does:

```ts
import { createWebhookHandler, signWebhook } from "@yolla-io/yolla-voice-nodejs";

const secret = "whsec_test";
const handler = createWebhookHandler({ secret, on: { "webhook.test": () => {} } });

const { body, headers } = signWebhook(
  { id: "evt_1", type: "webhook.test", seq: 0, createdAt: new Date().toISOString(), data: {} },
  { secret },
);

const res = await handler.fetch(
  new Request("https://example.test/hook", { method: "POST", headers, body }),
);
console.log(res.status); // 200
```

With a client, `yolla.webhooks.sign(payload)` signs with the client secret.

## Requirements

- Node.js 20.19 or newer. The SDK uses the global `fetch`.
- The package is ESM. On Node 20.19+ you can also `require()` it from CommonJS.
- Server-side only. The API key can start calls and spend money: never ship it to a browser or a
  mobile app. Give the app only the `callToken` of a call.

## Versioning

The package follows semantic versioning. While the API contract is a draft, versions are 0.x and
a minor release may include breaking changes. They are listed in [CHANGELOG.md](CHANGELOG.md).

## License

MIT
