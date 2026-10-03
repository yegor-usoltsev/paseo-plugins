// Paseo compiles plugins without their node_modules, so every type comes from
// @getpaseo/plugin, which the host provides.
import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";

export type ToolCallItem = Parameters<PluginTimelineTransformerContribution<"tool_call">["transform"]>[0]["item"];

// Codex names MCP tools "<server>.<tool>"; Claude Code names them "mcp__<server>__<tool>".
const SEND_TOOL = /^(?:peer\.send|mcp__peer__send)$/;
const RECIPIENT = /(?:\(|Delivered to )([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)?\.$/i;

export interface OutgoingMessage {
  to: string;
  // The resolved recipient, once delivery has reported it.
  recipientId: string | null;
  body: string;
  status: "sending" | "delivered" | "failed";
  error: string | null;
}

function resultText(output: unknown): string | null {
  if (typeof output === "string") return output || null;
  if (Array.isArray(output)) {
    const text = output.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
    return text || null;
  }
  if (!output || typeof output !== "object") return null;
  // Codex keeps the MCP result; Claude wraps successful text in output and
  // keeps failed text blocks in the tool call's error.content.
  const result = output as { content?: unknown; output?: unknown; message?: unknown };
  return resultText(result.content) ?? resultText(result.output) ?? resultText(result.message);
}

/** Reads a peer.send tool call, or returns null for any other item. */
export function outgoingMessage(item: ToolCallItem): OutgoingMessage | null {
  if (item.type !== "tool_call" || !SEND_TOOL.test(item.name) || item.detail.type !== "unknown") return null;
  const input = item.detail.input as { to?: unknown; message?: unknown } | null;
  if (typeof input?.to !== "string" || typeof input.message !== "string") return null;
  const text = resultText(item.detail.output);
  const result = item.detail.output as { isError?: boolean } | null;
  const failed = item.status === "failed" || item.status === "canceled" || result?.isError === true;
  return {
    to: input.to,
    recipientId: !failed && text ? (RECIPIENT.exec(text)?.[1] ?? null) : null,
    body: input.message,
    status: failed ? "failed" : item.status === "completed" ? "delivered" : "sending",
    error: failed ? (text ?? resultText(item.error) ?? "Not delivered.") : null,
  };
}
