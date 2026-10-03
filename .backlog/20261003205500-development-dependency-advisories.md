# Review the development dependency audit

`npm ci` and `npm audit --json` on 2026-10-03 report 15 high-severity entries in the development dependency tree. The underlying advisory is `braces`: stack-exhaustion denial of service through deeply nested patterns, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Other reported entries inherit that advisory through their dependencies.

The audit concerns the root development tooling. Each plugin now declares locked `@getpaseo/client` and `ws` runtime dependencies; `npm audit --omit=dev` reports no vulnerabilities. The development audit does not establish whether a deployed Paseo contains the affected version.

Open decision: update or override the affected tooling dependencies after checking compatibility with the pinned Paseo SDK and React Native development types. Do not run `npm audit fix --force` as part of unrelated changes.

The current registry release is still `braces@3.0.3`, and `npm update braces` does not resolve the advisory. The audit suggests a major React Native update to 0.87.1; the development types are pinned to the Paseo 0.10.3 host’s React Native 0.81.5, so that change needs its own compatibility check.
