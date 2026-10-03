import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaseoApi } from "@getpaseo/client";
import { deliver } from "./deliver.ts";

const id = "11111111-1111-1111-1111-111111111111";
function fixture(pages: { id: string; title: string | null }[][], archivedAt: string | null = null) {
  const cursors: unknown[] = [];
  const sent: unknown[] = [];
  const api = { agents: {
    list: async ({ page }: any) => {
      cursors.push(page.cursor);
      const index = Number(page.cursor ?? 0);
      return { entries: pages[index].map(agent => ({ agent })), pageInfo: { nextCursor: index + 1 < pages.length ? String(index + 1) : null } };
    },
    ref: (agentId: string) => ({
      refresh: async () => {},
      current: () => ({ id: agentId, title: "recipient", archivedAt }),
      send: async (text: string, options: unknown) => { sent.push({ id: agentId, text, options }); },
    }),
  } } as unknown as PaseoApi;
  return { api, sent, cursors };
}

test("full IDs are fetched directly and delivery always steers", async () => {
  const h = fixture([]);
  await deliver(h.api, { from: "sender", to: id, message: "hello" });
  assert.deepEqual(h.cursors, []);
  assert.deepEqual(h.sent, [{ id, text: "[from:sender]\nhello", options: { activeTurnBehavior: "steer" } }]);
});

test("prefixes resolve beyond the first page", async () => {
  const h = fixture([[{ id: "other", title: null }], [{ id, title: "recipient" }]]);
  await deliver(h.api, { from: "sender", to: "11111111", message: "hello" });
  assert.deepEqual(h.cursors, [undefined, "1"]);
  assert.equal(h.sent.length, 1);
});

test("a duplicate title on a later page is ambiguous", async () => {
  const h = fixture([[{ id, title: "recipient" }], [{ id: "other", title: "recipient" }]]);
  await assert.rejects(deliver(h.api, { from: "sender", to: "recipient", message: "hello" }), /matches several agents/);
  assert.equal(h.sent.length, 0);
});

test("an archived full ID cannot receive a message", async () => {
  const h = fixture([], new Date().toISOString());
  await assert.rejects(deliver(h.api, { from: "sender", to: id, message: "hello" }), /No active agent/);
  assert.equal(h.sent.length, 0);
});
