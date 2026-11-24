import { createWebhookHandler } from "@yolla-io/yolla-voice-nodejs";
import express from "express";

const handler = createWebhookHandler({
  secret: process.env.YOLLA_WEBHOOK_SECRET,
  on: {
    "call.completed": async (event) => {
      console.log(event.data.call.id, event.data.call.billedDuration);
    },
    "balance.low": (event) => {
      console.log("Low balance", event.data.available.amount);
    },
  },
  onError: (err) => console.error("webhook handler failed", err),
});

const app = express();
// The raw body is needed for the signature: do not put express.json() before this route.
app.post("/webhooks/yolla", express.raw({ type: "application/json" }), handler.node);
app.listen(3000);
