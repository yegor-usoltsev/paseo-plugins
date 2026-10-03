# Review the development dependency audit

`npm ci` and `npm audit --json` on 2026-10-03 report 15 high-severity entries in the development dependency tree. The underlying advisory is `braces`: stack-exhaustion denial of service through deeply nested patterns, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Other reported entries inherit that advisory through their dependencies.

Both plugin packages have no runtime dependencies and installation compiles against Paseo's provided libraries; this audit concerns the root development tooling. It does not establish whether a deployed Paseo contains the affected version.

Open decision: update or override the affected tooling dependencies after checking compatibility with the pinned Paseo SDK and React Native development types. Do not run `npm audit fix --force` as part of unrelated changes.
