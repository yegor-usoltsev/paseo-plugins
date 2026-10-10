import assert from "node:assert/strict";
import { test } from "node:test";

import { outgoingMessage } from "./outgoing.ts";
import type { ToolCallItem } from "./outgoing.ts";

const id = "edd464fe-6761-4d1f-8075-deb619c0d3a1";
const call = (name: string, status: string, text: string | null) =>
  ({
    callId: "c1",
    detail: {
      input: { message: "Review abc123.", to: "edd464fe" },
      output: text === null ? null : { content: [{ text, type: "text" }] },
      type: "unknown",
    },
    error: status === "failed" ? { message: "boom" } : null,
    name,
    status,
    type: "tool_call",
  }) as unknown as ToolCallItem;

test("a delivered Codex send names the resolved recipient", () => {
  assert.deepEqual(
    outgoingMessage(
      call("peer.send", "completed", `Delivered to Claude reviewer (${id}).`)
    ),
    {
      body: "Review abc123.",
      error: null,
      recipientId: id,
      status: "delivered",
      to: "edd464fe",
    }
  );
});

test("Claude's tool name and a running call read as sending", () => {
  assert.equal(
    outgoingMessage(call("mcp__peer__send", "running", null))?.status,
    "sending"
  );
});

test("a failed send carries the plugin's explanation", () => {
  const message = outgoingMessage(
    call("peer.send", "failed", 'No active agent matches "edd464fe".')
  );
  assert.equal(message?.status, "failed");
  assert.equal(message?.error, 'No active agent matches "edd464fe".');
});

test("other tools are left alone", () => {
  assert.equal(
    outgoingMessage(call("paseo.create_agent", "completed", "ok")),
    null
  );
});

test("Claude's wrapped text resolves a successful recipient", () => {
  const item = call("mcp__peer__send", "completed", null);
  if (item.type !== "tool_call" || item.detail.type !== "unknown") {
    throw new Error("bad fixture");
  }
  item.detail.output = { output: `Delivered to Claude reviewer (${id}).` };
  assert.equal(outgoingMessage(item)?.recipientId, id);
});

test("Claude's failed tool result retains its text blocks", () => {
  const item = call("mcp__peer__send", "failed", null);
  if (item.type !== "tool_call") {
    throw new Error("bad fixture");
  }
  item.error = {
    content: [{ text: "The peer plugin is unreachable.", type: "text" }],
    is_error: true,
  };
  assert.equal(outgoingMessage(item)?.error, "The peer plugin is unreachable.");
});

test("transport errors retain their message", () => {
  assert.equal(
    outgoingMessage(call("peer.send", "failed", null))?.error,
    "boom"
  );
});

test("an MCP error result is not successful delivery", () => {
  const item = call("peer.send", "completed", "No matching agent.");
  if (item.type !== "tool_call" || item.detail.type !== "unknown") {
    throw new Error("bad fixture");
  }
  item.detail.output = {
    content: [{ text: "No matching agent.", type: "text" }],
    isError: true,
  };
  assert.equal(outgoingMessage(item)?.status, "failed");
  assert.equal(outgoingMessage(item)?.error, "No matching agent.");
});

test("an untitled recipient still exposes its resolved ID", () => {
  assert.equal(
    outgoingMessage(call("peer.send", "completed", `Delivered to ${id}.`))
      ?.recipientId,
    id
  );
});

test("outgoing cards retain whitespace and Unicode for both providers", () => {
  const body =
    "Финальный мой proposal: 43 lines (668 words vs 575).\n\n  git apply --check\r\n\t👋 café\n";
  for (const name of ["peer.send", "mcp__peer__send"]) {
    const item = call(name, "completed", `Delivered to ${id}.`);
    if (item.type !== "tool_call" || item.detail.type !== "unknown") {
      throw new Error("bad fixture");
    }
    item.detail.input = { message: body, to: id };
    assert.equal(outgoingMessage(item)?.body, body);
  }
});
