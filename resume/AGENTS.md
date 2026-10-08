# paseo-resume

The installed SDK is 0.10.3. The daemon accepts `activeTurnBehavior: "steer"`, but the SDK's send-options type omits it; preserve the explicit cast. Plugin SDK access comes from hook contexts; before the first context, restored jobs use their own authenticated local SDK connection and always steer. Never reintroduce plain CLI send: it can interrupt a turn that starts after inspection.

Startup connections discover only `$PASEO_HOME/paseo.pid` and read that home’s local credential through the SDK auth callback. Never fall back to a default port or a shell CLI. Connection failures retain jobs and retry in five minutes. Only the host-provided SDK can append plugin timeline rows.

Provider usage is the primary reset source. Paseo 0.10.3 caches it for five minutes and the public SDK cannot force a refresh, so estimated jobs recheck after cache expiry. Since Paseo 0.11 the usage list has one entry per discovered account under the same provider ID, and the public SDK cannot tell which account an agent uses: treat several entries as no usage. When windows carry `summary` flags, only summary windows bound every agent; model and feature quotas do not. Claude notice times carry their own IANA timezone; never interpret them in the daemon's timezone. Run limit and lifecycle tests under both `TZ=UTC` and `TZ=Europe/Minsk` after reset-time changes.

`npm test` runs TypeScript directly with Node 24. Keep `.ts` extensions on runtime imports reached by the tests. Lifecycle tests isolate `PASEO_HOME` and `XDG_STATE_HOME`, fake the clock and SDK connection, and never contact the live daemon.

Pending records survive plugin reload. Treat every await in scheduling and delivery as a cancellation boundary. A send response can arrive after the resumed turn has already ended and scheduled its next retry, so never delete a record solely by agent ID after an await.

Messages and foreign turns preserve pending resumes. A new limit episode invalidates older asynchronous work; explicit Cancel and archiving remove the job. Busy recipients defer delivery, and their turn-end event retries an overdue resume. Only the turn started by this plugin inherits its parent notification.

The agent-directory subscription defaults to 200 entries. Restore composer controls from the pending RPC and fetch missing workspace placement by agent ID. Failed queries retain the confirmed schedule but disable actions; an action requires a fresh query after any older query settles. Only a server-reported attempt for the same pending record may read "Resuming…". Actions carry the displayed job ID so stale clients cannot act on a later limit episode; retries retain that ID.
