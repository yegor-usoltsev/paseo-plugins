# paseo-plugins

Each top-level plugin directory (`peer/`, `resume/`) is an independent Paseo plugin with its own `paseo-plugin.json`, `package.json`, `tsconfig.json` and `AGENTS.md`. Users install one with `paseo plugin install github:yegor-usoltsev/paseo-plugins:<directory>`, so keep each plugin self-contained: no imports across plugin directories and no `tsconfig` `extends` outside the plugin.

The root `package.json` is an npm workspace that holds the shared devDependencies. Run `npm install`, `npm test` and `npm run typecheck` at the root; each runs in every workspace. The plugins import only libraries Paseo provides to plugins (`@getpaseo/*`, `react`, `react-native`, `zod`), so they need no `build` preparation command; a new runtime dependency would need one.

The plugin IDs `paseo-peer` and `paseo-resume` are stable: installations, the resume state file and agents' `peer` MCP servers depend on them. Add a new plugin as a new directory and list it in the root `workspaces` and `README.md`.
