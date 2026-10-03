# paseo-resume

The installed SDK is 0.10.3. The daemon accepts `activeTurnBehavior: "steer"`, but the SDK's send-options type omits it; preserve the explicit cast. Plugin SDK access comes from hook contexts, so restored jobs may need the CLI before any lifecycle hook runs.

On macOS the plugin runs in `Paseo.app/Contents/Frameworks/Paseo Helper.app/Contents/MacOS/Paseo Helper`. Resolve the CLI in the main app's `Contents/Resources/bin`, not the helper's Resources directory. Do not require shell CLI registration for restored jobs.

Provider usage is the primary reset source. Paseo 0.10.3 caches it for five minutes and the public SDK cannot force a refresh, so estimated jobs recheck after cache expiry. Claude notice times carry their own IANA timezone; never interpret them in the daemon's timezone. Run limit and lifecycle tests under both `TZ=UTC` and `TZ=Europe/Minsk` after reset-time changes.

`npm test` runs TypeScript directly with Node 24. Keep `.ts` extensions on runtime imports reached by the tests. Lifecycle tests isolate `PASEO_HOME` and `XDG_STATE_HOME`, fake the clock and CLI, and never contact the live daemon.

Pending records survive plugin reload. Treat every await in scheduling and delivery as a cancellation boundary. A send response can arrive after the resumed turn has already ended and scheduled its next retry, so never delete a record solely by agent ID after an await.

The agent-directory subscription defaults to 200 entries. Restore composer controls from the pending RPC and fetch missing workspace placement by agent ID. Failed queries retain the confirmed schedule but disable actions; an action requires a fresh query after any older query settles. Only a server-reported attempt for the same pending record may read "Resuming…". Actions carry the displayed job ID so stale clients cannot act on a later limit episode; retries retain that ID.
