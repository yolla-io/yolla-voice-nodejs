import type { components } from "../generated/openapi.js";

type Schemas = components["schemas"];
type EventEnvelope = Schemas["EventEnvelope"];

export type CallWebhookEventType = Schemas["CallEvent"]["type"];

/** Call lifecycle events: `call.initiated` … `call.expired`. */
export type CallWebhookEvent = {
  [T in CallWebhookEventType]: Omit<Schemas["CallEvent"], "type"> & { type: T };
}[CallWebhookEventType];

/** `call.quality`: the quality summary of a finished call. */
export type CallQualityEvent = Schemas["QualityEvent"];

/** `balance.low`: the balance fell below the threshold. */
export type BalanceLowEvent = Schemas["BalanceEvent"];

/** `webhook.test`: sent from the dashboard to check the endpoint; carries no call. */
export type WebhookTestEvent = Schemas["TestEvent"];

export type KnownWebhookEvent =
  | CallWebhookEvent
  | CallQualityEvent
  | BalanceLowEvent
  | WebhookTestEvent;

export type WebhookEventType = KnownWebhookEvent["type"];

/**
 * An event whose `type` this SDK version does not know yet. Handle it in the `default` branch.
 *
 * `data` is typed `never` on purpose: TypeScript cannot exclude a `type: string` member when you
 * narrow on a known type, so `never` is what keeps `event.data` exact after
 * `if (event.type === "call.completed")`. Read it with `event.data as unknown`.
 */
export interface UnknownWebhookEvent extends EventEnvelope {
  data: never;
}

export type WebhookEvent = KnownWebhookEvent | UnknownWebhookEvent;

export type WebhookEventOf<T extends WebhookEventType> = Extract<KnownWebhookEvent, { type: T }>;
