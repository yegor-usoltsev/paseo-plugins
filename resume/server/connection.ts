import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ClientRequestArgs } from "node:http";
import path from "node:path";

import { createPaseoApi } from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WebSocketLike } from "@getpaseo/client/internal/daemon-client-transport-types";
import { WebSocket } from "ws";

import type { PaseoApi } from "./sdk.ts";

interface DaemonTarget {
  url: string;
  socketPath?: string;
}

interface PidFile {
  listen: string;
}

const CLOSED = "Plugin connection is closed";

const isPidFile = (value: unknown): value is PidFile =>
  typeof value === "object" &&
  value !== null &&
  "listen" in value &&
  typeof value.listen === "string";

export const daemonTarget = (listen: string): DaemonTarget => {
  if (listen.startsWith("unix://") || listen.startsWith("/")) {
    const socketPath = listen.replace(/^unix:\/\//u, "");
    if (socketPath === "") {
      throw new Error("Missing daemon socket path");
    }
    return { socketPath, url: `ws+unix://${socketPath}:/ws` };
  }
  const endpoint = listen
    .replace(/^0\.0\.0\.0:/u, "127.0.0.1:")
    .replace(/^\[::\]:/u, "[::1]:");
  const url = new URL(`ws://${endpoint}/ws`);
  const hasPort = /:\d+$/u.test(endpoint);
  const hasExtras = [url.username, url.password, url.search, url.hash].some(
    (part) => part !== ""
  );
  if (!hasPort || hasExtras) {
    throw new Error("Invalid daemon listen address");
  }
  return { url: url.toString() };
};

// The host exposes its SDK only in event/RPC contexts. Use a scoped local
// connection for requests arriving before the first context after reload.
export const connectDaemon = (paseoHome: string) => {
  let ready: Promise<PaseoApi> | null = null;
  let client: DaemonClient | null = null;
  let api: ReturnType<typeof createPaseoApi> | null = null;
  let closed = false;

  const open = async (): Promise<PaseoApi> => {
    const pid: unknown = JSON.parse(
      await readFile(path.join(paseoHome, "paseo.pid"), "utf-8")
    );
    if (!isPidFile(pid)) {
      throw new Error("Invalid daemon PID file");
    }
    const target = daemonTarget(pid.listen);
    if (closed) {
      throw new Error(CLOSED);
    }
    client = new DaemonClient({
      clientId: randomUUID(),
      clientType: "cli",
      connectTimeoutMs: 10_000,
      localCredential: async () => {
        const credential = await readFile(
          path.join(paseoHome, "local-credential"),
          "utf-8"
        );
        return credential.trim();
      },
      reconnect: { enabled: false },
      url: target.url,
      webSocketFactory: (url, options) => {
        const socketOptions: ClientRequestArgs = { headers: options?.headers };
        if (target.socketPath !== undefined) {
          socketOptions.socketPath = target.socketPath;
        }
        const socket = new WebSocket(url, options?.protocols, socketOptions);
        // SAFETY: ws implements the event API the daemon client uses; only its
        // typed listener overloads differ from the SDK's string-keyed ones.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions, typescript/no-unsafe-type-assertion -- ws's types cannot be assigned to WebSocketLike without widening to unknown.
        return socket as unknown as WebSocketLike;
      },
    });
    api = createPaseoApi(client);
    await client.connect();
    if (closed) {
      throw new Error(CLOSED);
    }
    return api;
  };

  // A failed connect is forgotten, so the next request retries it.
  const connect = async (): Promise<PaseoApi> => {
    try {
      return await open();
    } catch (error) {
      await api?.dispose();
      await client?.close();
      api = null;
      client = null;
      ready = null;
      throw error;
    }
  };

  return {
    async close(): Promise<void> {
      closed = true;
      await api?.dispose();
      await client?.close();
    },
    async get(): Promise<PaseoApi> {
      if (closed) {
        throw new Error(CLOSED);
      }
      ready ??= connect();
      return await ready;
    },
  };
};
