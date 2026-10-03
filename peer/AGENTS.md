# paseo-peer

The installed SDK is 0.10.3. The daemon accepts `activeTurnBehavior: "steer"`, but the SDK's send-options type omits it; preserve the explicit cast. Always steer, including for an idle snapshot: status can change before delivery.

In Paseo.app, `process.execPath` is Electron. Provider launch strips `ELECTRON_RUN_AS_NODE`; the injected stdio MCP server must explicitly restore it in its own environment.

`npm test` runs TypeScript directly with Node 24. Keep `.ts` extensions on runtime imports reached by the tests. Delivery tests use an in-memory SDK and never send live agent messages.

Outgoing timeline results differ by provider: Codex retains the MCP result object; Claude wraps successful text in `detail.output.output` and puts failed text in `error.content`. MCP `isError` must also be checked because a completed host tool call does not guarantee delivery.

Before the first hook after reload, peer sends use a local SDK connection scoped to `$PASEO_HOME/paseo.pid` and its local credential. Never require an agent event or mounted client to initialize delivery. Close that connection during plugin cleanup.
