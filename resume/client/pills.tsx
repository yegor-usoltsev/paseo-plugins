import type {
  PluginButtonContentProps,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useState, useSyncExternalStore } from "react";
import { AppState, Pressable, Text, View } from "react-native";

import { cancelResumeRpc, resumeNowRpc } from "../shared/rpc";
import type { PendingEntry } from "../shared/rpc";
import { clockTime, untilTime } from "./format";
import { createPendingMonitor } from "./pending-monitor";

const EXPLANATIONS: Record<PendingEntry["basis"], string> = {
  estimate:
    "The agent stopped on its usage limit. The reset time is unavailable.",
  reset:
    "The agent stopped on its usage limit, which resets shortly before this.",
  retry: "The last resume was deferred or could not reach the agent.",
};

function explanation(entry: PendingEntry, unavailable: boolean): string {
  const at = new Date(entry.resumeAt);
  if (unavailable) {
    return `Status unavailable. Last confirmed attempt at ${clockTime(at)}. Controls return when the connection recovers.`;
  }
  if (entry.attempting) {
    return "A resume attempt is in progress.";
  }
  return `${EXPLANATIONS[entry.basis]} Next attempt at ${clockTime(at)}, ${untilTime(at)}.`;
}

/** Shows a composer pill on every agent waiting for its usage limit to reset. */
export function contributePills(client: PluginClientContext): () => void {
  const monitor = createPendingMonitor(client, ResumePopover);
  const appState = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      void monitor.refresh();
    }
  });

  function ResumePopover(props: PluginButtonContentProps) {
    const { theme } = props;
    const agentId = props.context === "agent" ? props.agentId : undefined;
    const { entries, unavailable } = useSyncExternalStore(
      monitor.subscribe,
      monitor.getSnapshot
    );
    const entry = agentId === undefined ? undefined : entries.get(agentId);
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    const { colors } = theme;
    if (entry === undefined || agentId === undefined) {
      return (
        <Text style={{ color: colors.foregroundMuted }}>
          {unavailable
            ? "Resume status unavailable."
            : "No auto-resume is pending."}
        </Text>
      );
    }
    const job = { agentId, jobId: entry.jobId };
    async function act(contract: typeof resumeNowRpc) {
      setBusy(true);
      try {
        const result = await client.rpc(contract, job);
        if (result.ok) {
          toast.show(result.message, { variant: "success" });
        } else {
          toast.show(result.message, { variant: "warning" });
        }
        await monitor.refreshAfterAction();
        props.close();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
      setBusy(false);
    }
    function button(primary: boolean) {
      return {
        backgroundColor: primary ? colors.accent : colors.surface2,
        borderRadius: 8,
        opacity: busy || unavailable ? 0.5 : 1,
        paddingHorizontal: 12,
        paddingVertical: 8,
      };
    }
    return (
      <View style={{ gap: 12, maxWidth: 320 }}>
        <View style={{ gap: 4 }}>
          <Text
            style={{
              color: colors.foreground,
              fontSize: 15,
              fontWeight: "600",
            }}
          >
            Auto-resume
          </Text>
          <Text style={{ color: colors.foregroundMuted }}>
            {explanation(entry, unavailable)}
          </Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              busy,
              disabled: busy || unavailable || entry.attempting,
            }}
            aria-busy={busy}
            disabled={busy || unavailable || entry.attempting}
            onPress={() => {
              void act(resumeNowRpc);
            }}
            style={button(true)}
          >
            <Text style={{ color: colors.accentForeground }}>Try now</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy || unavailable }}
            aria-busy={busy}
            disabled={busy || unavailable}
            onPress={() => {
              void act(cancelResumeRpc);
            }}
            style={button(false)}
          >
            <Text style={{ color: colors.foreground }}>Cancel this resume</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return () => {
    appState.remove();
    monitor.stop();
  };
}
