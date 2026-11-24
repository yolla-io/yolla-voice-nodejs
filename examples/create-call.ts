import { InsufficientBalanceError, YollaVoice } from "@yolla-io/yolla-voice-nodejs";

const yolla = new YollaVoice({
  apiKey: process.env.YOLLA_API_KEY ?? "",
  baseUrl: process.env.YOLLA_BASE_URL ?? "",
});

try {
  const { call, replayed } = await yolla.calls.create({
    to: "+14155550100",
    externalUserId: "user-42",
    customParams: { orderId: "A-1001" },
  });
  console.log(call.id, call.status, replayed);
  // Hand call.callToken to your mobile app; it starts the call with it.
} catch (err) {
  if (err instanceof InsufficientBalanceError) {
    console.error("Top up the balance", err.requestId);
  } else {
    throw err;
  }
}
