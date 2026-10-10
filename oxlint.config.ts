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
      // Paseo loads a plugin's entry points through their default export.
      files: ["*/index.client.{ts,tsx}", "*/index.server.{ts,tsx}"],
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
      // Tests stand in-memory fakes in for the host SDK. A fake implements
      // only the members under test, so it is cast to the SDK type, and its
      // async methods have nothing to await.
      files: ["**/*.test.ts"],
      rules: {
        "anti-slop/no-chained-type-assertions": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "off",
        "require-await": "off",
        "typescript/no-unsafe-type-assertion": "off",
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
