// app/api/webhooks/yolla/route.ts
import { createWebhookHandler } from "@yolla-io/yolla-voice-nodejs";

const handler = createWebhookHandler({
  secret: process.env.YOLLA_WEBHOOK_SECRET ?? "",
  on: {
    "call.completed": async (event) => {
      console.log(event.data.call.id, event.data.call.endReason);
    },
  },
});

export const POST = handler.fetch;
