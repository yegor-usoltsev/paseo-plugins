import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createPaseoApi } from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WebSocketLike } from "@getpaseo/client/internal/daemon-client-transport-types";
import WebSocket from "ws";

import type { PaseoApi } from "./sdk.ts";

export function daemonTarget(listen: string): {
  url: string;
  socketPath?: string;
} {
  if (listen.startsWith("unix://") || listen.startsWith("/")) {
    const socketPath = listen.replace(/^unix:\/\//, "");
    if (!socketPath) throw new Error("Missing daemon socket path");
    return { url: `ws+unix://${socketPath}:/ws`, socketPath };
  }
  const endpoint = listen
    .replace(/^0\.0\.0\.0:/, "127.0.0.1:")
    .replace(/^\[::\]:/, "[::1]:");
  const url = new URL(`ws://${endpoint}/ws`);
  if (
    !/:\d+$/.test(endpoint) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid daemon listen address");
  return { url: url.toString() };
}

// The host exposes its SDK only in event/RPC contexts. Use a scoped local
// connection for requests arriving before the first context after reload.
export function connectDaemon(paseoHome: string) {
  let ready: Promise<PaseoApi> | undefined;
  let client: DaemonClient | undefined;
  let api: ReturnType<typeof createPaseoApi> | undefined;
  let closed = false;

  async function open(): Promise<PaseoApi> {
    const pid = JSON.parse(
      await readFile(join(paseoHome, "paseo.pid"), "utf8")
    );
    const target = daemonTarget(pid.listen);
    if (closed) throw new Error("Plugin connection is closed");
    client = new DaemonClient({
      url: target.url,
      clientId: randomUUID(),
      clientType: "cli",
      connectTimeoutMs: 10_000,
      reconnect: { enabled: false },
      localCredential: async () =>
        (await readFile(join(paseoHome, "local-credential"), "utf8")).trim(),
      webSocketFactory: (url, options) =>
        new WebSocket(url, options?.protocols, {
          headers: options?.headers,
          ...(target.socketPath ? { socketPath: target.socketPath } : {}),
        }) as unknown as WebSocketLike,
    });
    api = createPaseoApi(client);
    await client.connect();
    if (closed) throw new Error("Plugin connection is closed");
    return api;
  }

  return {
    get(): Promise<PaseoApi> {
      if (closed)
        return Promise.reject(new Error("Plugin connection is closed"));
      return (ready ??= open().catch(async (error) => {
        await api?.dispose();
        await client?.close();
        api = undefined;
        client = undefined;
        ready = undefined;
        throw error;
      }));
    },
    async close(): Promise<void> {
      closed = true;
      await api?.dispose();
      await client?.close();
    },
  };
}
