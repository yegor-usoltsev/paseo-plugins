import { homedir } from "node:os";
import { join } from "node:path";

import type { PluginServerContext } from "@getpaseo/plugin/server";

import { connectDaemon } from "./server/connection.ts";
import { deliver } from "./server/deliver.ts";
import { SHIM_SOURCE } from "./server/shim.ts";
import { listen, socketPath } from "./server/socket.ts";

export default function contribute(
  server: PluginServerContext,
  connect = connectDaemon
) {
  const path = socketPath(process.env.PASEO_HOME ?? join(homedir(), ".paseo"));
  const connection = connect(
    process.env.PASEO_HOME ?? join(homedir(), ".paseo")
  );
  let paseo: Parameters<typeof deliver>[0] | null = null;

  // Give every new agent the `peer` MCP server.
  server.before("agent.create", ({ request }, context) => {
    paseo = context.paseo;
    return {
      ...request,
      config: {
        ...request.config,
        mcpServers: {
          ...request.config.mcpServers,
          // In Paseo.app execPath is Electron, and provider launches strip
          // ELECTRON_RUN_AS_NODE, so ask for Node mode explicitly.
          peer: {
            type: "stdio",
            command: process.execPath,
            args: ["-e", SHIM_SOURCE, path],
            env: { ELECTRON_RUN_AS_NODE: "1" },
          },
        },
      },
    };
  });
  // Reuse the host connection as soon as a hook provides it.
  const capture = (
    _event: unknown,
    context: { paseo: Parameters<typeof deliver>[0] }
  ) => {
    paseo = context.paseo;
  };
  server.on("agent.turn_started", capture);
  server.on("agent.turn_ended", capture);

  const close = listen(path, async (request) => {
    return deliver(paseo ?? (await connection.get()), request);
  });
  return async () => {
    close();
    await connection.close();
  };
}
