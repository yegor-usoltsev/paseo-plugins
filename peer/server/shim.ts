// The MCP server each agent runs over stdio. Providers start it with `node -e`,
// so it must be self-contained CommonJS. It works out which agent called it and
// forwards the call to the plugin process over a Unix socket.
//
// Claude Code passes PASEO_AGENT_ID to MCP servers; Codex does not, but its
// per-agent app-server parent process has it in its environment.
export const SHIM_SOURCE = String.raw`
const { readFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const http = require("node:http");
const readline = require("node:readline");

const socketPath = process.argv[1];

function envAgent(pid) {
  try {
    const match = /(?:^|\0)PASEO_AGENT_ID=([^\0]+)/.exec(readFileSync("/proc/" + pid + "/environ", "utf8"));
    return match ? match[1] : null;
  } catch {}
  try {
    const match = /\bPASEO_AGENT_ID=(\S+)/.exec(execFileSync("ps", ["-wwEo", "command=", "-p", String(pid)], { encoding: "utf8" }));
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function parentPid(pid) {
  try {
    return Number(readFileSync("/proc/" + pid + "/stat", "utf8").split(") ")[1].split(" ")[1]);
  } catch {}
  try {
    return Number(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim());
  } catch {
    return 0;
  }
}

// Only the provider process itself: further up sits the daemon, whose
// environment may carry an unrelated agent ID.
const caller = process.env.PASEO_AGENT_ID || envAgent(process.ppid) || envAgent(parentPid(process.ppid));

const tool = {
  name: "send",
  description:
    "Send a message to another Paseo agent. If the recipient is working, the message joins its current turn without interrupting it; if it is idle, the message starts a new turn. The recipient sees your agent ID in a [from:<id>] first line and answers with this same tool. Returns as soon as the message is delivered.",
  inputSchema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient agent ID, a unique ID prefix, or its exact title." },
      message: { type: "string", description: "Message text." },
    },
    required: ["to", "message"],
  },
};

function forward(args) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ from: caller, to: args.to, message: args.message });
    const request = http.request({ socketPath, path: "/send", method: "POST", headers: { "content-type": "application/json" } }, (response) => {
      let data = "";
      response.on("data", (chunk) => (data += chunk));
      response.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ ok: false, text: "paseo-peer returned an unreadable response." });
        }
      });
    });
    request.on("error", (error) => resolve({ ok: false, text: "paseo-peer plugin is unreachable: " + error.message }));
    request.end(body);
  });
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  switch (message.method) {
    case "initialize":
      reply(message.id, {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "peer", version: "1" },
      });
      return;
    case "tools/list":
      reply(message.id, { tools: [tool] });
      return;
    case "tools/call": {
      const result = message.params.name === "send"
        ? await forward(message.params.arguments || {})
        : { ok: false, text: "Unknown tool: " + message.params.name };
      reply(message.id, { content: [{ type: "text", text: result.text }], isError: !result.ok });
      return;
    }
    default:
      reply(message.id, {});
  }
});
`;
