import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { PluginServerContext } from "@getpaseo/plugin/server";

import contribute from "../index.server.ts";
import type { PaseoApi } from "./sdk.ts";
import { socketPath } from "./socket.ts";

test("a socket send after reload works without any agent event or client RPC", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "paseo-peer-startup-test-"));
  const oldHome = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  const recipient = "12345678-1234-1234-1234-123456789abc";
  const sender = "87654321-4321-4321-4321-cba987654321";
  const sent: unknown[][] = [];
  let closed = false;
  const api = {
    agents: {
      ref: () => ({
        refresh: async () => {},
        current: () => ({ id: recipient, title: "receiver", archivedAt: null }),
        send: async (...args: unknown[]) => {
          sent.push(args);
        },
      }),
    },
  } as unknown as PaseoApi;
  const stop = contribute(
    { before: () => {}, on: () => {} } as unknown as PluginServerContext,
    () => ({
      get: async () => api,
      close: async () => {
        closed = true;
      },
    })
  );
  t.after(async () => {
    await stop();
    if (oldHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = oldHome;
    rmSync(home, { recursive: true, force: true });
    assert.equal(closed, true);
  });
  const result = await new Promise<{ ok: boolean }>((resolve, reject) => {
    const req = request(
      { socketPath: socketPath(home), method: "POST", path: "/send" },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve(JSON.parse(body)));
      }
    );
    req.on("error", reject);
    req.end(JSON.stringify({ from: sender, to: recipient, message: "hello" }));
  });
  assert.equal(result.ok, true);
  assert.deepEqual(sent, [
    [`[from:${sender}]\nhello`, { activeTurnBehavior: "steer" }],
  ]);
});
