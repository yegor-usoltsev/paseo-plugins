# Make restart-time CLI resume delivery conditional or non-interrupting

The SDK resume path always sends with `activeTurnBehavior: "steer"`. Before any lifecycle hook has supplied an SDK context, the restart path uses `paseo send --no-wait`. It first inspects the agent and checks the cancellation generation after the await, but a new turn may still start after inspection and before the CLI request arrives.

Evidence: Paseo source at 8aec078, `packages/cli/src/commands/agent/send.ts`, `runSendCommand`, calls `client.sendAgentMessage(agentIdArg, promptInput, { images })`. `addSendOptions` exposes no steering or conditional-send flag. The default send interrupts an active turn.

Open decision: add an upstream CLI steering/conditional-send option, or replace the CLI fallback with a separately authenticated SDK connection. The latter duplicates local connection discovery and authentication currently owned by the CLI. This remaining transport race is separate from the fixed scheduling, cancellation, send-failure and record-removal races.
