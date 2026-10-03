# Paseo plugins

Plugins for [Paseo](https://paseo.sh) that let coding agents work through the night: they message each other without interrupting, and they continue on their own after a provider usage limit resets.

- **[peer](peer/)**: gives every agent a `peer.send` tool. A message joins the recipient's running turn instead of interrupting it, and the chat shows it as a "From …" card.
- **[resume](resume/)**: notices when a Claude Code or Codex turn stops on a usage limit and sends "Continue where you left off" shortly after the limit resets. A pill above the message box shows the countdown, with Try now and Cancel.
- **Independent.** Each plugin installs, updates and runs on its own, in its own daemon process. They work well together: resume tells a resumed agent's parent when it finishes, in peer's message format.
- **Ready after reload.** Both can connect to their own daemon before its first agent event. Peer messages and restored resumes always steer, so a concurrent turn continues running.

## Install

You need Paseo 0.10.3 or later and npm on the daemon host. GitHub installation installs each plugin’s locked runtime dependencies automatically. On the daemon host, run:

```sh
paseo plugin install github:yegor-usoltsev/paseo-plugins:peer
paseo plugin install github:yegor-usoltsev/paseo-plugins:resume
```

Agents created after installation get the `peer.send` tool. Update both later with `paseo plugin update --all`.

To work on the plugins, clone the repository and install from the checkout instead:

```sh
git clone https://github.com/yegor-usoltsev/paseo-plugins.git
cd paseo-plugins
npm install
npm test
npm run typecheck
npm ci --prefix peer --workspaces=false --omit=dev --ignore-scripts
npm ci --prefix resume --workspaces=false --omit=dev --ignore-scripts
paseo plugin install "$PWD/peer"
paseo plugin install "$PWD/resume"
```

Directory installation does not run the manifest preparation command; the two `npm ci --prefix` commands above prepare standalone plugin dependencies. Rerun the affected command when its package lock changes.

After editing a plugin, apply the change with `paseo plugin reload paseo-peer` or `paseo plugin reload paseo-resume`.

## License

[MIT](LICENSE)
