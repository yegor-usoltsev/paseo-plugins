// Infer context types from the plugin SDK supplied by the host.
import type {
  PluginHandlerContext,
  PluginLifecycleEvents,
} from "@getpaseo/plugin/server";

export type PaseoApi = PluginHandlerContext["paseo"];
export type PaseoAgentSendOptions = NonNullable<
  Parameters<ReturnType<PaseoApi["agents"]["ref"]>["send"]>[1]
>;
export type AgentTimelineItem =
  PluginLifecycleEvents["agent.turn_ended"]["timeline"][number];
