import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import type { PaseoApi } from "./sdk.ts";
import type { PluginServerContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import contribute from "../index.server.ts";
import { PendingStore } from "./pending.ts";

const NOW = new Date("2026-10-03T12:00:00Z");
const agent = { id: "child", parentAgentId: "parent", provider: "claude", cwd: "/tmp", title: "test", workspaceId: null };
const notice = "You've hit your session limit · resets 3:40pm (UTC)";
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(t: TestContext, restored = false) {
  const root = mkdtempSync(join(tmpdir(), "paseo-resume-test-"));
  const oldHome = process.env.PASEO_HOME;
  const oldState = process.env.XDG_STATE_HOME;
  process.env.PASEO_HOME = root;
  process.env.XDG_STATE_HOME = root;
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  t.mock.method(console, "error", () => {});
  const store = () => new PendingStore(root);
  if (restored) store().set(agent.id, { resumeAt: NOW.toISOString(), parentAgentId: agent.parentAgentId });
  const hooks = new Map<string, (event: any, context: any) => unknown>();
  const sent: { id: string; text: string; options: unknown }[] = [];
  const rows: { rowId: string; state: string }[] = [];
  let snapshot: { status: string; archivedAt: string | null; provider?: string } | null = { status: "idle", archivedAt: null, provider: "claude" };
  const behavior = {
    usage: async () => ({ providers: [{ providerId: "claude", windows: [{ usedPct: 100, resetsAt: new Date(+NOW + 1000).toISOString() }] }] }),
    refresh: async () => {},
    send: async () => {},
  };
  const api = {
    providers: { listUsage: () => behavior.usage() },
    agents: { ref: (id: string) => ({
      refresh: () => behavior.refresh(), current: () => snapshot,
      get archivedAt() { return snapshot?.archivedAt; },
      timeline: { append: async (row: { id: string; data: { state: string } }) => { rows.push({ rowId: row.id, state: row.data.state }); } },
      send: async (text: string, options: unknown) => {
        sent.push({ id, text, options });
        if (id === agent.id) await behavior.send();
      },
    }) },
  } as unknown as PaseoApi;
  const rpcs = new Map<string, (input: any, context: any) => unknown>();
  const stop = contribute({
    on: (name: string, handler: any) => hooks.set(name, handler),
    handle: (contract: { name: string }, handler: any) => rpcs.set(contract.name, handler),
  } as unknown as PluginServerContext);
  t.after(() => {
    stop();
    if (oldHome === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = oldHome;
    if (oldState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = oldState;
    rmSync(root, { recursive: true, force: true });
  });
  const emit = async <K extends keyof PluginLifecycleEvents>(name: K, event: PluginLifecycleEvents[K]) => {
    await hooks.get(name)!(event, { paseo: api });
  };
  const limited = (text = notice) => emit("agent.turn_ended", { agent, turnId: "limited", outcome: { kind: "completed" }, timeline: [{ type: "assistant_message", text }] });
  const start = (turnId = "resumed") => emit("agent.turn_started", { agent, turnId });
  const archive = () => emit("agent.archived", { agent, archivedAt: NOW.toISOString() });
  const tick = async (ms = 121_000) => { t.mock.timers.tick(ms); await flush(); };
  const call = (name: string, input: object = {}) => {
    const entry = store().get(agent.id);
    const action = name === "resume-now" || name === "cancel-resume";
    return rpcs.get(name)!({ ...(action ? { jobId: entry?.rowId ?? entry?.resumeAt } : {}), ...input }, { paseo: api }) as Promise<any>;
  };
  return { call, rows, stop, sent, behavior, store, emit, limited, start, archive, tick, setSnapshot: (value: typeof snapshot) => { snapshot = value; } };
}

for (const action of ["start", "archive", "stop"] as const) {
  test(`${action} during usage lookup invalidates the schedule`, async (t) => {
    const h = setup(t);
    const gate = deferred();
    const usage = h.behavior.usage;
    h.behavior.usage = async () => { await gate.promise; return usage(); };
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
  h.behavior.send = async () => { throw new Error("disconnected"); };
  await h.limited();
  await h.tick();
  assert.equal(h.store().get(agent.id)?.resumeAt, new Date(+NOW + 121_000 + 300_000).toISOString());
  h.behavior.send = async () => { await h.start(); };
  await h.tick(300_000);
  assert.equal(h.sent.length, 2);
  assert.deepEqual(h.sent[1].options, { activeTurnBehavior: "steer" });
  assert.equal(h.store().get(agent.id), undefined);
});

test("a failed refresh retries instead of discarding the job", async (t) => {
  const h = setup(t);
  h.behavior.refresh = async () => { throw new Error("disconnected"); };
  await h.limited();
  await h.tick();
  assert.ok(h.store().get(agent.id));
  h.behavior.refresh = async () => {};
  await h.tick(300_000);
  assert.equal(h.sent.length, 1);
});

for (const action of ["start", "archive", "stop"] as const) {
  test(`${action} during refresh prevents delivery`, async (t) => {
    const h = setup(t);
    const gate = deferred();
    h.behavior.refresh = () => gate.promise;
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
  h.behavior.send = () => gate.promise;
  await h.limited();
  await h.tick();
  await h.archive();
  gate.reject(new Error("disconnected"));
  await flush();
  assert.equal(h.store().get(agent.id), undefined);
});

test("a fast repeated limit is not deleted by the earlier send response", async (t) => {
  const h = setup(t);
  h.behavior.send = async () => { await h.start(); await h.limited(); };
  await h.limited();
  await h.tick();
  assert.ok(h.store().get(agent.id));
});

for (const state of [null, { status: "running", archivedAt: null }, { status: "idle", archivedAt: NOW.toISOString() }]) {
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
  h.behavior.send = () => h.start();
  await h.limited();
  await h.tick();
  await h.emit("agent.turn_ended", { agent, turnId: "resumed", outcome: { kind: "failed", error: { message: "Connection reset" } }, timeline: [] });
  assert.equal(h.sent[1].id, "parent");
  assert.match(h.sent[1].text, /failed: Connection reset/);
  assert.deepEqual(h.sent[1].options, { activeTurnBehavior: "steer" });
});

test("a replacement turn does not inherit the resumed turn notification", async (t) => {
  const h = setup(t);
  h.behavior.send = () => h.start();
  await h.limited();
  await h.tick();
  await h.start("replacement");
  await h.emit("agent.turn_ended", { agent, turnId: "replacement", outcome: { kind: "completed" }, timeline: [] });
  assert.equal(h.sent.length, 1);
});

test("a restored job survives CLI failure and retries without an SDK context", async (t) => {
  const h = setup(t, true);
  let fail = true;
  let sends = 0;
  t.mock.method(childProcess, "execFile", (...args: any[]) => {
    const callback = args.at(-1);
    const argv = args[1] as string[];
    if (argv.includes("inspect")) {
      queueMicrotask(() => callback(null, JSON.stringify({ Status: "idle", Archived: false }), ""));
    } else {
      sends++;
      queueMicrotask(() => callback(fail ? new Error("CLI unavailable") : null, "", ""));
    }
    return {};
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await h.tick(0);
  assert.ok(h.store().get(agent.id));
  assert.equal(sends, 1);
  fail = false;
  await h.tick(300_000);
  assert.equal(sends, 2);
  assert.equal(h.store().get(agent.id), undefined);
});

for (const snapshot of [{ Status: "running", Archived: false }, { Status: "idle", Archived: true }]) {
  test(`a restored job skips an unavailable CLI recipient: ${JSON.stringify(snapshot)}`, async (t) => {
    const h = setup(t, true);
    const calls: string[][] = [];
    t.mock.method(childProcess, "execFile", (...args: any[]) => {
      calls.push(args[1]);
      queueMicrotask(() => args.at(-1)(null, JSON.stringify(snapshot), ""));
      return {};
    });
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    await h.tick(0);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes("inspect"));
    assert.equal(h.store().get(agent.id), undefined);
  });
}

test("the pending list reports the resume time and whether it is a guess", async (t) => {
  const h = setup(t);
  await h.limited();
  assert.deepEqual(await h.call("list-pending"), {
    entries: [{ agentId: agent.id, jobId: h.store().get(agent.id)!.rowId, resumeAt: new Date(+NOW + 121_000).toISOString(), basis: "reset", attempting: false }],
  });
  h.behavior.usage = async () => ({ providers: [] });
  await h.limited("You've hit your usage limit");
  assert.equal((await h.call("list-pending")).entries[0].basis, "estimate");
});

test("Claude's zoned notice schedules a known reset with two minutes of margin", async (t) => {
  const h = setup(t);
  h.behavior.usage = async () => ({ providers: [] });
  await h.emit("agent.turn_ended", {
    agent, turnId: "limited", outcome: { kind: "completed" },
    timeline: [{ type: "assistant_message", text: "You've hit your session limit · resets 11:40pm (Europe/Minsk)" }],
  });
  assert.equal(h.store().get(agent.id)?.resumeAt, "2026-10-03T20:42:00.000Z");
  assert.equal(h.store().get(agent.id)?.basis, "reset");
});

test("an estimated job rechecks expired usage and retains its job ID", async (t) => {
  const h = setup(t);
  h.behavior.usage = async () => ({ providers: [] });
  await h.limited("You've hit your usage limit");
  const original = h.store().get(agent.id)!;
  h.behavior.usage = async () => ({ providers: [{ providerId: "claude", windows: [{ usedPct: 100, resetsAt: "2026-10-03T15:00:00Z" }] }] });
  await h.tick(301_000);
  assert.equal(h.sent.length, 0);
  assert.equal(h.store().get(agent.id)?.resumeAt, "2026-10-03T15:02:00.000Z");
  assert.equal(h.store().get(agent.id)?.basis, "reset");
  assert.equal(h.store().get(agent.id)?.rowId, original.rowId);
  assert.deepEqual(h.rows.at(-1), { rowId: original.rowId, state: "scheduled" });
});

test("cancelling during a usage recheck cannot restore the estimated job", async (t) => {
  const h = setup(t);
  h.behavior.usage = async () => ({ providers: [] });
  await h.limited("You've hit your usage limit");
  const gate = deferred();
  h.behavior.usage = async () => { await gate.promise; return { providers: [{ providerId: "claude", windows: [{ usedPct: 100, resetsAt: "2026-10-03T15:00:00Z" }] }] }; };
  await h.tick(301_000);
  await h.call("cancel-resume", { agentId: agent.id });
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
  h.behavior.usage = async () => { throw new Error("usage unavailable"); };
  await h.tick(301_000);
  assert.deepEqual(h.store().get(agent.id), original);
  h.behavior.usage = async () => ({ providers: [{ providerId: "claude", windows: [{ usedPct: 100, resetsAt: "2026-10-03T15:00:00Z" }] }] });
  await h.tick(301_000);
  assert.equal(h.store().get(agent.id)?.basis, "reset");
  assert.equal(h.sent.length, 0);
});

test("cancelling from the client drops the pending resume", async (t) => {
  const h = setup(t);
  await h.limited();
  assert.equal((await h.call("cancel-resume", { agentId: agent.id })).ok, true);
  assert.equal(h.store().get(agent.id), undefined);
  await h.tick();
  assert.equal(h.sent.length, 0);
  assert.equal((await h.call("cancel-resume", { agentId: agent.id })).ok, false);
});

test("resume now sends at once and clears the timer", async (t) => {
  const h = setup(t);
  h.behavior.send = () => h.start();
  await h.limited();
  assert.deepEqual(await h.call("resume-now", { agentId: agent.id }), { ok: true, message: "Resumed." });
  assert.equal(h.sent.length, 1);
  await h.tick();
  assert.equal(h.sent.length, 1);
});

test("resume now reports a busy agent instead of interrupting it", async (t) => {
  const h = setup(t);
  await h.limited();
  h.setSnapshot({ status: "running", archivedAt: null });
  assert.equal((await h.call("resume-now", { agentId: agent.id })).ok, false);
  assert.equal(h.sent.length, 0);
});

test("each limit stop keeps its own chat row", async (t) => {
  const h = setup(t);
  h.behavior.send = () => h.start();
  await h.limited();
  await h.tick();
  await h.tick(1000);
  await h.limited();
  const [first, resumed, second] = h.rows;
  assert.deepEqual([first.state, resumed.state, second.state], ["scheduled", "resumed", "scheduled"]);
  assert.equal(resumed.rowId, first.rowId);
  assert.notEqual(second.rowId, first.rowId);
});

test("resume now during a timed attempt sends one prompt", async (t) => {
  const h = setup(t);
  const gate = deferred();
  h.behavior.refresh = () => gate.promise;
  await h.limited();
  await h.tick();
  const manual = h.call("resume-now", { agentId: agent.id });
  gate.resolve();
  assert.equal((await manual).ok, true);
  await flush();
  assert.equal(h.sent.length, 1);
});

test("a failed delivery is shown as a retry, not an unknown reset", async (t) => {
  const h = setup(t);
  h.behavior.send = async () => { throw new Error("disconnected"); };
  await h.limited();
  await h.tick();
  assert.equal((await h.call("list-pending")).entries[0].basis, "retry");
});

test("the pending list reports a real attempt until delivery settles", async (t) => {
  const h = setup(t);
  const gate = deferred();
  h.behavior.refresh = () => gate.promise;
  await h.limited();
  assert.equal((await h.call("list-pending")).entries[0].attempting, false);
  await h.tick();
  assert.equal((await h.call("list-pending")).entries[0].attempting, true);
  gate.reject(new Error("disconnected"));
  await flush();
  const entry = (await h.call("list-pending")).entries[0];
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
  const first = h.call("resume-now", { agentId: agent.id });
  await flush();
  assert.equal((await h.call("list-pending")).entries[0].attempting, false);
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
    const oldJob = (await h.call("list-pending")).entries[0].jobId;
    await h.start("manual");
    await h.limited();
    const next = h.store().get(agent.id);
    assert.notEqual(next?.rowId, oldJob);
    const result = await h.call(action, { agentId: agent.id, jobId: oldJob });
    assert.equal(result.ok, false);
    assert.match(result.message, /schedule changed/);
    assert.deepEqual(h.store().get(agent.id), next);
    assert.equal(h.sent.length, 0);
    await h.tick();
    assert.equal(h.sent.length, 1);
  });
}

test("a queued attempt cannot resume a replacement job early", async (t) => {
  const h = setup(t);
  const gate = deferred();
  h.behavior.send = async () => { await h.start(); await h.limited(); await gate.promise; };
  await h.limited();
  const first = h.call("resume-now", { agentId: agent.id });
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
  await h.tick(Date.parse(replacement!.resumeAt) - Date.now());
  assert.equal(h.sent.length, 2);
});
