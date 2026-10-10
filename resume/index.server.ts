import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

import type {
  PluginHookAgent,
  PluginServerContext,
  PluginTurnOutcome,
} from "@getpaseo/plugin/server";

import { connectDaemon } from "./server/connection.ts";
import {
  limitMessage,
  providerWindows,
  retryTimeFromMessage,
  retryTimeFromUsage,
} from "./server/limit.ts";
import { PendingStore } from "./server/pending.ts";
import type { PaseoAgentSendOptions, PaseoApi } from "./server/sdk.ts";
import { cancelResumeRpc, listPendingRpc, resumeNowRpc } from "./shared/rpc.ts";
import { STATUS_KIND, STATUS_ROW_ID } from "./shared/status.ts";
import type { ResumeStatus } from "./shared/status.ts";

const RESUME_PROMPT =
  "Your previous turn stopped on the provider usage limit, which has now reset. Continue where you left off.";
// Resume shortly after the reset rather than racing the provider's clock.
const AFTER_RESET_MS = 2 * 60_000;
// Used when neither the usage windows nor the message give a reset time.
const FALLBACK_MS = 30 * 60_000;
const RETRY_MS = 5 * 60_000;
// Paseo 0.10.3 caches provider usage for five minutes without a public refresh
// option. Recheck estimates after that cache has expired.
const USAGE_REFRESH_MS = 5 * 60_000 + 1000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
// Steer never interrupts a running turn and starts a normal one on an idle
// agent.
// SAFETY: the 0.10.3 SDK forwards this option but does not declare it.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The daemon accepts an option the SDK's send-options type omits.
const STEER = { activeTurnBehavior: "steer" } as PaseoAgentSendOptions;

type Outcome = "sent" | "skipped" | "retrying" | "busy";

const RESUME_NOW_RESULTS: Record<Outcome, { message: string; ok: boolean }> = {
  busy: {
    message:
      "The agent is working; auto-resume remains scheduled until its turn ends.",
    ok: false,
  },
  retrying: {
    message: "Could not reach the agent; the next attempt is in five minutes.",
    ok: false,
  },
  sent: { message: "Resumed.", ok: true },
  skipped: {
    message: "The agent is unavailable or the resume schedule changed.",
    ok: false,
  },
};

interface ResumeAttempt {
  parentId: string | null;
  rowId?: string;
  started: boolean;
  turnId: string | null;
}

const isArchived = (agent: { archivedAt?: string | null }) =>
  (agent.archivedAt ?? "") !== "";

// A parent can miss the child's finish notification after a limit stop
// (getpaseo/paseo#3875), so tell it directly in paseo-peer's envelope.
const notifyParent = async (
  parentId: string,
  childId: string,
  outcome: PluginTurnOutcome,
  api: PaseoApi
): Promise<void> => {
  const parent = api.agents.ref(parentId);
  await parent.refresh();
  if (parent.current() === null || isArchived(parent)) {
    return;
  }
  const result =
    outcome.kind === "failed" ? `failed: ${outcome.error.message}` : "finished";
  const text = `[from:${childId}]\nI resumed after the provider usage limit reset, and my turn has now ${result}.`;
  await parent.send(text, STEER);
};

export default function contribute(
  server: PluginServerContext,
  connect = connectDaemon
) {
  const paseoHome = process.env.PASEO_HOME ?? path.join(homedir(), ".paseo");
  const connection = connect(paseoHome);
  const pending = new PendingStore(paseoHome);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const usageTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Bumped whenever an agent's pending resume is cancelled, so a schedule()
  // still waiting on the usage lookup can tell it is stale.
  const epochs = new Map<string, number>();
  // Agents this plugin has just prompted, mapped to their parent.
  const resuming = new Map<string, ResumeAttempt>();
  // Plugin code reaches the SDK only through hook contexts.
  let paseo: PaseoApi | null = null;
  let disposed = false;
  // One attempt per agent at a time, so "Resume now" and the timer cannot both send.
  const inflight = new Map<
    string,
    { entry: ReturnType<PendingStore["get"]>; promise: Promise<Outcome> }
  >();

  const epochOf = (agentId: string) => epochs.get(agentId) ?? 0;

  // Each limit stop gets its own row, which later reads resumed or cancelled.
  const showStatus = async (
    agentId: string,
    rowId: string | undefined,
    status: ResumeStatus
  ): Promise<void> => {
    try {
      await paseo?.agents.ref(agentId).timeline.append({
        data: status,
        id: rowId ?? STATUS_ROW_ID,
        kind: STATUS_KIND,
        type: "plugin",
        version: 1,
      });
    } catch (error) {
      console.error(`Cannot show resume status for ${agentId}`, error);
    }
  };

  const invalidate = (agentId: string): number => {
    epochs.set(agentId, epochOf(agentId) + 1);
    clearTimeout(timers.get(agentId));
    timers.delete(agentId);
    clearTimeout(usageTimers.get(agentId));
    usageTimers.delete(agentId);
    return epochOf(agentId);
  };

  const cancel = (agentId: string, show: boolean): void => {
    invalidate(agentId);
    const entry = pending.get(agentId);
    if (pending.delete(agentId) && show) {
      void showStatus(agentId, entry?.rowId, {
        at: new Date().toISOString(),
        state: "cancelled",
      });
    }
  };

  const arm = (agentId: string, resumeAt: string): void => {
    clearTimeout(timers.get(agentId));
    const delay = Math.max(0, Date.parse(resumeAt) - Date.now());
    const fire = () => {
      if (Date.now() < Date.parse(resumeAt)) {
        arm(agentId, resumeAt);
      } else {
        void resume(agentId);
      }
    };
    timers.set(agentId, setTimeout(fire, Math.min(delay, MAX_TIMEOUT_MS)));
  };

  const armUsageCheck = (agentId: string): void => {
    clearTimeout(usageTimers.get(agentId));
    usageTimers.set(
      agentId,
      setTimeout(() => {
        void recheckUsage(agentId);
      }, USAGE_REFRESH_MS)
    );
  };

  // A usage recheck that finds no reset arms the next one, so the timer above
  // needs this function hoisted.
  // oxlint-disable-next-line func-style -- Hoisting breaks the armUsageCheck/recheckUsage cycle.
  async function recheckUsage(agentId: string): Promise<void> {
    usageTimers.delete(agentId);
    const entry = pending.get(agentId);
    if (!entry || entry.basis !== "estimate" || disposed) {
      return;
    }
    const epoch = epochOf(agentId);
    const current = () =>
      !disposed && epochOf(agentId) === epoch && pending.get(agentId) === entry;
    {
      try {
        const api = paseo ?? (await connection.get());
        if (!current()) {
          return;
        }
        const handle = api.agents.ref(agentId);
        await handle.refresh();
        if (!current()) {
          return;
        }
        const agent = handle.current();
        if (agent === null || isArchived(agent)) {
          cancel(agentId, false);
          return;
        }
        const usage = await api.providers.listUsage();
        if (!current()) {
          return;
        }
        const [provider] = agent.provider.split("/");
        const reset = retryTimeFromUsage(
          providerWindows(usage.providers, provider),
          new Date()
        );
        if (reset) {
          const resumeAt = new Date(
            reset.getTime() + AFTER_RESET_MS
          ).toISOString();
          pending.set(agentId, { ...entry, basis: "reset", resumeAt });
          arm(agentId, resumeAt);
          await showStatus(agentId, entry.rowId, {
            at: resumeAt,
            basis: "reset",
            state: "scheduled",
          });
          return;
        }
      } catch (error) {
        console.error(`Cannot refresh provider usage for ${agentId}`, error);
      }
    }
    if (current()) {
      armUsageCheck(agentId);
    }
  }

  const attemptResume = async (agentId: string): Promise<Outcome> => {
    timers.delete(agentId);
    clearTimeout(usageTimers.get(agentId));
    usageTimers.delete(agentId);
    const entry = pending.get(agentId);
    if (!entry || disposed) {
      return "skipped";
    }
    const epoch = epochOf(agentId);
    const current = () =>
      !disposed && epochOf(agentId) === epoch && pending.get(agentId) === entry;
    const attempt: ResumeAttempt = {
      parentId: entry.parentAgentId,
      rowId: entry.rowId,
      started: false,
      turnId: null,
    };
    try {
      const api = paseo ?? (await connection.get());
      if (!current()) {
        return "skipped";
      }
      const handle = api.agents.ref(agentId);
      await handle.refresh();
      if (!current()) {
        return "skipped";
      }
      const agent = handle.current();
      if (agent === null || isArchived(agent)) {
        cancel(agentId, false);
        return "skipped";
      }
      if (agent.status === "running") {
        const retryAt = new Date(Date.now() + RETRY_MS).toISOString();
        pending.set(agentId, { ...entry, basis: "retry", resumeAt: retryAt });
        arm(agentId, retryAt);
        await showStatus(agentId, entry.rowId, {
          at: retryAt,
          basis: "retry",
          state: "scheduled",
        });
        return "busy";
      }
      resuming.set(agentId, attempt);
      await handle.send(RESUME_PROMPT, STEER);
      // The started/ended hooks may already have consumed this job and even
      // scheduled a new limit retry while send() was awaiting its response.
      if (current()) {
        pending.delete(agentId);
      }
      return "sent";
    } catch (error) {
      if (resuming.get(agentId) === attempt && !attempt.started) {
        resuming.delete(agentId);
      }
      if (!current()) {
        return "skipped";
      }
      console.error(`Cannot resume agent ${agentId}; retrying later`, error);
      const retryAt = new Date(Date.now() + RETRY_MS).toISOString();
      pending.set(agentId, { ...entry, basis: "retry", resumeAt: retryAt });
      arm(agentId, retryAt);
      await showStatus(agentId, entry.rowId, {
        at: retryAt,
        basis: "retry",
        state: "scheduled",
      });
      return "retrying";
    }
  };

  // Forgets the attempt once it settles, so the next one can start.
  const settleAttempt = async (
    agentId: string,
    attempt: Promise<Outcome>
  ): Promise<Outcome> => {
    try {
      return await attempt;
    } finally {
      inflight.delete(agentId);
    }
  };

  // A due timer starts a resume, and a deferred or failed resume arms the next
  // timer, so arm() above needs this function hoisted.
  // oxlint-disable-next-line func-style -- Hoisting breaks the arm/resume cycle.
  async function resume(agentId: string): Promise<Outcome> {
    const entry = pending.get(agentId);
    const running = inflight.get(agentId);
    if (running) {
      if (running.entry === entry) {
        return await running.promise;
      }
      // A resumed turn may hit its limit again before the first send returns.
      // Its next timer must wait for that send, then attempt the new job.
      await running.promise;
      return disposed || pending.get(agentId) !== entry
        ? "skipped"
        : await resume(agentId);
    }
    const attempt = settleAttempt(agentId, attemptResume(agentId));
    inflight.set(agentId, { entry, promise: attempt });
    return await attempt;
  }

  const schedule = async (
    agent: PluginHookAgent,
    message: string,
    api: PaseoApi
  ): Promise<void> => {
    // A later limit stop supersedes any earlier lookup or delivery, while
    // ordinary messages leave the scheduled continuation intact.
    const epoch = invalidate(agent.id);
    const previous = pending.get(agent.id);
    const now = new Date();
    const [provider] = agent.provider.split("/");
    let resetAt: Date | null = null;
    try {
      const usage = await api.providers.listUsage();
      resetAt = retryTimeFromUsage(
        providerWindows(usage.providers, provider),
        now
      );
    } catch (error) {
      console.error("Cannot read provider usage", error);
    }
    // Cancellation, a later limit stop or plugin shutdown wins this lookup.
    if (disposed || epochOf(agent.id) !== epoch) {
      return;
    }
    resetAt ??= retryTimeFromMessage(message, now);
    const reset = resetAt !== null && resetAt > now ? resetAt : null;
    const basis = reset === null ? "estimate" : "reset";
    const resumeAt =
      reset === null
        ? new Date(now.getTime() + FALLBACK_MS)
        : new Date(reset.getTime() + AFTER_RESET_MS);
    const rowId = `resume-${randomUUID()}`;
    pending.set(agent.id, {
      basis,
      parentAgentId: agent.parentAgentId,
      resumeAt: resumeAt.toISOString(),
      rowId,
    });
    arm(agent.id, resumeAt.toISOString());
    if (basis === "estimate") {
      armUsageCheck(agent.id);
    }
    if (previous?.rowId !== undefined) {
      await showStatus(agent.id, previous.rowId, {
        at: resumeAt.toISOString(),
        basis,
        state: "rescheduled",
      });
      if (
        disposed ||
        epochOf(agent.id) !== epoch ||
        pending.get(agent.id)?.rowId !== rowId
      ) {
        return;
      }
    }
    await showStatus(agent.id, rowId, {
      at: resumeAt.toISOString(),
      basis,
      state: "scheduled",
    });
  };

  server.on("agent.turn_started", ({ agent, turnId }, context) => {
    ({ paseo } = context);
    const attempt = resuming.get(agent.id);
    if (attempt && !attempt.started) {
      attempt.started = true;
      attempt.turnId = turnId;
      cancel(agent.id, false);
      void showStatus(agent.id, attempt.rowId, {
        at: new Date().toISOString(),
        state: "resumed",
      });
    } else {
      // A message turn must not inherit our resume's parent notification.
      resuming.delete(agent.id);
    }
  });

  server.on(
    "agent.turn_ended",
    async ({ agent, turnId, outcome, timeline }, context) => {
      ({ paseo } = context);
      const attempt = resuming.get(agent.id);
      const wasResumed = attempt?.started === true && attempt.turnId === turnId;
      if (attempt && !attempt.started) {
        resuming.delete(agent.id);
      }
      if (wasResumed) {
        resuming.delete(agent.id);
      }
      const message = limitMessage(agent.provider, outcome, timeline);
      if (message === null) {
        const entry = pending.get(agent.id);
        if (
          outcome.kind !== "canceled" &&
          entry !== undefined &&
          (entry.basis === "retry" || Date.parse(entry.resumeAt) <= Date.now())
        ) {
          arm(agent.id, new Date().toISOString());
        }
        if (
          wasResumed &&
          attempt.parentId !== null &&
          outcome.kind !== "canceled"
        ) {
          await notifyParent(
            attempt.parentId,
            agent.id,
            outcome,
            context.paseo
          );
        }
      } else {
        await schedule(agent, message, context.paseo);
      }
    }
  );

  server.on("agent.archived", ({ agent }, context) => {
    ({ paseo } = context);
    resuming.delete(agent.id);
    cancel(agent.id, false);
  });

  server.handle(listPendingRpc, (_input, context) => {
    ({ paseo } = context);
    const entries = pending.all().map(([agentId, entry]) => ({
      agentId,
      attempting: inflight.get(agentId)?.entry === entry,
      basis: entry.basis ?? "reset",
      jobId: entry.rowId ?? entry.resumeAt,
      resumeAt: entry.resumeAt,
    }));
    return { entries };
  });

  server.handle(resumeNowRpc, async ({ agentId, jobId }, context) => {
    ({ paseo } = context);
    const entry = pending.get(agentId);
    if (!entry) {
      return {
        message: "No auto-resume is pending for this agent.",
        ok: false,
      };
    }
    if ((entry.rowId ?? entry.resumeAt) !== jobId) {
      return {
        message:
          "The resume schedule changed. Review the latest schedule and try again.",
        ok: false,
      };
    }
    clearTimeout(timers.get(agentId));
    return RESUME_NOW_RESULTS[await resume(agentId)];
  });

  server.handle(cancelResumeRpc, ({ agentId, jobId }, context) => {
    ({ paseo } = context);
    const entry = pending.get(agentId);
    if (!entry) {
      return {
        message: "No auto-resume is pending for this agent.",
        ok: false,
      };
    }
    if ((entry.rowId ?? entry.resumeAt) !== jobId) {
      return {
        message:
          "The resume schedule changed. Review the latest schedule and try again.",
        ok: false,
      };
    }
    cancel(agentId, true);
    return { message: "Auto-resume cancelled.", ok: true };
  });

  for (const [agentId, entry] of pending.all()) {
    arm(agentId, entry.resumeAt);
    if (entry.basis === "estimate") {
      armUsageCheck(agentId);
    }
  }

  return async () => {
    disposed = true;
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
    for (const timer of usageTimers.values()) {
      clearTimeout(timer);
    }
    usageTimers.clear();
    await connection.close();
  };
}
