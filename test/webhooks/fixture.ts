import { readFileSync } from "node:fs";

export interface WebhookVector {
  name: string;
  body: string;
  signature: string;
}

export interface WebhookFixture {
  secret: string;
  timestamp: number;
  vectors: [WebhookVector, WebhookVector, WebhookVector];
}

export function loadFixture(): WebhookFixture {
  const url = new URL("../fixtures/webhooks.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as WebhookFixture;
}
