import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { jsPluginSettings, selectJsPlugins } from "ultracite/oxlint/js-plugins";
import react from "ultracite/oxlint/react";

const jsPlugins = selectJsPlugins(["sonarjs", "react-doctor", "github"]);

export default defineConfig({
  extends: [core, react, antiSlop, jsPlugins],
  // The paseo-plugin skill is installed from upstream (skills-lock.json).
  ignorePatterns: [...(core.ignorePatterns ?? []), ".agents/skills"],
  jsPlugins: jsPlugins.jsPlugins,
  options: {
    reportUnusedDisableDirectives: "error",
    typeAware: true,
  },
  overrides: [
    {
      files: ["**/*.config.{cjs,cts,js,mjs,mts,ts}"],
      rules: {
        "import/no-default-export": "off",
      },
    },
    {
      files: ["**/*.tsx"],
      rules: {
        "func-style": ["error", "declaration"],
      },
    },
    {
      // Paseo loads a plugin's entry points through their default export.
      files: ["*/index.client.{ts,tsx}", "*/index.server.{ts,tsx}"],
      rules: {
        "import/no-default-export": "off",
      },
    },
    {
      // These tests stub the host's async SDK methods with in-memory fakes
      // that have nothing to await.
      files: [
        "peer/server/deliver.test.ts",
        "peer/server/lifecycle.test.ts",
        "resume/client/pending-monitor.test.ts",
        "resume/server/lifecycle.test.ts",
      ],
      rules: {
        "require-await": "off",
      },
    },
  ],
  rules: {
    "func-style": ["error", "expression"],
    "import/no-default-export": "error",
    // Components are function declarations, which are hoisted; files define
    // the exported component first and the helpers it renders below it.
    "no-use-before-define": ["error", { functions: false }],
    "react/function-component-definition": [
      "error",
      {
        namedComponents: "function-declaration",
        unnamedComponents: "arrow-function",
      },
    ],
    // node:test queues top-level tests and reports their failures itself, so
    // the promises its registration functions return need no handling.
    "typescript/no-floating-promises": [
      "error",
      {
        allowForKnownSafeCalls: [
          {
            from: "package",
            name: ["describe", "it", "suite", "test"],
            package: "node:test",
          },
        ],
      },
    ],
  },
  settings: jsPluginSettings,
});
