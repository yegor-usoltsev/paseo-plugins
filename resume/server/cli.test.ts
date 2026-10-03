import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { cliCommand } from "./cli.ts";

for (const executable of [
  "Paseo.app/Contents/MacOS/Paseo",
  "Paseo.app/Contents/Frameworks/Paseo Helper.app/Contents/MacOS/Paseo Helper",
]) {
  test(`finds the bundled CLI from ${executable}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "paseo-cli-test-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const cli = join(root, "Paseo.app/Contents/Resources/bin/paseo");
    mkdirSync(dirname(cli), { recursive: true });
    writeFileSync(cli, "");
    assert.equal(cliCommand(join(root, executable)), cli);
  });
}

test("uses PATH when no bundled CLI exists", (t) => {
  const root = mkdtempSync(join(tmpdir(), "paseo-cli-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(cliCommand(join(root, "bin/node")), "paseo");
});
