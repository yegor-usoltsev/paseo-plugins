# paseo-plugins

Each top-level plugin directory (`peer/`, `resume/`) is an independent Paseo plugin with its own `paseo-plugin.json`, `package.json`, `tsconfig.json` and `AGENTS.md`. Users install one with `paseo plugin install github:yegor-usoltsev/paseo-plugins:<directory>`, so keep each plugin self-contained: no imports across plugin directories and no `tsconfig` `extends` outside the plugin.

Development uses Bun: the root `package.json` is a Bun workspace with `bun.lock`. Run `bun install` and `bun run test` at the root; `bun run test` runs `bun test` in every workspace. Each plugin declares `@getpaseo/client` and `ws` runtime dependencies and owns a standalone npm `package-lock.json`. Its manifest `build` runs `npm ci --workspaces=false --omit=dev --ignore-scripts`; GitHub installation runs it on the user's daemon host, where Paseo requires only npm, so keep that command and those locks on npm rather than Bun. Directory installation does not run it: prepare a directory plugin with `npm ci --prefix peer --workspaces=false --omit=dev --ignore-scripts` (or `resume`) before install/reload when its lock changes. Keep `bun.lock` and the standalone locks current; CI runs both `npm ci` commands to catch a stale standalone lock. Import SDK types through the host’s `@getpaseo/plugin` to match its context types.

`bun run lint` runs type checking and Ultracite (oxlint and oxfmt) and also runs as the pre-commit hook; `bun run lint:fix` applies fixes. One root `oxlint.config.ts` covers both plugins, and type-aware rules resolve each plugin's `tsconfig.json`. `tsc` is TypeScript 7 from `@typescript/native`; the `typescript` package stays on 6 because `eslint-plugin-github` loads typescript-eslint, which rejects 7.

CI runs `bun install --frozen-lockfile`, `bun run lint`, `bun run test` and the standalone `npm ci` commands on Linux and macOS.

The plugin IDs `paseo-peer` and `paseo-resume` are stable: installations, the resume state file and agents' `peer` MCP servers depend on them. Add a new plugin as a new directory and list it in the root `workspaces` and `README.md`.
