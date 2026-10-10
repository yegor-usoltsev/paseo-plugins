import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";

/** A `peer.send` call forwarded by the MCP server. */
export interface SendRequest {
  from: string | null;
  to: string;
  message: string;
}

/** The tool result returned to the sending agent. */
export interface SendResult {
  ok: boolean;
  text: string;
}

const isFieldBag = (
  value: unknown
): value is { from?: unknown; message?: unknown; to?: unknown } =>
  typeof value === "object" && value !== null;

const isSendRequest = (value: unknown): value is SendRequest => {
  if (!isFieldBag(value)) {
    return false;
  }
  const { from, message, to } = value;
  return (
    (from === null || typeof from === "string") &&
    typeof to === "string" &&
    typeof message === "string"
  );
};

const parseSendRequest = (body: string): SendRequest => {
  const request: unknown = JSON.parse(body);
  if (!isSendRequest(request)) {
    throw new Error("Invalid peer send request.");
  }
  return request;
};

/**
 * Names the socket for a daemon home: one socket per home, short enough for
 * the macOS `sun_path` limit.
 *
 * @param paseoHome - The Paseo home the daemon runs from.
 * @returns The socket path in the temporary directory.
 */
export const socketPath = (paseoHome: string): string => {
  const digest = createHash("sha256")
    .update(paseoHome)
    .digest("hex")
    .slice(0, 12);
  return path.join(tmpdir(), `paseo-peer-${userInfo().uid}-${digest}.sock`);
};

/**
 * Serves `peer.send` calls from the MCP servers on a Unix socket.
 *
 * @param socket - The socket path to listen on.
 * @param handle - Delivers one request and returns its tool result.
 * @returns A function that closes the server and removes the socket.
 */
export const listen = (
  socket: string,
  handle: (request: SendRequest) => Promise<SendResult>
): (() => void) => {
  rmSync(socket, { force: true });
  const server = createServer((request, response) => {
    let body = "";
    const respond = async () => {
      let result: SendResult;
      try {
        result = await handle(parseSendRequest(body));
      } catch (error) {
        result = {
          ok: false,
          text: error instanceof Error ? error.message : String(error),
        };
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(result));
    };
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      void respond();
    });
  });
  server.listen(socket);
  return () => {
    server.close();
    rmSync(socket, { force: true });
  };
};
