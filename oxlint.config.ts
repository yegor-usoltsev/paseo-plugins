import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { jsPluginSettings, selectJsPlugins } from "ultracite/oxlint/js-plugins";
import react from "ultracite/oxlint/react";

const jsPlugins = selectJsPlugins(["github", "sonarjs", "react-doctor"]);

export default defineConfig({
  extends: [core, react, antiSlop, jsPlugins],
  // The paseo-plugin skill is installed from upstream (skills-lock.json).
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    ".agents/skills",
    ".claude/skills",
  ],
  jsPlugins: jsPlugins.jsPlugins,
  options: {
    reportUnusedDisableDirectives: "error",
    typeAware: true,
  },
  settings: jsPluginSettings,
});
