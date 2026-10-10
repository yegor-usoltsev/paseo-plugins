import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";

import type { ResumeStatus } from "../shared/status";
import { clockTime } from "./format";

const ICONS: Record<ResumeStatus["state"], string> = {
  cancelled: "AlarmClockOff",
  rescheduled: "AlarmClock",
  resumed: "Play",
  scheduled: "AlarmClock",
};

function label({ state, at, basis }: ResumeStatus): string {
  const time = clockTime(new Date(at));
  if (state === "resumed") {
    return `Resumed after usage limit at ${time}`;
  }
  if (state === "cancelled") {
    return `Auto-resume cancelled at ${time}`;
  }
  if (state === "rescheduled") {
    return `Auto-resume rescheduled for ${time}`;
  }
  if (basis === "retry") {
    return `Resume deferred · retrying at ${time}`;
  }
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
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      <View style={{ backgroundColor: border, flex: 1, height: 1 }} />
      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          flexShrink: 1,
          gap: 8,
        }}
      >
        <Icon name={ICONS[item.data.state]} size={12} color={foregroundMuted} />
        <Text
          style={{
            color: foregroundMuted,
            flexShrink: 1,
            fontSize: 13,
            textAlign: "center",
          }}
        >
          {label(item.data)}
        </Text>
      </View>
      <View style={{ backgroundColor: border, flex: 1, height: 1 }} />
    </View>
  );
}
