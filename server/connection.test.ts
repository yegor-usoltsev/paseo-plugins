import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connectDaemon, daemonUrl } from "./connection.ts";

void test("the daemon's own TCP address selects the local endpoint", () => {
  assert.equal(daemonUrl("127.0.0.1:6767"), "ws://127.0.0.1:6767/ws");
  assert.equal(daemonUrl("127.0.0.1:80"), "ws://127.0.0.1/ws");
  assert.equal(daemonUrl("0.0.0.0:17669"), "ws://127.0.0.1:17669/ws");
  assert.equal(daemonUrl("[::]:6767"), "ws://[::1]:6767/ws");
  assert.throws(() => daemonUrl("unix:///run/paseo.sock"));
  assert.throws(() => daemonUrl("localhost"));
});

void test("a missing scoped daemon cannot fall back to the live default daemon", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "paseo-connection-test-"));
  const connection = connectDaemon(home);
  t.after(async () => {
    await connection.close();
    rmSync(home, { force: true, recursive: true });
  });
  await assert.rejects(connection.get(), /paseo\.pid/u);
  await assert.rejects(connection.get(), /paseo\.pid/u);
  await connection.close();
  await assert.rejects(connection.get(), /closed/u);
});
