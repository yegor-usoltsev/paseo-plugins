# Obtain the SDK before the first agent event after plugin reload

`index.server.ts` obtains its SDK handle only from `agent.create`, `agent.turn_started` and `agent.turn_ended` hook contexts. A socket request received immediately after reload, before any of those events, returns `paseo-peer is still starting; retry in a moment.` The plugin is already running, and waiting alone does not initialize it.

Verified on the live daemon after a plugin-only reload: the handoff message to the existing Claude peer failed with that response. It was not delivered.

Open decision: use an SDK-on-start API if Paseo exposes one, or establish a separate SDK connection on startup. Adding private daemon connection/authentication code solely to avoid this warm-up window needs a deliberate choice. Until then the caller can retry after the next lifecycle event.
