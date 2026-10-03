import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PaseoAgentSendOptions, PaseoApi } from "@getpaseo/client";
import type { PluginHookAgent, PluginServerContext, PluginTurnOutcome } from "@getpaseo/plugin/server";
import { limitMessage, retryTimeFromMessage, retryTimeFromUsage } from "./server/limit.ts";
import { runCli } from "./server/cli.ts";
import { PendingStore } from "./server/pending.ts";
import { cancelResumeRpc, listPendingRpc, resumeNowRpc } from "./shared/rpc.ts";
import { STATUS_KIND, STATUS_ROW_ID, type ResumeStatus } from "./shared/status.ts";

const RESUME_PROMPT =
  "Your previous turn stopped on the provider usage limit, which has now reset. Continue where you left off.";
// Resume shortly after the reset rather than racing the provider's clock.
const AFTER_RESET_MS = 2 * 60_000;
// Used when neither the usage windows nor the message give a reset time.
const FALLBACK_MS = 30 * 60_000;
const RETRY_MS = 5 * 60_000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
// Steer never interrupts a running turn and starts a normal one on an idle
// agent. The 0.10.3 SDK forwards this option but does not declare it.
const STEER = { activeTurnBehavior: "steer" } as PaseoAgentSendOptions;

type Outcome = "sent" | "skipped" | "retrying";

export default function contribute(server: PluginServerContext) {
  const paseoHome = process.env.PASEO_HOME ?? join(homedir(), ".paseo");
  const pending = new PendingStore(paseoHome);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  // Bumped whenever an agent's pending resume is cancelled, so a schedule()
  // still waiting on the usage lookup can tell it is stale.
  const epochs = new Map<string, number>();
  // Agents this plugin has just prompted, mapped to their parent.
  const resuming = new Map<string, { parentId: string | null; rowId?: string; started: boolean; turnId: string | null }>();
  // Plugin code reaches the SDK only through hook contexts.
  let paseo: PaseoApi | null = null;
  let disposed = false;
  // One attempt per agent at a time, so "Resume now" and the timer cannot both send.
  const inflight = new Map<string, { entry: ReturnType<PendingStore["get"]>; promise: Promise<Outcome> }>();

  const epochOf = (agentId: string) => epochs.get(agentId) ?? 0;

  // Each limit stop gets its own row, which later reads resumed or cancelled.
  async function showStatus(agentId: string, rowId: string | undefined, status: ResumeStatus): Promise<void> {
    await paseo?.agents
      .ref(agentId)
      .timeline.append({ type: "plugin", id: rowId ?? STATUS_ROW_ID, kind: STATUS_KIND, version: 1, data: status })
      .catch((error: unknown) => console.error(`Cannot show resume status for ${agentId}`, error));
  }

  function arm(agentId: string, resumeAt: string): void {
    clearTimeout(timers.get(agentId));
    const delay = Math.max(0, Date.parse(resumeAt) - Date.now());
    const fire = () => void (Date.now() < Date.parse(resumeAt) ? arm(agentId, resumeAt) : resume(agentId));
    timers.set(agentId, setTimeout(fire, Math.min(delay, MAX_TIMEOUT_MS)));
  }

  function cancel(agentId: string, show: boolean): void {
    epochs.set(agentId, epochOf(agentId) + 1);
    clearTimeout(timers.get(agentId));
    timers.delete(agentId);
    const entry = pending.get(agentId);
    if (pending.delete(agentId) && show) {
      void showStatus(agentId, entry?.rowId, { state: "cancelled", at: new Date().toISOString() });
    }
  }

  function resume(agentId: string): Promise<Outcome> {
    const entry = pending.get(agentId);
    const running = inflight.get(agentId);
    if (running) {
      if (running.entry === entry) return running.promise;
      // A resumed turn may hit its limit again before the first send returns.
      // Its next timer must wait for that send, then attempt the new job.
      return running.promise.then(() => !disposed && pending.get(agentId) === entry ? resume(agentId) : "skipped");
    }
    const attempt = attemptResume(agentId).finally(() => inflight.delete(agentId));
    inflight.set(agentId, { entry, promise: attempt });
    return attempt;
  }

  async function attemptResume(agentId: string): Promise<Outcome> {
    timers.delete(agentId);
    const entry = pending.get(agentId);
    if (!entry || disposed) return "skipped";
    const epoch = epochOf(agentId);
    const current = () => !disposed && epochOf(agentId) === epoch && pending.get(agentId) === entry;
    const attempt = { parentId: entry.parentAgentId, rowId: entry.rowId, started: false, turnId: null as string | null };
    try {
      if (paseo) {
        const handle = paseo.agents.ref(agentId);
        await handle.refresh();
        if (!current()) return "skipped";
        const agent = handle.current();
        if (!agent || agent.archivedAt || agent.status === "running") {
          cancel(agentId, Boolean(agent && !agent.archivedAt));
          return "skipped";
        }
      } else {
        // A restored job can outlive its agent or race a user's new turn.
        const stdout = await runCli(paseoHome, ["agent", "inspect", agentId, "--json"]);
        if (!current()) return "skipped";
        const agent = JSON.parse(stdout);
        if (agent.Archived || agent.Status === "running") {
          cancel(agentId, !agent.Archived);
          return "skipped";
        }
      }
      resuming.set(agentId, attempt);
      if (paseo) {
        await paseo.agents.ref(agentId).send(RESUME_PROMPT, STEER);
      } else {
        await runCli(paseoHome, ["send", "--no-wait", agentId, RESUME_PROMPT]);
      }
      // The started/ended hooks may already have consumed this job and even
      // scheduled a new limit retry while send() was awaiting its response.
      if (current()) pending.delete(agentId);
      return "sent";
    } catch (error) {
      if (resuming.get(agentId) === attempt && !attempt.started) resuming.delete(agentId);
      if (!current()) return "skipped";
      console.error(`Cannot resume agent ${agentId}; retrying later`, error);
      const retryAt = new Date(Date.now() + RETRY_MS).toISOString();
      pending.set(agentId, { ...entry, resumeAt: retryAt, basis: "retry" });
      arm(agentId, retryAt);
      await showStatus(agentId, entry.rowId, { state: "scheduled", at: retryAt, basis: "retry" });
      return "retrying";
    }
  }

  async function schedule(agent: PluginHookAgent, message: string, api: PaseoApi): Promise<void> {
    const epoch = epochOf(agent.id);
    const now = new Date();
    const provider = agent.provider.split("/")[0];
    let resetAt: Date | null = null;
    try {
      const usage = await api.providers.listUsage();
      const windows = usage.providers.find((entry) => entry.providerId === provider)?.windows ?? [];
      resetAt = retryTimeFromUsage(windows, now);
    } catch (error) {
      console.error("Cannot read provider usage", error);
    }
    // A new turn, an archive or a plugin stop during the lookup wins.
    if (disposed || epochOf(agent.id) !== epoch) return;
    resetAt ??= retryTimeFromMessage(message, now);
    const basis = !resetAt || resetAt <= now ? "estimate" : "reset";
    const resumeAt = basis === "estimate"
      ? new Date(now.getTime() + FALLBACK_MS)
      : new Date(resetAt!.getTime() + AFTER_RESET_MS);
    const rowId = `resume-${randomUUID()}`;
    pending.set(agent.id, { resumeAt: resumeAt.toISOString(), parentAgentId: agent.parentAgentId, basis, rowId });
    arm(agent.id, resumeAt.toISOString());
    await showStatus(agent.id, rowId, { state: "scheduled", at: resumeAt.toISOString(), basis });
  }

  // A parent can miss the child's finish notification after a limit stop
  // (getpaseo/paseo#3875), so tell it directly in paseo-peer's envelope.
  async function notifyParent(parentId: string, childId: string, outcome: PluginTurnOutcome, api: PaseoApi) {
    const parent = api.agents.ref(parentId);
    await parent.refresh();
    if (!parent.current() || parent.archivedAt) return;
    const result = outcome.kind === "failed" ? `failed: ${outcome.error.message}` : "finished";
    const text = `[from:${childId}]\nI resumed after the provider usage limit reset, and my turn has now ${result}.`;
    await parent.send(text, STEER);
  }

  server.on("agent.turn_started", ({ agent, turnId }, context) => {
    paseo = context.paseo;
    const attempt = resuming.get(agent.id);
    if (attempt && !attempt.started) {
      attempt.started = true;
      attempt.turnId = turnId;
      cancel(agent.id, false);
      void showStatus(agent.id, attempt.rowId, { state: "resumed", at: new Date().toISOString() });
    } else {
      // Only the first start acknowledges our send; a subsequent start is a
      // user's replacement turn and must not inherit its parent notification.
      resuming.delete(agent.id);
      cancel(agent.id, true);
    }
  });

  server.on("agent.turn_ended", async ({ agent, turnId, outcome, timeline }, context) => {
    paseo = context.paseo;
    const attempt = resuming.get(agent.id);
    const wasResumed = attempt && (!attempt.started || attempt.turnId === turnId);
    if (wasResumed) resuming.delete(agent.id);
    const message = limitMessage(agent.provider, outcome, timeline);
    if (message) {
      await schedule(agent, message, context.paseo);
    } else if (wasResumed && attempt.parentId && outcome.kind !== "canceled") {
      await notifyParent(attempt.parentId, agent.id, outcome, context.paseo);
    }
  });

  server.on("agent.archived", ({ agent }, context) => {
    paseo = context.paseo;
    resuming.delete(agent.id);
    cancel(agent.id, false);
  });

  server.handle(listPendingRpc, (_input, context) => {
    paseo = context.paseo;
    const entries = pending.all().map(([agentId, entry]) => ({
      agentId,
      resumeAt: entry.resumeAt,
      basis: entry.basis ?? "reset",
      attempting: inflight.get(agentId)?.entry === entry,
      jobId: entry.rowId ?? entry.resumeAt,
    }));
    return { entries };
  });

  server.handle(resumeNowRpc, async ({ agentId, jobId }, context) => {
    paseo = context.paseo;
    const entry = pending.get(agentId);
    if (!entry) return { ok: false, message: "No auto-resume is pending for this agent." };
    if ((entry.rowId ?? entry.resumeAt) !== jobId) return { ok: false, message: "The resume schedule changed. Review the latest schedule and try again." };
    clearTimeout(timers.get(agentId));
    switch (await resume(agentId)) {
      case "sent":
        return { ok: true, message: "Resumed." };
      case "retrying":
        return { ok: false, message: "Could not reach the agent; the next attempt is in five minutes." };
      default:
        return { ok: false, message: "The agent is already working or was archived, so auto-resume was cancelled." };
    }
  });

  server.handle(cancelResumeRpc, ({ agentId, jobId }, context) => {
    paseo = context.paseo;
    const entry = pending.get(agentId);
    if (!entry) return { ok: false, message: "No auto-resume is pending for this agent." };
    if ((entry.rowId ?? entry.resumeAt) !== jobId) return { ok: false, message: "The resume schedule changed. Review the latest schedule and try again." };
    cancel(agentId, true);
    return { ok: true, message: "Auto-resume cancelled." };
  });

  for (const [agentId, entry] of pending.all()) arm(agentId, entry.resumeAt);

  return () => {
    disposed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}
