# Resume may wait for a feature or model quota that does not limit the agent

`retryTimeFromUsage` in `resume/server/limit.ts` takes the latest reset among all exhausted windows. Paseo 0.11's Codex usage source adds `additional_rate_limits` as scoped windows (IDs such as `limit:<feature>`), alongside the existing `code_review` windows; only the main rate limit is marked `summary: true`. An exhausted model-specific or code-review window can therefore push the resume hours past the reset of the limit that actually stopped the agent.

Evidence: upstream `plugins/codex-usage-source/server/usage.ts` (v0.11.1, lines 217-233); a fixture with a generic reset at 13:00 and an exhausted feature window at 18:00 yields 18:00. Not observed on a live account.

Open decision: which windows apply to an agent. A conservative option ignores scoped windows and lets the message reset or the estimate decide.
