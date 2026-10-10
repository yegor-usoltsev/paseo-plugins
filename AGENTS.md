# paseo-plugins

Each top-level plugin directory (`peer/`, `resume/`) is an independent Paseo plugin with its own `paseo-plugin.json`, `package.json`, `tsconfig.json` and `AGENTS.md`. Users install one with `paseo plugin install github:yegor-usoltsev/paseo-plugins:<directory>`, so keep each plugin self-contained: no imports across plugin directories and no `tsconfig` `extends` outside the plugin.

The root `package.json` is an npm workspace that holds the shared devDependencies. Run `npm install` and `npm test` at the root; `npm test` runs in every workspace. Each plugin declares `@getpaseo/client` and `ws` runtime dependencies and owns a standalone package lock. Its manifest preparation runs `npm ci --workspaces=false --omit=dev --ignore-scripts`; GitHub installation runs it, directory installation does not. Prepare a directory plugin with `npm ci --prefix peer --workspaces=false --omit=dev --ignore-scripts` (or `resume`) before install/reload when its lock changes. Keep the workspace lock and standalone locks current. Import SDK types through the host’s `@getpaseo/plugin` to match its context types.

`npm run lint` runs type checking and Ultracite (oxlint and oxfmt) and also runs as the pre-commit hook; `npm run lint:fix` applies fixes. One root `oxlint.config.ts` covers both plugins, and type-aware rules resolve each plugin's `tsconfig.json`. `tsc` is TypeScript 7 from `@typescript/native`; the `typescript` package stays on 6 because `eslint-plugin-github` loads typescript-eslint, which rejects 7.

CI runs `npm ci`, `npm run lint` and `npm test` on Linux and macOS with Node 24. The tests use Node's built-in TypeScript support.

The plugin IDs `paseo-peer` and `paseo-resume` are stable: installations, the resume state file and agents' `peer` MCP servers depend on them. Add a new plugin as a new directory and list it in the root `workspaces` and `README.md`.
