import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { PendingStore } from "./pending.ts";

const entry = {
  basis: "reset" as const,
  parentAgentId: null,
  resumeAt: "2026-10-21T12:00:00.000Z",
  rowId: "job",
  workspaceId: "background-workspace",
};
const setup = (t: TestContext) => {
  const root = mkdtempSync(path.join(tmpdir(), "paseo-pending-test-"));
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = root;
  t.after(() => {
    if (previous === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previous;
    }
    rmSync(root, { force: true, recursive: true });
  });
  const store = new PendingStore(root);
  store.set("saved", entry);
  const directory = path.join(root, "paseo-resume");
  const file = path.join(directory, readdirSync(directory)[0]);
  return { file, root, store };
};

void test("invalid persisted jobs cannot enter the scheduler", (t) => {
  const { file, root } = setup(t);
  t.mock.method(console, "error", () => {});
  writeFileSync(
    file,
    JSON.stringify({ invalid: { ...entry, parentAgentId: 42 }, saved: entry })
  );
  const restored = new PendingStore(root);
  assert.deepEqual(restored.get("saved"), entry);
  assert.equal(restored.get("invalid"), undefined);
});

void test("failed persistence leaves the confirmed in-memory schedule intact", (t) => {
  const { file, root, store } = setup(t);
  mkdirSync(`${file}.tmp`);
  assert.throws(() => {
    store.set("new", entry);
  });
  assert.equal(store.get("new"), undefined);
  assert.throws(() => store.delete("saved"));
  assert.deepEqual(store.get("saved"), entry);
  assert.deepEqual(new PendingStore(root).get("saved"), entry);
});

void test("corrupt state is reported without preventing plugin startup", (t) => {
  const { file, root } = setup(t);
  const errors = t.mock.method(console, "error", () => {});
  for (const source of ["null", "[]", "{"]) {
    writeFileSync(file, source);
    assert.deepEqual(new PendingStore(root).all(), []);
  }
  assert.equal(errors.mock.callCount(), 3);
});
