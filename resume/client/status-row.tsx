import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";

import type { ResumeStatus } from "../shared/status";
import { clockTime } from "./format";

const ICONS: Record<ResumeStatus["state"], string> = {
  scheduled: "AlarmClock",
  resumed: "Play",
  cancelled: "AlarmClockOff",
  rescheduled: "AlarmClock",
};

function label({ state, at, basis }: ResumeStatus): string {
  const time = clockTime(new Date(at));
  if (state === "resumed") return `Resumed after usage limit at ${time}`;
  if (state === "cancelled") return `Auto-resume cancelled at ${time}`;
  if (state === "rescheduled") return `Auto-resume rescheduled for ${time}`;
  if (basis === "retry") return `Resume deferred · retrying at ${time}`;
  return basis === "estimate"
    ? `Usage limit reached · retrying at ${time}`
    : `Usage limit reached · resumes at ${time}`;
}

// Drawn like Paseo's own compaction marker: a quiet event between two rules.
export function ResumeStatusRow({
  item,
  theme,
}: PluginTimelineItemProps<ResumeStatus>) {
  const { border, foregroundMuted } = theme.colors;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 12,
        paddingHorizontal: 16,
      }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: border }} />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          flexShrink: 1,
        }}
      >
        <Icon name={ICONS[item.data.state]} size={12} color={foregroundMuted} />
        <Text
          style={{
            color: foregroundMuted,
            fontSize: 13,
            flexShrink: 1,
            textAlign: "center",
          }}
        >
          {label(item.data)}
        </Text>
      </View>
      <View style={{ flex: 1, height: 1, backgroundColor: border }} />
    </View>
  );
}
