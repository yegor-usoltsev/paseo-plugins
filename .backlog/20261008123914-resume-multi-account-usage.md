# Resume picks another account's quota when a provider has several accounts

Paseo 0.11 serves `providers.listUsage()` from the usage-source registry, which returns one entry per discovered account, all with `providerId` set to the source ID (`claude`, `codex`). Account discovery now spans harness stores (Codex, OpenCode, Pi, OMP) and live agents' accounts. `resume/index.server.ts` (`schedule` and `recheckUsage`) takes the first entry with `.find()`, so a limited agent can be scheduled from a different account's exhausted window. That window also takes precedence over a correct reset time in the limit message.

Evidence: upstream `packages/server/src/server/plugins/usage-sources/index.ts` `listLegacyUsage` (v0.11.1, lines 212-232); a Codex cross-review reproduced scheduling 18:02 from account A instead of 13:02 from the limited account B. The current machine reports one account per provider, so this does not occur here yet.

Open decision: the public `PaseoApi` has no account-scoped usage read; `DaemonClient.listUsageReports({ agentId })` exists but is not exposed. Options: treat several entries for one provider as ambiguous and fall back to the message reset or estimate, or read agent-scoped reports through the plugin's own daemon connection.
