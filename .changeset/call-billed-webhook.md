---
"@yolla-io/yolla-voice-nodejs": minor
---

New webhook event `call.billed`: sent once per call after `call.completed`, when the final billing record is
applied. It carries the same `data.call` snapshot, with the final `price` and `billedDuration`.
