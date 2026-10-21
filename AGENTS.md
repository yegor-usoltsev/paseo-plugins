# paseo-plugins

Each top-level plugin directory is an independent Paseo plugin and npm workspace. Preserve published directory names and install selectors when refactoring. Keep the root for shared tooling; a single remaining plugin still belongs in its own directory. Add a plugin by adding its directory to `package.json` workspaces and the README. The dotfiles updater reads that workspace list.

Each plugin owns `paseo-plugin.json`, `OVERVIEW.md`, `README.md`, `package.json`, `package-lock.json`, `tsconfig.json` and `AGENTS.md`. Keep its files list, template dependencies and tsconfig aligned with `paseo plugin init`; tests add Node types and `allowImportingTsExtensions`. Runtime entries import only from their own `client/`, `server/` and `shared/`. No cross-plugin imports or external tsconfig inheritance: `github:yegor-usoltsev/paseo-plugins:<directory>` must install independently. Preserve plugin IDs because installations and saved state use them.

The root package holds shared lint tooling, pinned exactly. Run `npm ci`, `npm run lint` and `npm test` here. Root commands check every workspace. CI checks Linux and macOS on Node 24. Lint runs each plugin's typecheck and the Ultracite presets with GitHub, SonarJS and React Doctor rules; prek runs it before commits. Fix diagnostics first, then suppress locally with a reason. Type assertions need a `SAFETY:` reason. Code comments are limited to lint suppressions and behavior-changing directives. Async test fakes await resolved or rejected promises instead of ignoring `require-await`.

Keep root and plugin locks current. A plugin's Git preparation runs `npm ci --workspaces=false --omit=dev --ignore-scripts`; directory installation does not. Prepare it with `npm ci --prefix <directory> --workspaces=false --omit=dev --ignore-scripts` before loading. Root workspace installs can hoist dependencies, so the updater verifies the standalone lock's runtime package paths as well as its fingerprint.

Tests use Node's built-in TypeScript support, so keep `.ts` extensions on runtime imports. Keep each plugin's `CLAUDE.md` a relative symlink to its `AGENTS.md`.
