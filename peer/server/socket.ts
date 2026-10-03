import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

export interface SendRequest {
  from: string | null;
  to: string;
  message: string;
}

export interface SendResult {
  ok: boolean;
  text: string;
}

// One socket per daemon home, short enough for the macOS sun_path limit.
export function socketPath(paseoHome: string): string {
  const digest = createHash("sha256").update(paseoHome).digest("hex").slice(0, 12);
  return join(tmpdir(), `paseo-peer-${userInfo().uid}-${digest}.sock`);
}

export function listen(path: string, handle: (request: SendRequest) => Promise<SendResult>): () => void {
  rmSync(path, { force: true });
  const server = createServer((request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk));
    request.on("end", async () => {
      let result: SendResult;
      try {
        result = await handle(JSON.parse(body) as SendRequest);
      } catch (error) {
        result = { ok: false, text: error instanceof Error ? error.message : String(error) };
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(result));
    });
  });
  server.listen(path);
  return () => {
    server.close();
    rmSync(path, { force: true });
  };
}
