import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { connectDaemon, daemonTarget } from "./connection.ts";

test("the daemon's own listen address selects TCP or Unix transport", () => {
  assert.deepEqual(daemonTarget("127.0.0.1:6767"), { url: "ws://127.0.0.1:6767/ws" });
  assert.deepEqual(daemonTarget("127.0.0.1:80"), { url: "ws://127.0.0.1/ws" });
  assert.deepEqual(daemonTarget("0.0.0.0:17669"), { url: "ws://127.0.0.1:17669/ws" });
  assert.deepEqual(daemonTarget("[::]:6767"), { url: "ws://[::1]:6767/ws" });
  assert.deepEqual(daemonTarget("unix:///tmp/paseo.sock"), { url: "ws+unix:///tmp/paseo.sock:/ws", socketPath: "/tmp/paseo.sock" });
  assert.throws(() => daemonTarget("unix://"));
  assert.throws(() => daemonTarget("localhost"));
});

test("a missing scoped daemon cannot fall back to the live default daemon", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "paseo-connection-test-"));
  const connection = connectDaemon(home);
  t.after(async () => { await connection.close(); rmSync(home, { recursive: true, force: true }); });
  await assert.rejects(connection.get(), /paseo.pid/);
  // A failed connect is retryable rather than a permanently rejected cache.
  await assert.rejects(connection.get(), /paseo.pid/);
  await connection.close();
  await assert.rejects(connection.get(), /closed/);
});
