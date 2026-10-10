import type {
  PluginButtonContentProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import type { ComponentType } from "react";

import { listPendingRpc, type PendingEntry } from "../shared/rpc.ts";
import { pillLabel } from "./format.ts";

const POLL_MS = 30_000;
const SETTLE_MS = 3_000;

interface Snapshot {
  entries: ReadonlyMap<string, PendingEntry>;
  unavailable: boolean;
}

/** Reconciles persisted jobs independently of the agent directory's first page. */
export function createPendingMonitor(
  client: PluginClientContext,
  Content: ComponentType<PluginButtonContentProps>
) {
  const lifetime = new AbortController();
  const workspaces = new Map<string, string>();
  const pills = new Map<string, PluginButtonRegistration>();
  const listeners = new Set<() => void>();
  const settleTimers = new Set<ReturnType<typeof setTimeout>>();
  let snapshot: Snapshot = { entries: new Map(), unavailable: false };
  let stopped = false;
  let polling: Promise<void> | null = null;

  function publish(
    entries: ReadonlyMap<string, PendingEntry>,
    unavailable: boolean
  ): void {
    snapshot = { entries, unavailable };
    for (const [agentId, pill] of pills) {
      if (entries.has(agentId)) continue;
      pill.remove();
      pills.delete(agentId);
    }
    for (const entry of entries.values()) {
      const label = unavailable
        ? "Resume status unavailable"
        : pillLabel(entry);
      const pill = pills.get(entry.agentId);
      if (pill) {
        pill.update({ label });
        continue;
      }
      const workspaceId = workspaces.get(entry.agentId);
      if (!workspaceId) continue;
      pills.set(
        entry.agentId,
        client.addComposerPill({
          id: "auto-resume",
          workspaceId,
          agentId: entry.agentId,
          button: {
            title: "Auto-resume",
            icon: "AlarmClock",
            label,
            behavior: { kind: "popover", Content },
          },
        })
      );
    }
    for (const listener of listeners) listener();
  }

  function refresh(): Promise<void> {
    if (stopped) return Promise.resolve();
    polling ??= client
      .rpc(listPendingRpc, {})
      .then(async ({ entries: list }) => {
        // A restored job may be older than all 200 agents in the directory
        // snapshot, or the directory subscription may not be ready yet.
        await Promise.all(
          list
            .filter((entry) => !workspaces.has(entry.agentId))
            .map(async (entry) => {
              try {
                const handle = client.paseo.agents.ref(entry.agentId);
                await handle.refresh();
                if (!stopped && handle.workspaceId)
                  workspaces.set(entry.agentId, handle.workspaceId);
              } catch (error) {
                if (!stopped)
                  console.error(
                    `Cannot locate auto-resume agent ${entry.agentId}`,
                    error
                  );
              }
            })
        );
        if (!stopped)
          publish(new Map(list.map((entry) => [entry.agentId, entry])), false);
      })
      .catch((error: unknown) => {
        if (stopped) return;
        console.error("Cannot list pending auto-resumes", error);
        publish(snapshot.entries, true);
      })
      .finally(() => {
        polling = null;
      });
    return polling;
  }

  const track = (agent: { id: string; workspaceId?: string | null }) => {
    if (agent.workspaceId) workspaces.set(agent.id, agent.workspaceId);
    else workspaces.delete(agent.id);
  };
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      if (stopped) return;
      subscription.subscribe({
        snapshot: ({ entries: list }) => {
          if (stopped) return;
          for (const { agent } of list) track(agent);
          void refresh();
        },
        update: (message) => {
          if (stopped || message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") workspaces.delete(update.agentId);
          else track(update.agent);
          void refresh();
          // The schedule lands after the provider usage lookup.
          const timer = setTimeout(() => {
            settleTimers.delete(timer);
            void refresh();
          }, SETTLE_MS);
          settleTimers.add(timer);
        },
      });
    })
    .catch((error: unknown) => {
      if (!stopped) console.error("Agent observation failed", error);
    });
  void refresh();
  const timer = setInterval(() => void refresh(), POLL_MS);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    async refreshAfterAction() {
      // An existing query may have captured the schedule before the action.
      // Join it first, then request a fresh server-confirmed snapshot.
      if (polling) await polling;
      await refresh();
    },
    stop() {
      stopped = true;
      lifetime.abort();
      clearInterval(timer);
      for (const timer of settleTimers) clearTimeout(timer);
      for (const pill of pills.values()) pill.remove();
      pills.clear();
      listeners.clear();
    },
  };
}
