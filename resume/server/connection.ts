import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createPaseoApi } from "@getpaseo/client";
import type { PaseoApi } from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { z } from "zod";

const CLOSED = "Plugin connection is closed";

const pidSchema = z.object({ listen: z.string().min(1) });

export const daemonUrl = (listen: string): string => {
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
  return url.toString();
};

export const connectDaemon = (paseoHome: string) => {
  let ready: Promise<PaseoApi> | null = null;
  let client: DaemonClient | null = null;
  let api: ReturnType<typeof createPaseoApi> | null = null;
  let closed = false;

  const open = async (): Promise<PaseoApi> => {
    // oxlint-disable-next-line react-doctor/async-defer-await -- The following guard handles cleanup during the PID file read.
    const { listen } = pidSchema.parse(
      JSON.parse(await readFile(path.join(paseoHome, "paseo.pid"), "utf-8"))
    );
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
      url: daemonUrl(listen),
    });
    api = createPaseoApi(client);
    await client.connect();
    if (closed) {
      throw new Error(CLOSED);
    }
    return api;
  };

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
