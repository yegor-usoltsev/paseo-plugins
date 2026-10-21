# Paseo plugins

Independent plugins for [Paseo](https://paseo.sh). Each plugin lives in its own directory and can be installed on its own.

- **[resume](resume/)** continues Claude Code and Codex agents after a provider usage-limit reset, with a countdown and controls in the composer.

```sh
paseo plugin install github:yegor-usoltsev/paseo-plugins:resume
```

See each plugin's README for its requirements and usage. Paseo's native steering and sender identity replace the former `peer` plugin.

## Development

Run shared checks from the repository root:

```sh
npm ci
npm run lint
npm test
```

Prepare and load one plugin separately:

```sh
npm ci --prefix resume --workspaces=false --omit=dev --ignore-scripts
paseo plugin install "$PWD/resume"
```

## License

[MIT](LICENSE)
