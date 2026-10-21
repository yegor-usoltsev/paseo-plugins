# paseo-resume

SDK versions are pinned together in `package.json`. Native agent messages provide sender identity. The scoped startup connection uses Node's built-in WebSocket and supports TCP listeners. Server scheduling constraints are in `server/AGENTS.md`.

Lifecycle tests isolate `PASEO_HOME` and `XDG_STATE_HOME`, fake time and SDK operations, and never send live agent messages. Client controls poll pending jobs directly, including their workspace IDs; avoid subscribing to the whole agent directory. Stale actions carry their displayed job ID and cannot change a replacement job. Failed queries keep the last confirmed schedule and disable actions until a fresh query succeeds.
