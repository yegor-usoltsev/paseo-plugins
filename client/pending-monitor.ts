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

interface Snapshot {
  entries: ReadonlyMap<string, PendingEntry>;
  unavailable: boolean;
}

export const createPendingMonitor = (
  client: PluginClientContext,
  Content: ComponentType<PluginButtonContentProps>
) => {
  const pills = new Map<string, PluginButtonRegistration>();
  const listeners = new Set<() => void>();
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
      const workspaceId = entry.workspaceId ?? "";
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

  const poll = async (): Promise<void> => {
    try {
      const { entries: list } = await client.rpc(listPendingRpc, {});
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

  void refresh();
  const timer = setInterval(() => {
    void refresh();
  }, POLL_MS);

  return {
    getSnapshot: () => snapshot,
    refresh,
    async refreshAfterAction() {
      if (polling !== null) {
        await polling;
      }
      await refresh();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
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
