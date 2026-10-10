import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  // The paseo-plugin skill is installed from upstream (skills-lock.json).
  ignorePatterns: [...(ultracite.ignorePatterns ?? []), ".agents/skills"],
});
