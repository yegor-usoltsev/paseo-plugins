import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import { z } from "zod";

export type ToolCallItem = Parameters<
  PluginTimelineTransformerContribution<"tool_call">["transform"]
>[0]["item"];

const SEND_TOOL = /^(?:peer\.send|mcp__peer__send)$/u;
const RECIPIENT =
  /(?:\(|Delivered to )(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)?\.$/iu;

export interface OutgoingMessage {
  to: string;
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
