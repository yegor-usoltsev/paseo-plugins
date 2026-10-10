// Infer context types from the plugin SDK supplied by the host.
import type {
  PluginHandlerContext,
  PluginLifecycleEvents,
} from "@getpaseo/plugin/server";

/** The Paseo SDK client that hook and RPC contexts provide. */
export type PaseoApi = PluginHandlerContext["paseo"];
/** Options for sending a message to an agent. */
export type PaseoAgentSendOptions = NonNullable<
  Parameters<ReturnType<PaseoApi["agents"]["ref"]>["send"]>[1]
>;
/** One item of an agent's timeline, as a finished turn reports it. */
export type AgentTimelineItem =
  PluginLifecycleEvents["agent.turn_ended"]["timeline"][number];
