# Paseo resume

A [Paseo](https://paseo.sh) plugin that continues Claude Code and Codex agents after their provider usage limit resets. An agent that stops overnight picks up without waiting for someone to type "continue".

- **Automatic.** Reads the provider-wide reset time, then the provider's limit notice. A known reset gets two minutes of margin. If the time is unavailable, it retries in 30 minutes and rechecks usage every five minutes.
- **Controllable.** A countdown pill above the message box shows the next attempt, with Try now and Cancel this resume. Ordinary messages keep the job; busy agents wait until their turn ends. Stop does not cancel a pending job; Cancel this resume or archiving does.
- **Persistent.** Jobs survive plugin reloads and daemon restarts. Failed delivery retries in five minutes. A resumed child notifies its parent when its turn finishes, using Paseo's native sender identity.

Only provider usage-limit stops count. Authentication errors, API throttling and replies that merely discuss limits do not schedule a resume. Model-specific quotas and ambiguous multi-account usage are ignored when choosing a reset time.

## Install

Requires Paseo 0.12.0 or later, npm, and a TCP daemon listener. The default listener and the managed Tailscale configuration both work.

```sh
paseo plugin install github:yegor-usoltsev/paseo-plugins
```

The plugin works for existing and new agents. Update it with `paseo plugin update paseo-resume`.

The former `paseo-peer` plugin has been removed: Paseo 0.12 provides steering and sender identity. Use `send_agent_prompt` with `notifyOnFinish: false` for ordinary agent messages. Existing directory installations need to point at this repository's root; the dotfiles updater handles both changes.

## State and schedules

Jobs are stored per Paseo home under `$XDG_STATE_HOME/paseo-resume/`, or `~/.local/state/paseo-resume/`. Removing the plugin leaves the state files in place.

A scheduled run that archives its workspace at the end also cancels its pending resume. Recurring schedules should save progress for their next run.

## Development

```sh
npm ci
npm run lint
npm test
paseo plugin install "$PWD"
```

After source edits, run `paseo plugin reload paseo-resume`. Directory installation does not run the manifest preparation; after a lock change, prepare runtime dependencies with `npm ci --omit=dev --ignore-scripts` before loading the plugin. Restore development dependencies with `npm ci` before running checks.

## License

[MIT](LICENSE)
