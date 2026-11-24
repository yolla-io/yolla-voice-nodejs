/** A webhook secret, or several during rotation. */
export type WebhookSecret = string | string[];

/**
 * Returns the webhook secrets to check against. An undefined, empty string or empty list falls
 * back to YOLLA_WEBHOOK_SECRET. Throws when there is no secret, or when a list holds an empty one.
 */
export function resolveWebhookSecret(secret: WebhookSecret | undefined): string[] {
  const given = typeof secret === "string" ? [secret] : (secret ?? []);
  if (given.length === 0 || (given.length === 1 && given[0] === "")) {
    const env = process.env.YOLLA_WEBHOOK_SECRET;
    if (!env) throw new Error("Missing webhook secret: pass secret or set YOLLA_WEBHOOK_SECRET");
    return [env];
  }
  if (given.some((s) => typeof s !== "string" || s === "")) {
    throw new TypeError("Webhook secret must be a non-empty string or a list of them");
  }
  return given;
}
