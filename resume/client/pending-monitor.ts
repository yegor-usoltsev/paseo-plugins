import type {
  PluginButtonContentProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import type { ComponentType } from "react";

import { listPendingRpc } from "../shared/rpc.ts";
import type { PendingEntry } from "../shared/rpc.ts";
import { pillLabel } from "./format.ts";

const POLL_MS = 30_000;
const SETTLE_MS = 3000;

interface Snapshot {
  entries: ReadonlyMap<string, PendingEntry>;
  unavailable: boolean;
}

/** Reconciles persisted jobs independently of the agent directory's first page. */
export const createPendingMonitor = (
  client: PluginClientContext,
  Content: ComponentType<PluginButtonContentProps>
) => {
  const lifetime = new AbortController();
  const workspaces = new Map<string, string>();
  const pills = new Map<string, PluginButtonRegistration>();
  const listeners = new Set<() => void>();
  const settleTimers = new Set<ReturnType<typeof setTimeout>>();
  let snapshot: Snapshot = { entries: new Map(), unavailable: false };
  let stopped = false;
  let polling: Promise<void> | null = null;

  const publish = (
    entries: ReadonlyMap<string, PendingEntry>,
    unavailable: boolean
  ): void => {
    snapshot = { entries, unavailable };
    for (const [agentId, pill] of pills) {
      if (!entries.has(agentId)) {
        pill.remove();
        pills.delete(agentId);
      }
    }
    for (const entry of entries.values()) {
      const label = unavailable
        ? "Resume status unavailable"
        : pillLabel(entry);
      const pill = pills.get(entry.agentId);
      const workspaceId = workspaces.get(entry.agentId) ?? "";
      if (pill !== undefined) {
        pill.update({ label });
      } else if (workspaceId !== "") {
        pills.set(
          entry.agentId,
          client.addComposerPill({
            agentId: entry.agentId,
            button: {
              behavior: { Content, kind: "popover" },
              icon: "AlarmClock",
              label,
              title: "Auto-resume",
            },
            id: "auto-resume",
            workspaceId,
          })
        );
      }
    }
    for (const listener of listeners) {
      listener();
    }
  };

  const locate = async (entry: PendingEntry): Promise<void> => {
    try {
      const handle = client.paseo.agents.ref(entry.agentId);
      await handle.refresh();
      const workspaceId = handle.workspaceId ?? "";
      if (!stopped && workspaceId !== "") {
        workspaces.set(entry.agentId, workspaceId);
      }
    } catch (error) {
      if (!stopped) {
        console.error(
          `Cannot locate auto-resume agent ${entry.agentId}`,
          error
        );
      }
    }
  };

  const poll = async (): Promise<void> => {
    try {
      const { entries: list } = await client.rpc(listPendingRpc, {});
      // A restored job may be older than all 200 agents in the directory
      // snapshot, or the directory subscription may not be ready yet.
      await Promise.all(
        list.flatMap((entry) =>
          workspaces.has(entry.agentId) ? [] : [locate(entry)]
        )
      );
      if (!stopped) {
        publish(new Map(list.map((entry) => [entry.agentId, entry])), false);
      }
    } catch (error) {
      if (stopped) {
        return;
      }
      console.error("Cannot list pending auto-resumes", error);
      publish(snapshot.entries, true);
    }
  };

  // Clears the shared query only after it settles, so concurrent refreshes
  // join it instead of starting another.
  const startPolling = async (): Promise<void> => {
    try {
      await poll();
    } finally {
      polling = null;
    }
  };

  const refresh = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    polling ??= startPolling();
    await polling;
  };

  const track = (agent: { id: string; workspaceId?: string | null }) => {
    const workspaceId = agent.workspaceId ?? "";
    if (workspaceId === "") {
      workspaces.delete(agent.id);
    } else {
      workspaces.set(agent.id, workspaceId);
    }
  };

  const observe = async (): Promise<void> => {
    try {
      const { subscription } = await client.paseo.agents.list({
        signal: lifetime.signal,
        subscribe: {},
      });
      if (stopped) {
        return;
      }
      subscription.subscribe({
        snapshot: ({ entries: list }) => {
          if (stopped) {
            return;
          }
          for (const { agent } of list) {
            track(agent);
          }
          void refresh();
        },
        update: (message) => {
          if (stopped || message.type !== "agent_update") {
            return;
          }
          const update = message.payload;
          if (update.kind === "remove") {
            workspaces.delete(update.agentId);
          } else {
            track(update.agent);
          }
          void refresh();
          // The schedule lands after the provider usage lookup.
          const timer = setTimeout(() => {
            settleTimers.delete(timer);
            void refresh();
          }, SETTLE_MS);
          settleTimers.add(timer);
        },
      });
    } catch (error) {
      if (!stopped) {
        console.error("Agent observation failed", error);
      }
    }
  };

  void observe();
  void refresh();
  const timer = setInterval(() => {
    void refresh();
  }, POLL_MS);

  return {
    getSnapshot: () => snapshot,
    refresh,
    async refreshAfterAction() {
      // An existing query may have captured the schedule before the action.
      // Join it first, then request a fresh server-confirmed snapshot.
      if (polling !== null) {
        await polling;
      }
      await refresh();
    },
    stop() {
      stopped = true;
      lifetime.abort();
      clearInterval(timer);
      for (const settleTimer of settleTimers) {
        clearTimeout(settleTimer);
      }
      for (const pill of pills.values()) {
        pill.remove();
      }
      pills.clear();
      listeners.clear();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
