import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { IncomingMessage, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";
import { test } from "node:test";

import type { PluginServerContext } from "@getpaseo/plugin/server";

import contribute from "../index.server.ts";
import type { PaseoApi } from "./sdk.ts";
import { socketPath } from "./socket.ts";

test("a socket send after reload works without any agent event or client RPC", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "paseo-peer-startup-test-"));
  const oldHome = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  const recipient = "12345678-1234-1234-1234-123456789abc";
  const sender = "87654321-4321-4321-4321-cba987654321";
  const sent: unknown[][] = [];
  let closed = false;
  const fakeApi = {
    agents: {
      ref: () => ({
        current: () => ({ archivedAt: null, id: recipient, title: "receiver" }),
        refresh: async () => {},
        send: async (...args: unknown[]) => {
          sent.push(args);
        },
      }),
    },
  };
  // SAFETY: the fake implements only the SDK members these tests exercise.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, typescript/no-unsafe-type-assertion -- A partial fake stands in for the host SDK type.
  const api = fakeApi as unknown as PaseoApi;
  const stop = contribute(
    // SAFETY: the fake implements only the host registrations the plugin calls.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions, typescript/no-unsafe-type-assertion -- A partial fake stands in for the plugin host.
    { before: () => {}, on: () => {} } as unknown as PluginServerContext,
    () => ({
      close: async () => {
        closed = true;
      },
      get: async () => api,
    })
  );
  t.after(async () => {
    await stop();
    if (oldHome === undefined) {
      delete process.env.PASEO_HOME;
    } else {
      process.env.PASEO_HOME = oldHome;
    }
    rmSync(home, { force: true, recursive: true });
    assert.equal(closed, true);
  });
  const req = request({
    method: "POST",
    path: "/send",
    socketPath: socketPath(home),
  });
  req.end(JSON.stringify({ from: sender, message: "hello", to: recipient }));
  const events: unknown[] = await once(req, "response");
  const [response] = events;
  assert.ok(response instanceof IncomingMessage);
  assert.deepEqual(JSON.parse(await text(response)), {
    ok: true,
    text: `Delivered to receiver (${recipient}).`,
  });
  assert.deepEqual(sent, [
    [`[from:${sender}]\nhello`, { activeTurnBehavior: "steer" }],
  ]);
});
