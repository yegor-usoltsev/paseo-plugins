import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

import type { PaseoApi } from "@getpaseo/client";
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
import type { PendingResume } from "./server/pending.ts";
import { cancelResumeRpc, listPendingRpc, resumeNowRpc } from "./shared/rpc.ts";

const RESUME_PROMPT =
  "Your previous turn stopped on the provider usage limit. Continue where you left off.";
const AFTER_RESET_MS = 2 * 60_000;
const FALLBACK_MS = 30 * 60_000;
const RETRY_MS = 5 * 60_000;
const USAGE_REFRESH_MS = 5 * 60_000 + 1000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const RESULTS = {
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
    message: "The agent is unavailable or its resume schedule changed.",
    ok: false,
  },
};
type Outcome = keyof typeof RESULTS;

interface ResumeAttempt {
  parentId: string | null;
  started: boolean;
  turnId: string | null;
}

const notifyParent = async (
  parentId: string,
  childId: string,
  outcome: PluginTurnOutcome,
  api: PaseoApi
): Promise<void> => {
  const parent = api.agents.ref(parentId);
  await parent.refresh();
  if (parent.current() === null || (parent.archivedAt ?? "") !== "") {
    return;
  }
  const result =
    outcome.kind === "failed" ? `failed: ${outcome.error.message}` : "finished";
  await parent.send(
    `I resumed after the provider usage limit, and my turn has now ${result}.`,
    { activeTurnBehavior: "steer", sourceAgentId: childId }
  );
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
  const resuming = new Map<string, ResumeAttempt>();
  const inflight = new Map<
    string,
    { entry: PendingResume | undefined; promise: Promise<Outcome> }
  >();
  let paseo: PaseoApi | null = null;
  let disposed = false;

  const current = (agentId: string, entry: PendingResume) =>
    !disposed && pending.get(agentId) === entry;

  const clearTimers = (agentId: string): void => {
    clearTimeout(timers.get(agentId));
    timers.delete(agentId);
    clearTimeout(usageTimers.get(agentId));
    usageTimers.delete(agentId);
  };

  const cancel = (agentId: string): void => {
    clearTimers(agentId);
    pending.delete(agentId);
  };

  const arm = (agentId: string, resumeAt: string): void => {
    clearTimeout(timers.get(agentId));
    const delay = Math.max(0, Date.parse(resumeAt) - Date.now());
    const fire = () => {
      if (Date.now() < Date.parse(resumeAt)) {
        arm(agentId, resumeAt);
      } else {
        // oxlint-disable-next-line no-use-before-define -- The timer fires after resume() exists.
        void resume(agentId);
      }
    };
    timers.set(agentId, setTimeout(fire, Math.min(delay, MAX_TIMEOUT_MS)));
  };

  const retry = (agentId: string, entry: PendingResume): void => {
    const resumeAt = new Date(Date.now() + RETRY_MS).toISOString();
    pending.set(agentId, { ...entry, basis: "retry", resumeAt });
    arm(agentId, resumeAt);
  };

  const armUsageCheck = (agentId: string): void => {
    clearTimeout(usageTimers.get(agentId));
    usageTimers.set(
      agentId,
      setTimeout(() => {
        // oxlint-disable-next-line no-use-before-define -- The timer fires after recheckUsage() exists.
        void recheckUsage(agentId);
      }, USAGE_REFRESH_MS)
    );
  };

  const recheckUsage = async (agentId: string): Promise<void> => {
    usageTimers.delete(agentId);
    const entry = pending.get(agentId);
    if (!entry || entry.basis !== "estimate" || disposed) {
      return;
    }
    try {
      const api = paseo ?? (await connection.get());
      if (!current(agentId, entry)) {
        return;
      }
      const handle = api.agents.ref(agentId);
      await handle.refresh();
      if (!current(agentId, entry)) {
        return;
      }
      const agent = handle.current();
      if (agent === null || (agent.archivedAt ?? "") !== "") {
        cancel(agentId);
        return;
      }
      const usage = await api.providers.listUsage();
      if (!current(agentId, entry)) {
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
        return;
      }
    } catch (error) {
      console.error(`Cannot refresh provider usage for ${agentId}`, error);
    }
    if (current(agentId, entry)) {
      armUsageCheck(agentId);
    }
  };

  const attemptResume = async (agentId: string): Promise<Outcome> => {
    clearTimers(agentId);
    const entry = pending.get(agentId);
    if (!entry || disposed) {
      return "skipped";
    }
    const attempt: ResumeAttempt = {
      parentId: entry.parentAgentId,
      started: false,
      turnId: null,
    };
    try {
      const api = paseo ?? (await connection.get());
      if (!current(agentId, entry)) {
        return "skipped";
      }
      const handle = api.agents.ref(agentId);
      await handle.refresh();
      if (!current(agentId, entry)) {
        return "skipped";
      }
      const agent = handle.current();
      if (agent === null || (agent.archivedAt ?? "") !== "") {
        cancel(agentId);
        return "skipped";
      }
      if (agent.status === "running") {
        retry(agentId, entry);
        return "busy";
      }
      resuming.set(agentId, attempt);
      await handle.send(RESUME_PROMPT, { activeTurnBehavior: "steer" });
      if (current(agentId, entry)) {
        pending.delete(agentId);
      }
      return "sent";
    } catch (error) {
      if (resuming.get(agentId) === attempt && !attempt.started) {
        resuming.delete(agentId);
      }
      if (!current(agentId, entry)) {
        return "skipped";
      }
      console.error(`Cannot resume agent ${agentId}; retrying later`, error);
      retry(agentId, entry);
      return "retrying";
    }
  };

  const resume = async (agentId: string): Promise<Outcome> => {
    const entry = pending.get(agentId);
    const running = inflight.get(agentId);
    if (running) {
      if (running.entry === entry) {
        return await running.promise;
      }
      await running.promise;
      return disposed || pending.get(agentId) !== entry
        ? "skipped"
        : await resume(agentId);
    }
    const promise = attemptResume(agentId);
    inflight.set(agentId, { entry, promise });
    try {
      return await promise;
    } finally {
      inflight.delete(agentId);
    }
  };

  const schedule = async (
    agent: PluginHookAgent,
    message: string,
    api: PaseoApi
  ): Promise<void> => {
    clearTimers(agent.id);
    const now = new Date();
    const entry: PendingResume = {
      basis: "estimate",
      parentAgentId: agent.parentAgentId,
      resumeAt: new Date(now.getTime() + FALLBACK_MS).toISOString(),
      rowId: randomUUID(),
      workspaceId: agent.workspaceId,
    };
    pending.set(agent.id, entry);
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
    if (!current(agent.id, entry)) {
      return;
    }
    resetAt ??= retryTimeFromMessage(message, now);
    const scheduled: PendingResume =
      resetAt && resetAt > now
        ? {
            ...entry,
            basis: "reset",
            resumeAt: new Date(
              resetAt.getTime() + AFTER_RESET_MS
            ).toISOString(),
          }
        : entry;
    if (scheduled !== entry) {
      pending.set(agent.id, scheduled);
    }
    arm(agent.id, scheduled.resumeAt);
    if (scheduled.basis === "estimate") {
      armUsageCheck(agent.id);
    }
  };

  server.on("agent.turn_started", ({ agent, turnId }, context) => {
    ({ paseo } = context);
    const attempt = resuming.get(agent.id);
    if (attempt && !attempt.started) {
      attempt.started = true;
      attempt.turnId = turnId;
      cancel(agent.id);
    } else {
      resuming.delete(agent.id);
    }
  });

  server.on(
    "agent.turn_ended",
    async ({ agent, turnId, outcome, timeline }, context) => {
      ({ paseo } = context);
      const attempt = resuming.get(agent.id);
      const wasResumed = attempt?.started === true && attempt.turnId === turnId;
      if (attempt && (!attempt.started || wasResumed)) {
        resuming.delete(agent.id);
      }
      const message = limitMessage(agent.provider, outcome, timeline);
      if (message !== null) {
        await schedule(agent, message, paseo);
        return;
      }
      const entry = pending.get(agent.id);
      if (
        outcome.kind !== "canceled" &&
        entry &&
        (entry.basis === "retry" || Date.parse(entry.resumeAt) <= Date.now())
      ) {
        arm(agent.id, new Date().toISOString());
      }
      if (
        wasResumed &&
        attempt.parentId !== null &&
        outcome.kind !== "canceled"
      ) {
        await notifyParent(attempt.parentId, agent.id, outcome, paseo);
      }
    }
  );

  server.on("agent.archived", ({ agent }) => {
    resuming.delete(agent.id);
    cancel(agent.id);
  });

  server.handle(listPendingRpc, async (_input, context) => {
    ({ paseo } = context);
    const entries = await Promise.all(
      pending.all().map(async ([agentId, entry]) => {
        let { workspaceId } = entry;
        if (workspaceId === null) {
          const agent = context.paseo.agents.ref(agentId);
          await agent.refresh();
          ({ workspaceId } = agent);
        }
        return {
          agentId,
          attempting: inflight.get(agentId)?.entry === entry,
          basis: entry.basis,
          jobId: entry.rowId,
          resumeAt: entry.resumeAt,
          workspaceId,
        };
      })
    );
    return { entries };
  });

  server.handle(resumeNowRpc, async ({ agentId, jobId }, context) => {
    ({ paseo } = context);
    const entry = pending.get(agentId);
    if (!entry || entry.rowId !== jobId) {
      return RESULTS.skipped;
    }
    return RESULTS[await resume(agentId)];
  });

  server.handle(cancelResumeRpc, ({ agentId, jobId }) => {
    const entry = pending.get(agentId);
    if (!entry || entry.rowId !== jobId) {
      return RESULTS.skipped;
    }
    cancel(agentId);
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
    for (const [agentId] of pending.all()) {
      clearTimers(agentId);
    }
    await connection.close();
  };
}
