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
  workspaceId: "background-workspace",
};
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

const setup = (t: TestContext) => {
  t.mock.timers.enable({
    apis: ["Date", "setTimeout", "setInterval"],
    now: new Date("2026-10-03T12:00:00Z"),
  });
  t.mock.method(console, "error", () => {});
  const behavior = {
    rpc: async (): Promise<{ entries: PendingEntry[] }> =>
      await Promise.resolve({
        entries: [entry],
      }),
  };
  let queries = 0;
  const pills: {
    agentId: string;
    workspaceId: string;
    label: string | undefined;
    removed: boolean;
  }[] = [];
  const fakeClient = {
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
    rpc: async () => {
      queries += 1;
      return await behavior.rpc();
    },
  };
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, typescript/no-unsafe-type-assertion -- SAFETY: the fake implements only the client members the monitor uses.
  const client = fakeClient as unknown as PluginClientContext;
  const monitor = createPendingMonitor(client, () => null);
  t.after(() => {
    monitor.stop();
  });
  return {
    behavior,
    monitor,
    pills,
    queries: () => queries,
  };
};

void test("pending jobs get controls without observing the agent directory", async (t) => {
  const h = setup(t);
  await flush();
  assert.equal(h.pills.length, 1);
  assert.equal(h.pills[0].agentId, entry.agentId);
  assert.equal(h.pills[0].workspaceId, "background-workspace");
});

void test("failed queries keep the confirmed schedule and mark controls unavailable", async (t) => {
  const h = setup(t);
  await flush();
  h.behavior.rpc = async () => await Promise.reject(new Error("disconnected"));
  await h.monitor.refresh();
  assert.equal(h.monitor.getSnapshot().entries.get(entry.agentId), entry);
  assert.equal(h.monitor.getSnapshot().unavailable, true);
  assert.equal(h.pills[0].removed, false);
  assert.equal(h.pills[0].label, "Resume status unavailable");
  h.behavior.rpc = async () => await Promise.resolve({ entries: [] });
  await h.monitor.refresh();
  assert.equal(h.monitor.getSnapshot().unavailable, false);
  assert.equal(h.pills[0].removed, true);
});

void test("post-action reconciliation does not reuse a query captured before the action", async (t) => {
  const h = setup(t);
  await flush();
  const gate = deferred<{ entries: PendingEntry[] }>();
  h.behavior.rpc = async () => await gate.promise;
  const oldQuery = h.monitor.refresh();
  h.behavior.rpc = async () => await Promise.resolve({ entries: [] });
  const afterAction = h.monitor.refreshAfterAction();
  gate.resolve({ entries: [entry] });
  await oldQuery;
  await afterAction;
  assert.equal(h.monitor.getSnapshot().entries.size, 0);
  assert.equal(h.pills[0].removed, true);
});

void test("stopping during a query cannot recreate controls", async (t) => {
  const h = setup(t);
  await flush();
  const gate = deferred<{ entries: PendingEntry[] }>();
  h.behavior.rpc = async () => await gate.promise;
  const query = h.monitor.refresh();
  const queries = h.queries();
  h.monitor.stop();
  gate.resolve({ entries: [entry] });
  await query;
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(h.queries(), queries);
  assert.equal(h.pills.length, 1);
  assert.equal(h.pills[0].removed, true);
});
