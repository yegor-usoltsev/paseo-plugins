import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import type { PluginClientContext } from "@getpaseo/plugin/client";

import type { PendingEntry } from "../shared/rpc.ts";
import { createPendingMonitor } from "./pending-monitor.ts";

const entry: PendingEntry = {
  agentId: "old-agent",
  jobId: "job",
  resumeAt: "2026-10-03T13:00:00Z",
  basis: "reset",
  attempting: false,
};
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function setup(t: TestContext, observeFails = false) {
  t.mock.timers.enable({
    apis: ["Date", "setTimeout", "setInterval"],
    now: new Date("2026-10-03T12:00:00Z"),
  });
  t.mock.method(console, "error", () => {});
  const behavior = {
    rpc: async (): Promise<{ entries: PendingEntry[] }> => ({
      entries: [entry],
    }),
  };
  let queries = 0;
  const fetched: string[] = [];
  const pills: {
    agentId: string;
    workspaceId: string;
    label: string;
    removed: boolean;
  }[] = [];
  let observed: any;
  let signal!: AbortSignal;
  const client = {
    rpc: () => {
      queries++;
      return behavior.rpc();
    },
    paseo: {
      agents: {
        list: async (options: { signal: AbortSignal }) => {
          signal = options.signal;
          if (observeFails) throw new Error("observation failed");
          return {
            subscription: {
              subscribe: (handlers: any) => {
                observed = handlers;
                handlers.snapshot({
                  entries: Array.from({ length: 200 }, (_, i) => ({
                    agent: {
                      id: `recent-${i}`,
                      workspaceId: "recent-workspace",
                    },
                  })),
                });
              },
            },
          };
        },
        ref: (id: string) => ({
          workspaceId: "old-workspace",
          refresh: async () => {
            fetched.push(id);
          },
        }),
      },
    },
    addComposerPill: (input: any) => {
      const pill = {
        agentId: input.agentId,
        workspaceId: input.workspaceId,
        label: input.button.label,
        removed: false,
      };
      pills.push(pill);
      return {
        update: (patch: { label: string }) => {
          pill.label = patch.label;
        },
        remove: () => {
          pill.removed = true;
        },
      };
    },
  } as unknown as PluginClientContext;
  const monitor = createPendingMonitor(client, () => null);
  t.after(monitor.stop);
  return {
    monitor,
    behavior,
    fetched,
    pills,
    queries: () => queries,
    observed: () => observed,
    signal: () => signal,
  };
}

test("a restored agent beyond the first directory page gets its controls", async (t) => {
  const h = setup(t);
  await flush();
  assert.deepEqual(h.fetched, [entry.agentId]);
  assert.equal(h.pills.length, 1);
  assert.equal(h.pills[0].agentId, entry.agentId);
  assert.equal(h.pills[0].workspaceId, "old-workspace");
});

test("pending controls load even if agent observation fails", async (t) => {
  const h = setup(t, true);
  await flush();
  assert.equal(h.pills.length, 1);
  assert.equal(h.monitor.getSnapshot().unavailable, false);
});

test("failed queries keep the confirmed schedule and mark controls unavailable", async (t) => {
  const h = setup(t);
  await flush();
  h.behavior.rpc = async () => {
    throw new Error("disconnected");
  };
  await h.monitor.refresh();
  assert.equal(h.monitor.getSnapshot().entries.get(entry.agentId), entry);
  assert.equal(h.monitor.getSnapshot().unavailable, true);
  assert.equal(h.pills[0].removed, false);
  assert.equal(h.pills[0].label, "Resume status unavailable");
  h.behavior.rpc = async () => ({ entries: [] });
  await h.monitor.refresh();
  assert.equal(h.monitor.getSnapshot().unavailable, false);
  assert.equal(h.pills[0].removed, true);
});

test("post-action reconciliation does not reuse a query captured before the action", async (t) => {
  const h = setup(t);
  await flush();
  const gate = deferred<{ entries: PendingEntry[] }>();
  h.behavior.rpc = () => gate.promise;
  const oldQuery = h.monitor.refresh();
  h.behavior.rpc = async () => ({ entries: [] });
  const afterAction = h.monitor.refreshAfterAction();
  gate.resolve({ entries: [entry] });
  await oldQuery;
  await afterAction;
  assert.equal(h.monitor.getSnapshot().entries.size, 0);
  assert.equal(h.pills[0].removed, true);
});

test("stopping during a query cannot recreate controls", async (t) => {
  const h = setup(t);
  await flush();
  const gate = deferred<{ entries: PendingEntry[] }>();
  h.behavior.rpc = () => gate.promise;
  const query = h.monitor.refresh();
  h.observed().update({
    type: "agent_update",
    payload: { kind: "remove", agentId: entry.agentId },
  });
  const queries = h.queries();
  h.monitor.stop();
  gate.resolve({ entries: [entry] });
  await query;
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(h.signal().aborted, true);
  assert.equal(h.queries(), queries);
  assert.equal(h.pills.length, 1);
  assert.equal(h.pills[0].removed, true);
});
