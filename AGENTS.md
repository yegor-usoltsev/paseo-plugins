# paseo-resume

This repository is one Paseo plugin at its root. Keep its files list, template dependencies and tsconfig aligned with `paseo plugin init`; tests add Node types and `allowImportingTsExtensions`. The runtime entries import only from `client/`, `server/` and `shared/`. Keep the ID `paseo-resume` stable because installations and saved jobs use it.

The plugin targets Paseo 0.12.0 and uses its native agent messages. SDK versions are pinned together in `package.json`. Its scoped startup connection uses Node's built-in WebSocket; only TCP listeners are supported. Server scheduling constraints are in `server/AGENTS.md`.

Run `npm ci`, `npm run lint` and `npm test`. CI checks Linux and macOS on Node 24. `npm run lint` runs typecheck and the Ultracite presets with GitHub, SonarJS and React Doctor rules; prek runs it before commits. Fix diagnostics first, then suppress locally with a reason. Type assertions need a `SAFETY:` reason. Code comments are limited to lint suppressions and behavior-changing directives. Async test fakes await resolved or rejected promises instead of ignoring `require-await`.

Git installation runs the manifest's `npm ci --omit=dev --ignore-scripts` preparation. Directory installation does not; the dotfiles updater prepares dependencies before install or reload. Restore dev dependencies with `npm ci` for checks.

Tests use Node's built-in TypeScript support, so keep `.ts` extensions on runtime imports. Lifecycle tests isolate `PASEO_HOME` and `XDG_STATE_HOME`, fake time and SDK operations, and never send live agent messages. Client controls poll pending jobs directly, including their workspace IDs; avoid subscribing to the whole agent directory. Stale actions carry their displayed job ID and cannot change a replacement job. Failed queries keep the last confirmed schedule and disable actions until a fresh query succeeds.
