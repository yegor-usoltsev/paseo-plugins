import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import type {
  PluginServerContext,
  PluginLifecycleEvents,
} from "@getpaseo/plugin/server";

import contribute from "../index.server.ts";
import type { PendingEntry } from "../shared/rpc.ts";
import { PendingStore } from "./pending.ts";
import type { PaseoAgentSendOptions, PaseoApi } from "./sdk.ts";

const NOW = new Date("2026-10-03T12:00:00Z");
const agent = {
  cwd: "/tmp",
  id: "child",
  parentAgentId: "parent",
  provider: "claude",
  title: "test",
  workspaceId: null,
};
const notice = "You've hit your session limit · resets 3:40pm (UTC)";
// Lets pending promise chains run for at least this many microtask ticks.
const flush = async (ticks = 30): Promise<void> => {
  if (ticks > 0) {
    await Promise.resolve();
    await flush(ticks - 1);
  }
};
const deferred = () => {
  let settle!: () => void;
  let fail!: (error: Error) => void;
  // oxlint-disable-next-line promise/avoid-new -- A test deferred settles its promise from outside.
  const promise = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, reject: fail, resolve: settle };
};

type HookHandler = (
  event: PluginLifecycleEvents[keyof PluginLifecycleEvents],
  context: { paseo: PaseoApi }
) => Promise<void> | void;
interface RpcInput {
  agentId?: string;
  jobId?: string;
}
type RpcOutput = { entries: PendingEntry[] } | { message: string; ok: boolean };
type RpcHandler = (
  input: RpcInput,
  context: { paseo: PaseoApi }
) => Promise<RpcOutput> | RpcOutput;

const setup = (t: TestContext, restored = false, readiness?: Promise<void>) => {
  const root = mkdtempSync(path.join(tmpdir(), "paseo-resume-test-"));
  const oldHome = process.env.PASEO_HOME;
  const oldState = process.env.XDG_STATE_HOME;
  process.env.PASEO_HOME = root;
  process.env.XDG_STATE_HOME = root;
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  t.mock.method(console, "error", () => {});
  const store = () => new PendingStore(root);
  if (restored) {
    store().set(agent.id, {
      parentAgentId: agent.parentAgentId,
      resumeAt: NOW.toISOString(),
    });
  }
  const hooks = new Map<string, HookHandler>();
  const sent: { id: string; text: string; options: unknown }[] = [];
  const rows: { rowId: string; state: string }[] = [];
  let snapshot: {
    status: string;
    archivedAt: string | null;
    provider?: string;
  } | null = { archivedAt: null, provider: "claude", status: "idle" };
  const behavior = {
    refresh: async () => {},
    send: async () => {},
    usage: async () => ({
      providers: [
        {
          providerId: "claude",
          windows: [
            { resetsAt: new Date(+NOW + 1000).toISOString(), usedPct: 100 },
          ],
        },
      ],
    }),
  };
  const api = {
    agents: {
      ref: (id: string) => ({
        get archivedAt() {
          return snapshot?.archivedAt;
        },
        current: () => snapshot,
        refresh: async () => {
          await behavior.refresh();
        },
        send: async (text: string, options: PaseoAgentSendOptions) => {
          sent.push({ id, options, text });
          if (id === agent.id) {
            await behavior.send();
          }
        },
        timeline: {
          append: async (row: { id: string; data: { state: string } }) => {
            rows.push({ rowId: row.id, state: row.data.state });
          },
        },
      }),
    },
    providers: { listUsage: async () => await behavior.usage() },
  } as unknown as PaseoApi;
  const rpcs = new Map<string, RpcHandler>();
  const stop = contribute(
    {
      handle: (contract: { name: string }, handler: RpcHandler) =>
        rpcs.set(contract.name, handler),
      on: (name: string, handler: HookHandler) => hooks.set(name, handler),
    } as unknown as PluginServerContext,
    () => ({
      close: async () => {},
      get: async () => {
        await readiness;
        return api;
      },
    })
  );
  t.after(() => {
    void stop();
    if (oldHome === undefined) {
      delete process.env.PASEO_HOME;
    } else {
      process.env.PASEO_HOME = oldHome;
    }
    if (oldState === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = oldState;
    }
    rmSync(root, { force: true, recursive: true });
  });
  const emit = async <K extends keyof PluginLifecycleEvents>(
    name: K,
    event: PluginLifecycleEvents[K]
  ) => {
    const hook = hooks.get(name);
    assert.ok(hook);
    await hook(event, { paseo: api });
  };
  const limited = async (text = notice) => {
    await emit("agent.turn_ended", {
      agent,
      outcome: { kind: "completed" },
      timeline: [{ text, type: "assistant_message" }],
      turnId: "limited",
    });
  };
  const start = async (turnId = "resumed") => {
    await emit("agent.turn_started", { agent, turnId });
  };
  const archive = async () => {
    await emit("agent.archived", { agent, archivedAt: NOW.toISOString() });
  };
  const tick = async (ms = 121_000) => {
    t.mock.timers.tick(ms);
    await flush();
  };
  const rpc = async (name: string, input: RpcInput) => {
    const handler = rpcs.get(name);
    assert.ok(handler);
    return await handler(input, { paseo: api });
  };
  const listPending = async () => {
    const result = await rpc("list-pending", {});
    assert.ok("entries" in result);
    return result;
  };
  // Actions default to the displayed job, as the client sends it.
  const act = async (name: string, input: RpcInput) => {
    const entry = store().get(agent.id);
    const result = await rpc(name, {
      jobId: entry?.rowId ?? entry?.resumeAt,
      ...input,
    });
    assert.ok("ok" in result);
    return result;
  };
  const stored = () => {
    const entry = store().get(agent.id);
    assert.ok(entry);
    return entry;
  };
  return {
    act,
    archive,
    behavior,
    emit,
    limited,
    listPending,
    rows,
    sent,
    setSnapshot: (value: typeof snapshot) => {
      snapshot = value;
    },
    start,
    stop,
    store,
    stored,
    tick,
  };
};

for (const action of ["archive", "stop"] as const) {
  test(`${action} during usage lookup invalidates the schedule`, async (t) => {
    const h = setup(t);
    const gate = deferred();
    const { usage } = h.behavior;
    h.behavior.usage = async () => {
      await gate.promise;
      return await usage();
    };
    const schedule = h.limited();
    await h[action]();
    gate.resolve();
    await schedule;
    assert.equal(h.store().get(agent.id), undefined);
    await h.tick();
    assert.equal(h.sent.length, 0);
  });
}

test("a failed send remains persisted and retries", async (t) => {
  const h = setup(t);
  h.behavior.send = async () => {
    throw new Error("disconnected");
  };
  await h.limited();
  await h.tick();
  assert.equal(
    h.store().get(agent.id)?.resumeAt,
    new Date(+NOW + 121_000 + 300_000).toISOString()
  );
  h.behavior.send = async () => {
    await h.start();
  };
  await h.tick(300_000);
  assert.equal(h.sent.length, 2);
  assert.deepEqual(h.sent[1].options, { activeTurnBehavior: "steer" });
  assert.equal(h.store().get(agent.id), undefined);
});

test("a failed refresh retries instead of discarding the job", async (t) => {
  const h = setup(t);
  h.behavior.refresh = async () => {
    throw new Error("disconnected");
  };
  await h.limited();
  await h.tick();
  assert.ok(h.store().get(agent.id));
  h.behavior.refresh = async () => {};
  await h.tick(300_000);
  assert.equal(h.sent.length, 1);
});

for (const action of ["archive", "stop"] as const) {
  test(`${action} during refresh prevents delivery`, async (t) => {
    const h = setup(t);
    const gate = deferred();
    h.behavior.refresh = async () => {
      await gate.promise;
    };
    await h.limited();
    await h.tick();
    await h[action]();
    gate.resolve();
    await flush();
    assert.equal(h.sent.length, 0);
  });
}

test("archiving during a failed send does not resurrect the job", async (t) => {
  const h = setup(t);
  const gate = deferred();
  h.behavior.send = async () => {
    await gate.promise;
  };
  await h.limited();
  await h.tick();
  await h.archive();
  gate.reject(new Error("disconnected"));
  await flush();
  assert.equal(h.store().get(agent.id), undefined);
});

test("a fast repeated limit is not deleted by the earlier send response", async (t) => {
  const h = setup(t);
  h.behavior.send = async () => {
    await h.start();
    await h.limited();
  };
  await h.limited();
  await h.tick();
  assert.ok(h.store().get(agent.id));
});

for (const state of [null, { archivedAt: NOW.toISOString(), status: "idle" }]) {
  test(`resume discards an unavailable recipient: ${JSON.stringify(state)}`, async (t) => {
    const h = setup(t);
    h.setSnapshot(state);
    await h.limited();
    await h.tick();
    assert.equal(h.sent.length, 0);
    assert.equal(h.store().get(agent.id), undefined);
  });
}

test("a resumed failure reaches the parent without interrupting it", async (t) => {
  const h = setup(t);
  h.behavior.send = async () => {
    await h.start();
  };
  await h.limited();
  await h.tick();
  await h.emit("agent.turn_ended", {
    agent,
    outcome: { error: { message: "Connection reset" }, kind: "failed" },
    timeline: [],
    turnId: "resumed",
  });
  assert.equal(h.sent[1].id, "parent");
  assert.match(h.sent[1].text, /failed: Connection reset/u);
  assert.deepEqual(h.sent[1].options, { activeTurnBehavior: "steer" });
});

test("a replacement turn does not inherit the resumed turn notification", async (t) => {
  const h = setup(t);
  h.behavior.send = async () => {
    await h.start();
  };
  await h.limited();
  await h.tick();
  await h.start("replacement");
  await h.emit("agent.turn_ended", {
    agent,
    outcome: { kind: "completed" },
    timeline: [],
    turnId: "replacement",
  });
  assert.equal(h.sent.length, 1);
});

test("a restored job retries failed SDK delivery before any hook or RPC", async (t) => {
  const h = setup(t, true);
  h.behavior.send = async () => {
    throw new Error("disconnected");
  };
  await h.tick(0);
  assert.ok(h.store().get(agent.id));
  assert.equal(h.sent.length, 1);
  h.behavior.send = async () => {};
  await h.tick(300_000);
  assert.equal(h.sent.length, 2);
  assert.deepEqual(h.sent[1].options, { activeTurnBehavior: "steer" });
  assert.equal(h.store().get(agent.id), undefined);
});

for (const snapshot of [
  null,
  { archivedAt: NOW.toISOString(), status: "idle" },
]) {
  test(`a restored job skips an unavailable SDK recipient: ${JSON.stringify(snapshot)}`, async (t) => {
    const h = setup(t, true);
    h.setSnapshot(snapshot);
    await h.tick(0);
    assert.equal(h.sent.length, 0);
    assert.equal(h.store().get(agent.id), undefined);
  });
}

test("a cancelled restored job cannot send after startup connection resolves", async (t) => {
  const gate = deferred();
  const h = setup(t, true, gate.promise);
  await h.tick(0);
  await h.archive();
  gate.resolve();
  await flush();
  assert.equal(h.sent.length, 0);
  assert.equal(h.store().get(agent.id), undefined);
});

test("joining a concurrently started turn does not claim it was resumed", async (t) => {
  const h = setup(t);
  await h.limited();
  await h.tick();
  await h.emit("agent.turn_ended", {
    agent,
    outcome: { kind: "completed" },
    timeline: [],
    turnId: "user-turn",
  });
  assert.equal(h.sent.length, 1);
});

test("the pending list reports the resume time and whether it is a guess", async (t) => {
  const h = setup(t);
  await h.limited();
  assert.deepEqual(await h.listPending(), {
    entries: [
      {
        agentId: agent.id,
        attempting: false,
        basis: "reset",
        jobId: h.stored().rowId,
        resumeAt: new Date(+NOW + 121_000).toISOString(),
      },
    ],
  });
  h.behavior.usage = async () => ({ providers: [] });
  await h.limited("You've hit your usage limit");
  const listed = await h.listPending();
  assert.equal(listed.entries[0].basis, "estimate");
});

test("Claude's zoned notice schedules a known reset with two minutes of margin", async (t) => {
  const h = setup(t);
  h.behavior.usage = async () => ({ providers: [] });
  await h.emit("agent.turn_ended", {
    agent,
    outcome: { kind: "completed" },
    timeline: [
      {
        text: "You've hit your session limit · resets 11:40pm (Europe/Minsk)",
        type: "assistant_message",
      },
    ],
    turnId: "limited",
  });
  assert.equal(h.store().get(agent.id)?.resumeAt, "2026-10-03T20:42:00.000Z");
  assert.equal(h.store().get(agent.id)?.basis, "reset");
});

test("ambiguous multi-account usage defers to the notice's reset", async (t) => {
  const h = setup(t);
  h.behavior.usage = async () => ({
    providers: [
      {
        providerId: "claude",
        windows: [{ resetsAt: "2026-10-03T18:00:00Z", usedPct: 100 }],
      },
      {
        providerId: "claude",
        windows: [{ resetsAt: "2026-10-03T13:00:00Z", usedPct: 100 }],
      },
    ],
  });
  await h.emit("agent.turn_ended", {
    agent,
    outcome: { kind: "completed" },
    timeline: [
      {
        text: "You've hit your session limit · resets 1pm (UTC)",
        type: "assistant_message",
      },
    ],
    turnId: "limited",
  });
  assert.equal(h.store().get(agent.id)?.resumeAt, "2026-10-03T13:02:00.000Z");
  assert.equal(h.store().get(agent.id)?.basis, "reset");
});

test("an estimated job rechecks expired usage and retains its job ID", async (t) => {
  const h = setup(t);
  h.behavior.usage = async () => ({ providers: [] });
  await h.limited("You've hit your usage limit");
  const original = h.stored();
  h.behavior.usage = async () => ({
    providers: [
      {
        providerId: "claude",
        windows: [{ resetsAt: "2026-10-03T15:00:00Z", usedPct: 100 }],
      },
    ],
  });
  await h.tick(301_000);
  assert.equal(h.sent.length, 0);
  assert.equal(h.store().get(agent.id)?.resumeAt, "2026-10-03T15:02:00.000Z");
  assert.equal(h.store().get(agent.id)?.basis, "reset");
  assert.equal(h.store().get(agent.id)?.rowId, original.rowId);
  assert.deepEqual(h.rows.at(-1), {
    rowId: original.rowId,
    state: "scheduled",
  });
});

test("cancelling during a usage recheck cannot restore the estimated job", async (t) => {
  const h = setup(t);
  h.behavior.usage = async () => ({ providers: [] });
  await h.limited("You've hit your usage limit");
  const gate = deferred();
  h.behavior.usage = async () => {
    await gate.promise;
    return {
      providers: [
        {
          providerId: "claude",
          windows: [{ resetsAt: "2026-10-03T15:00:00Z", usedPct: 100 }],
        },
      ],
    };
  };
  await h.tick(301_000);
  await h.act("cancel-resume", { agentId: agent.id });
  gate.resolve();
  await flush();
  assert.equal(h.store().get(agent.id), undefined);
  await h.tick(30 * 60_000);
  assert.equal(h.sent.length, 0);
});

test("a failed usage recheck retains the estimate and tries again", async (t) => {
  const h = setup(t);
  h.behavior.usage = async () => ({ providers: [] });
  await h.limited("You've hit your usage limit");
  const original = h.store().get(agent.id);
  h.behavior.usage = async () => {
    throw new Error("usage unavailable");
  };
  await h.tick(301_000);
  assert.deepEqual(h.store().get(agent.id), original);
  h.behavior.usage = async () => ({
    providers: [
      {
        providerId: "claude",
        windows: [{ resetsAt: "2026-10-03T15:00:00Z", usedPct: 100 }],
      },
    ],
  });
  await h.tick(301_000);
  assert.equal(h.store().get(agent.id)?.basis, "reset");
  assert.equal(h.sent.length, 0);
});

test("cancelling from the client drops the pending resume", async (t) => {
  const h = setup(t);
  await h.limited();
  const cancelled = await h.act("cancel-resume", { agentId: agent.id });
  assert.equal(cancelled.ok, true);
  assert.equal(h.store().get(agent.id), undefined);
  await h.tick();
  assert.equal(h.sent.length, 0);
  const repeated = await h.act("cancel-resume", { agentId: agent.id });
  assert.equal(repeated.ok, false);
});

test("resume now sends at once and clears the timer", async (t) => {
  const h = setup(t);
  h.behavior.send = async () => {
    await h.start();
  };
  await h.limited();
  assert.deepEqual(await h.act("resume-now", { agentId: agent.id }), {
    message: "Resumed.",
    ok: true,
  });
  assert.equal(h.sent.length, 1);
  await h.tick();
  assert.equal(h.sent.length, 1);
});

test("resume now reports a busy agent instead of interrupting it", async (t) => {
  const h = setup(t);
  await h.limited();
  h.setSnapshot({ archivedAt: null, status: "running" });
  const result = await h.act("resume-now", { agentId: agent.id });
  assert.equal(result.ok, false);
  assert.equal(h.sent.length, 0);
  assert.ok(h.store().get(agent.id));
});

test("a message turn preserves the original continuation after its reply", async (t) => {
  const h = setup(t);
  await h.limited();
  const pending = h.store().get(agent.id);
  await h.start("message");
  await h.emit("agent.turn_ended", {
    agent,
    outcome: { kind: "completed" },
    timeline: [],
    turnId: "message",
  });
  assert.deepEqual(h.store().get(agent.id), pending);
  assert.deepEqual(
    h.rows.map((row) => row.state),
    ["scheduled"]
  );
  h.behavior.send = async () => {
    await h.start();
  };
  await h.tick();
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].text, /Continue where you left off/u);
  assert.deepEqual(h.sent[0].options, { activeTurnBehavior: "steer" });
});

test("a message arriving during usage lookup does not discard the resume", async (t) => {
  const h = setup(t);
  const gate = deferred();
  const { usage } = h.behavior;
  h.behavior.usage = async () => {
    await gate.promise;
    return await usage();
  };
  const scheduled = h.limited();
  await h.start("message");
  gate.resolve();
  await scheduled;
  assert.ok(h.store().get(agent.id));
  await h.tick();
  assert.equal(h.sent.length, 1);
});

test("a message failure leaves the original resume scheduled", async (t) => {
  const h = setup(t);
  await h.limited();
  await h.start("message");
  await h.emit("agent.turn_ended", {
    agent,
    outcome: { error: { message: "Connection reset" }, kind: "failed" },
    timeline: [],
    turnId: "message",
  });
  assert.ok(h.store().get(agent.id));
  await h.tick();
  assert.equal(h.sent.length, 1);
});

for (const restored of [false, true]) {
  test(`a busy recipient retains its ${restored ? "restored" : "new"} resume until idle`, async (t) => {
    const h = setup(t, restored);
    if (!restored) {
      await h.limited();
    }
    const pending = h.stored();
    h.setSnapshot({ archivedAt: null, status: "running" });
    await h.tick(restored ? 0 : 121_000);
    assert.equal(h.sent.length, 0);
    assert.equal(h.store().get(agent.id)?.rowId, pending.rowId);
    assert.ok(Date.parse(h.stored().resumeAt) > Date.now());
    h.setSnapshot({ archivedAt: null, status: "idle" });
    await h.tick(300_000);
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.sent[0].options, { activeTurnBehavior: "steer" });
  });
}

test("a message starting during refresh defers the resume without losing it", async (t) => {
  const h = setup(t);
  const gate = deferred();
  h.behavior.refresh = async () => {
    await gate.promise;
  };
  await h.limited();
  await h.tick();
  await h.start("message");
  h.setSnapshot({ archivedAt: null, status: "running" });
  gate.resolve();
  await flush();
  assert.equal(h.sent.length, 0);
  assert.ok(h.store().get(agent.id));
  h.setSnapshot({ archivedAt: null, status: "idle" });
  await h.tick(300_000);
  assert.equal(h.sent.length, 1);
});

test("usage rechecks keep the resume while a message turn is running", async (t) => {
  const h = setup(t);
  h.behavior.usage = async () => ({ providers: [] });
  await h.limited("You've hit your usage limit");
  await h.start("message");
  h.setSnapshot({ archivedAt: null, provider: "claude", status: "running" });
  h.behavior.usage = async () => ({
    providers: [
      {
        providerId: "claude",
        windows: [{ resetsAt: "2026-10-03T15:00:00Z", usedPct: 100 }],
      },
    ],
  });
  await h.tick(301_000);
  assert.equal(h.sent.length, 0);
  assert.equal(h.store().get(agent.id)?.resumeAt, "2026-10-03T15:02:00.000Z");
});

test("an overdue resume retries as soon as the message turn ends", async (t) => {
  const h = setup(t);
  await h.limited();
  await h.start("message");
  h.setSnapshot({ archivedAt: null, status: "running" });
  await h.tick();
  const listed = await h.listPending();
  assert.equal(listed.entries[0].attempting, false);
  h.setSnapshot({ archivedAt: null, status: "idle" });
  await h.emit("agent.turn_ended", {
    agent,
    outcome: { kind: "completed" },
    timeline: [],
    turnId: "message",
  });
  h.behavior.send = async () => {
    await h.start();
  };
  await h.tick(0);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].id, agent.id);
  await h.tick(300_000);
  assert.equal(h.sent.length, 1);
});

test("Cancel while a message is running removes its deferred resume", async (t) => {
  const h = setup(t);
  await h.limited();
  await h.start("message");
  h.setSnapshot({ archivedAt: null, status: "running" });
  await h.tick();
  const cancelled = await h.act("cancel-resume", { agentId: agent.id });
  assert.equal(cancelled.ok, true);
  h.setSnapshot({ archivedAt: null, status: "idle" });
  await h.emit("agent.turn_ended", {
    agent,
    outcome: { kind: "completed" },
    timeline: [],
    turnId: "message",
  });
  await h.tick(300_000);
  assert.equal(h.sent.length, 0);
  assert.equal(h.store().get(agent.id), undefined);
});

test("Stop does not immediately restart a message turn", async (t) => {
  const h = setup(t);
  await h.limited();
  await h.start("message");
  h.setSnapshot({ archivedAt: null, status: "running" });
  await h.tick();
  h.setSnapshot({ archivedAt: null, status: "idle" });
  await h.emit("agent.turn_ended", {
    agent,
    outcome: { kind: "canceled", reason: "user stopped" },
    timeline: [],
    turnId: "message",
  });
  await h.tick(0);
  assert.equal(h.sent.length, 0);
  assert.ok(h.store().get(agent.id));
  await h.tick(300_000);
  assert.equal(h.sent.length, 1);
});

test("another limit reschedules the old row without cancelling auto-resume", async (t) => {
  const h = setup(t);
  await h.limited();
  const first = h.stored();
  await h.start("message");
  await h.limited();
  assert.notEqual(h.store().get(agent.id)?.rowId, first.rowId);
  assert.deepEqual(
    h.rows.map((row) => row.state),
    ["scheduled", "rescheduled", "scheduled"]
  );
  assert.equal(h.rows[1].rowId, first.rowId);
});

test("an earlier usage lookup cannot overwrite a later limit episode", async (t) => {
  const h = setup(t);
  const gate = deferred();
  let calls = 0;
  h.behavior.usage = async () => {
    calls += 1;
    if (calls === 1) {
      await gate.promise;
    }
    return { providers: [] };
  };
  const earlier = h.limited("You've hit your usage limit");
  await h.start("message");
  await h.limited();
  const latest = h.store().get(agent.id);
  gate.resolve();
  await earlier;
  assert.deepEqual(h.store().get(agent.id), latest);
});

test("each limit stop keeps its own chat row", async (t) => {
  const h = setup(t);
  h.behavior.send = async () => {
    await h.start();
  };
  await h.limited();
  await h.tick();
  await h.tick(1000);
  await h.limited();
  const [first, resumed, second] = h.rows;
  assert.deepEqual(
    [first.state, resumed.state, second.state],
    ["scheduled", "resumed", "scheduled"]
  );
  assert.equal(resumed.rowId, first.rowId);
  assert.notEqual(second.rowId, first.rowId);
});

test("resume now during a timed attempt sends one prompt", async (t) => {
  const h = setup(t);
  const gate = deferred();
  h.behavior.refresh = async () => {
    await gate.promise;
  };
  await h.limited();
  await h.tick();
  const manual = h.act("resume-now", { agentId: agent.id });
  gate.resolve();
  const result = await manual;
  assert.equal(result.ok, true);
  await flush();
  assert.equal(h.sent.length, 1);
});

test("a failed delivery is shown as a retry, not an unknown reset", async (t) => {
  const h = setup(t);
  h.behavior.send = async () => {
    throw new Error("disconnected");
  };
  await h.limited();
  await h.tick();
  const listed = await h.listPending();
  assert.equal(listed.entries[0].basis, "retry");
});

test("the pending list reports a real attempt until delivery settles", async (t) => {
  const h = setup(t);
  const gate = deferred();
  h.behavior.refresh = async () => {
    await gate.promise;
  };
  await h.limited();
  const beforeAttempt = await h.listPending();
  assert.equal(beforeAttempt.entries[0].attempting, false);
  await h.tick();
  const duringAttempt = await h.listPending();
  assert.equal(duringAttempt.entries[0].attempting, true);
  gate.reject(new Error("disconnected"));
  await flush();
  const {
    entries: [entry],
  } = await h.listPending();
  assert.equal(entry.attempting, false);
  assert.equal(entry.basis, "retry");
});

test("a renewed limit job is not consumed by the previous send in flight", async (t) => {
  const h = setup(t);
  const gate = deferred();
  h.behavior.send = async () => {
    await h.start();
    await h.limited();
    await gate.promise;
  };
  await h.limited();
  const first = h.act("resume-now", { agentId: agent.id });
  await flush();
  const listed = await h.listPending();
  assert.equal(listed.entries[0].attempting, false);
  await h.tick();
  assert.equal(h.sent.length, 1);
  h.behavior.send = async () => {};
  gate.resolve();
  await first;
  await flush();
  assert.equal(h.sent.length, 2);
  assert.equal(h.store().get(agent.id), undefined);
});

for (const action of ["resume-now", "cancel-resume"]) {
  test(`${action} from an old popover cannot affect a later limit episode`, async (t) => {
    const h = setup(t);
    await h.limited();
    const {
      entries: [{ jobId: oldJob }],
    } = await h.listPending();
    await h.start("manual");
    await h.limited();
    const next = h.store().get(agent.id);
    assert.notEqual(next?.rowId, oldJob);
    const result = await h.act(action, { agentId: agent.id, jobId: oldJob });
    assert.equal(result.ok, false);
    assert.match(result.message, /schedule changed/u);
    assert.deepEqual(h.store().get(agent.id), next);
    assert.equal(h.sent.length, 0);
    await h.tick();
    assert.equal(h.sent.length, 1);
  });
}

test("a queued attempt cannot resume a replacement job early", async (t) => {
  const h = setup(t);
  const gate = deferred();
  h.behavior.send = async () => {
    await h.start();
    await h.limited();
    await gate.promise;
  };
  await h.limited();
  const first = h.act("resume-now", { agentId: agent.id });
  await flush();
  await h.tick();
  await h.start("manual");
  await h.limited();
  const replacement = h.store().get(agent.id);
  h.behavior.send = async () => {};
  gate.resolve();
  await first;
  await flush();
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.store().get(agent.id), replacement);
  // The usage window is past, so the replacement uses the notice's reset.
  assert.ok(replacement);
  await h.tick(Date.parse(replacement.resumeAt) - Date.now());
  assert.equal(h.sent.length, 2);
});

test("the observed Codex quota failure resumes even when usage reports only 98 percent", async (t) => {
  const h = setup(t);
  const reset = new Date(2026, 9, 3, 16, 6);
  h.behavior.usage = async () => ({
    providers: [
      {
        providerId: "codex",
        windows: [{ resetsAt: reset.toISOString(), usedPct: 98 }],
      },
    ],
  });
  await h.emit("agent.turn_ended", {
    agent: { ...agent, provider: "codex" },
    outcome: {
      error: {
        message:
          "You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 4:06 PM.",
      },
      kind: "failed",
    },
    timeline: [],
    turnId: "codex-turn-5",
  });
  assert.equal(
    h.store().get(agent.id)?.resumeAt,
    new Date(+reset + 120_000).toISOString()
  );
  assert.equal(h.store().get(agent.id)?.basis, "reset");
  h.setSnapshot({ archivedAt: null, provider: "codex", status: "idle" });
  await h.tick(+reset + 120_000 - Date.now());
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0].options, { activeTurnBehavior: "steer" });
});
