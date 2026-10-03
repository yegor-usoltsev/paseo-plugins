import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { deliver } from "./server/deliver";
import { SHIM_SOURCE } from "./server/shim";
import { listen, socketPath } from "./server/socket";

export default function contribute(server: PluginServerContext) {
  const path = socketPath(process.env.PASEO_HOME ?? join(homedir(), ".paseo"));
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
  // The SDK client reaches plugin code only through hook contexts. Agents
  // start turns constantly, so one of these fires before any message is sent.
  const capture = (_event: unknown, context: { paseo: Parameters<typeof deliver>[0] }) => {
    paseo = context.paseo;
  };
  server.on("agent.turn_started", capture);
  server.on("agent.turn_ended", capture);

  const close = listen(path, async (request) => {
    if (!paseo) return { ok: false, text: "paseo-peer is still starting; retry in a moment." };
    return deliver(paseo, request);
  });
  return close;
}
