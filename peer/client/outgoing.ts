// Paseo compiles plugins without their node_modules, so every type comes from
// @getpaseo/plugin, which the host provides.
import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import { z } from "zod";

export type ToolCallItem = Parameters<
  PluginTimelineTransformerContribution<"tool_call">["transform"]
>[0]["item"];

// Codex names MCP tools "<server>.<tool>"; Claude Code names them "mcp__<server>__<tool>".
const SEND_TOOL = /^(?:peer\.send|mcp__peer__send)$/u;
const RECIPIENT =
  /(?:\(|Delivered to )(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)?\.$/iu;

export interface OutgoingMessage {
  to: string;
  // The resolved recipient, once delivery has reported it.
  recipientId: string | null;
  body: string;
  status: "sending" | "delivered" | "failed";
  error: string | null;
}

const textPartSchema = z.object({ text: z.string(), type: z.literal("text") });

const joinTextParts = (parts: unknown[]) =>
  parts
    .flatMap((part) => {
      const parsed = textPartSchema.safeParse(part);
      return parsed.success ? [parsed.data.text] : [];
    })
    .join("\n");

// Reads the text of a tool result, or null when it has none. Codex keeps the
// MCP result; Claude wraps successful text in output and keeps failed text
// blocks in the tool call's error.content.
const resultTextSchema: z.ZodType<string | null> = z.lazy(() =>
  z
    .union([
      z.string(),
      z.array(z.unknown()).transform(joinTextParts),
      z
        .object({
          content: resultTextSchema.optional(),
          message: resultTextSchema.optional(),
          output: resultTextSchema.optional(),
        })
        .transform(
          ({ content, message, output }) => content ?? output ?? message ?? null
        ),
      z.unknown().transform(() => null),
    ])
    .transform((text) => (text === "" ? null : text))
);

const sendInputSchema = z.object({ message: z.string(), to: z.string() });
const mcpErrorSchema = z.object({ isError: z.literal(true) });

const deliveryStatus = (
  failed: boolean,
  status: ToolCallItem["status"]
): OutgoingMessage["status"] => {
  if (failed) {
    return "failed";
  }
  return status === "completed" ? "delivered" : "sending";
};

/** Reads a peer.send tool call, or returns null for any other item. */
export const outgoingMessage = (item: ToolCallItem): OutgoingMessage | null => {
  if (
    item.type !== "tool_call" ||
    !SEND_TOOL.test(item.name) ||
    item.detail.type !== "unknown"
  ) {
    return null;
  }
  const input = sendInputSchema.safeParse(item.detail.input);
  if (!input.success) {
    return null;
  }
  const text = resultTextSchema.parse(item.detail.output);
  const failed =
    item.status === "failed" ||
    item.status === "canceled" ||
    mcpErrorSchema.safeParse(item.detail.output).success;
  return {
    body: input.data.message,
    error: failed
      ? (text ?? resultTextSchema.parse(item.error) ?? "Not delivered.")
      : null,
    recipientId:
      !failed && text !== null
        ? (RECIPIENT.exec(text)?.groups?.id ?? null)
        : null,
    status: deliveryStatus(failed, item.status),
    to: input.data.to,
  };
};
