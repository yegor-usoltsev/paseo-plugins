import { homedir } from "node:os";
import path from "node:path";

import type {
  PluginHookContext,
  PluginLifecycleEvents,
  PluginServerContext,
} from "@getpaseo/plugin/server";

import { connectDaemon } from "./server/connection.ts";
import { deliver } from "./server/deliver.ts";
import { SHIM_SOURCE } from "./server/shim.ts";
import { listen, socketPath } from "./server/socket.ts";

export default function contribute(
  server: PluginServerContext,
  connect = connectDaemon
) {
  const paseoHome = process.env.PASEO_HOME ?? path.join(homedir(), ".paseo");
  const socket = socketPath(paseoHome);
  const connection = connect(paseoHome);
  let paseo: Parameters<typeof deliver>[0] | null = null;

  // Give every new agent the `peer` MCP server.
  server.before("agent.create", ({ request }, context) => {
    ({ paseo } = context);
    return {
      ...request,
      config: {
        ...request.config,
        mcpServers: {
          ...request.config.mcpServers,
          // In Paseo.app execPath is Electron, and provider launches strip
          // ELECTRON_RUN_AS_NODE, so ask for Node mode explicitly.
          peer: {
            args: ["-e", SHIM_SOURCE, socket],
            command: process.execPath,
            env: { ELECTRON_RUN_AS_NODE: "1" },
            type: "stdio",
          },
        },
      },
    };
  });
  // Reuse the host connection as soon as a hook provides it.
  const capture = (
    _event: PluginLifecycleEvents["agent.turn_started" | "agent.turn_ended"],
    context: PluginHookContext
  ) => {
    ({ paseo } = context);
  };
  server.on("agent.turn_started", capture);
  server.on("agent.turn_ended", capture);

  const close = listen(
    socket,
    async (request) => await deliver(paseo ?? (await connection.get()), request)
  );
  return async () => {
    close();
    await connection.close();
  };
}
