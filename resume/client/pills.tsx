import type { PluginButtonContentProps, PluginClientContext } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useState, useSyncExternalStore } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { cancelResumeRpc, resumeNowRpc, type PendingEntry } from "../shared/rpc";
import { clockTime, untilTime } from "./format";
import { createPendingMonitor } from "./pending-monitor";

const EXPLANATIONS: Record<PendingEntry["basis"], string> = {
  reset: "The agent stopped on its usage limit, which resets shortly before this.",
  estimate: "The agent stopped on its usage limit. The reset time is unavailable.",
  retry: "The last resume could not reach the agent.",
};

/** Shows a composer pill on every agent waiting for its usage limit to reset. */
export function contributePills(client: PluginClientContext): () => void {
  const monitor = createPendingMonitor(client, ResumePopover);
  const appState = AppState.addEventListener("change", (state) => {
    if (state === "active") void monitor.refresh();
  });

  function ResumePopover(props: PluginButtonContentProps) {
    const { theme, close } = props;
    const agentId = props.context === "agent" ? props.agentId : undefined;
    const { entries, unavailable } = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);
    const entry = agentId ? entries.get(agentId) : undefined;
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    const colors = theme.colors;
    if (!entry || !agentId) {
      return <Text style={{ color: colors.foregroundMuted }}>{unavailable ? "Resume status unavailable." : "No auto-resume is pending."}</Text>;
    }
    const at = new Date(entry.resumeAt);
    const act = async (contract: typeof resumeNowRpc | typeof cancelResumeRpc) => {
      setBusy(true);
      try {
        const result = await client.rpc(contract, { agentId, jobId: entry.jobId });
        if (result.ok) toast.show(result.message, { variant: "success" });
        else toast.show(result.message, { variant: "warning" });
        await monitor.refreshAfterAction();
        close();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    };
    const button = (primary: boolean) => ({
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: primary ? colors.accent : colors.surface2,
      opacity: busy || unavailable ? 0.5 : 1,
    });
    return (
      <View style={{ gap: 12, maxWidth: 320 }}>
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>Auto-resume</Text>
          <Text style={{ color: colors.foregroundMuted }}>
            {unavailable ? `Status unavailable. Last confirmed attempt at ${clockTime(at)}. Controls return when the connection recovers.` : entry.attempting ? "A resume attempt is in progress." : `${EXPLANATIONS[entry.basis]} Next attempt at ${clockTime(at)}, ${untilTime(at)}.`}
          </Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || unavailable || entry.attempting, busy }} aria-busy={busy} disabled={busy || unavailable || entry.attempting} onPress={() => act(resumeNowRpc)} style={button(true)}>
            <Text style={{ color: colors.accentForeground }}>Try now</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || unavailable, busy }} aria-busy={busy} disabled={busy || unavailable} onPress={() => act(cancelResumeRpc)} style={button(false)}>
            <Text style={{ color: colors.foreground }}>Cancel this resume</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return () => { appState.remove(); monitor.stop(); };
}
