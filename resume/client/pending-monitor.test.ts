import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";

import type {
  PluginClientContext,
  PluginComposerPillContribution,
} from "@getpaseo/plugin/client";

import type { PendingEntry } from "../shared/rpc.ts";
import { createPendingMonitor } from "./pending-monitor.ts";

const entry: PendingEntry = {
  agentId: "old-agent",
  attempting: false,
  basis: "reset",
  jobId: "job",
  resumeAt: "2026-10-03T13:00:00Z",
};
// Lets pending promise chains run for at least this many microtask ticks.
const flush = async (ticks = 30): Promise<void> => {
  if (ticks > 0) {
    await Promise.resolve();
    await flush(ticks - 1);
  }
};
const deferred = <T>() => {
  let settle!: (value: T) => void;
  // oxlint-disable-next-line promise/avoid-new -- A test deferred settles its promise from outside.
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
};

interface AgentObserver {
  snapshot: (snapshot: {
    entries: { agent: { id: string; workspaceId: string } }[];
  }) => void;
  update: (message: {
    payload: { agentId: string; kind: "remove" };
    type: "agent_update";
  }) => void;
}

const setup = (t: TestContext, observeFails = false) => {
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
    label: string | undefined;
    removed: boolean;
  }[] = [];
  let observed: AgentObserver | undefined;
  let signal!: AbortSignal;
  const client = {
    addComposerPill: (input: PluginComposerPillContribution) => {
      const pill = {
        agentId: input.agentId,
        label: input.button.label,
        removed: false,
        workspaceId: input.workspaceId,
      };
      pills.push(pill);
      return {
        remove: () => {
          pill.removed = true;
        },
        update: (patch: { label: string }) => {
          pill.label = patch.label;
        },
      };
    },
    paseo: {
      agents: {
        list: async (options: { signal: AbortSignal }) => {
          ({ signal } = options);
          if (observeFails) {
            throw new Error("observation failed");
          }
          return {
            subscription: {
              subscribe: (handlers: AgentObserver) => {
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
          refresh: async () => {
            fetched.push(id);
          },
          workspaceId: "old-workspace",
        }),
      },
    },
    rpc: async () => {
      queries += 1;
      return await behavior.rpc();
    },
  } as unknown as PluginClientContext;
  const monitor = createPendingMonitor(client, () => null);
  t.after(() => {
    monitor.stop();
  });
  return {
    behavior,
    fetched,
    monitor,
    observed: () => {
      assert.ok(observed);
      return observed;
    },
    pills,
    queries: () => queries,
    signal: () => signal,
  };
};

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
  h.behavior.rpc = async () => await gate.promise;
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
  h.behavior.rpc = async () => await gate.promise;
  const query = h.monitor.refresh();
  h.observed().update({
    payload: { agentId: entry.agentId, kind: "remove" },
    type: "agent_update",
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
