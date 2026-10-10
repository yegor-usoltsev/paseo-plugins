import assert from "node:assert/strict";
import { test } from "node:test";

import { unwrap } from "../shared/envelope.ts";
import { deliver } from "./deliver.ts";
import type { PaseoAgentSendOptions, PaseoApi } from "./sdk.ts";

const id = "11111111-1111-1111-1111-111111111111";
const fixture = (
  pages: { id: string; title: string | null }[][],
  archivedAt: string | null = null
) => {
  const cursors: unknown[] = [];
  const sent: { id: string; options: PaseoAgentSendOptions; text: string }[] =
    [];
  const fakeApi = {
    agents: {
      list: async ({ page }: { page: { cursor?: string } }) => {
        cursors.push(page.cursor);
        const index = Number(page.cursor ?? 0);
        return {
          entries: pages[index].map((agent) => ({ agent })),
          pageInfo: {
            nextCursor: index + 1 < pages.length ? String(index + 1) : null,
          },
        };
      },
      ref: (agentId: string) => ({
        current: () => ({ archivedAt, id: agentId, title: "recipient" }),
        refresh: async () => {},
        send: async (text: string, options: PaseoAgentSendOptions) => {
          sent.push({ id: agentId, options, text });
        },
      }),
    },
  };
  // SAFETY: the fake implements only the SDK members these tests exercise.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, typescript/no-unsafe-type-assertion -- A partial fake stands in for the host SDK type.
  const api = fakeApi as unknown as PaseoApi;
  return { api, cursors, sent };
};

test("full IDs are fetched directly and delivery always steers", async () => {
  const h = fixture([]);
  await deliver(h.api, { from: "sender", message: "hello", to: id });
  assert.deepEqual(h.cursors, []);
  assert.deepEqual(h.sent, [
    {
      id,
      options: { activeTurnBehavior: "steer" },
      text: "[from:sender]\nhello",
    },
  ]);
});

test("delivery preserves Unicode, whitespace, and numeric text verbatim", async () => {
  const h = fixture([]);
  const message =
    "Финальный мой proposal: 43 lines (668 words vs 575).\r\n\r\n  git apply --check\n\tPaths: /tmp/a b/changes.patch\nEmoji: 👋; Unicode: café\n";
  await deliver(h.api, { from: "sender", message, to: id });
  const [sent] = h.sent;
  assert.equal(sent.text, `[from:sender]\n${message}`);
  assert.deepEqual(unwrap(sent.text), { body: message, senderId: "sender" });
});

test("prefixes resolve beyond the first page", async () => {
  const h = fixture([
    [{ id: "other", title: null }],
    [{ id, title: "recipient" }],
  ]);
  await deliver(h.api, { from: "sender", message: "hello", to: "11111111" });
  assert.deepEqual(h.cursors, [undefined, "1"]);
  assert.equal(h.sent.length, 1);
});

test("a duplicate title on a later page is ambiguous", async () => {
  const h = fixture([
    [{ id, title: "recipient" }],
    [{ id: "other", title: "recipient" }],
  ]);
  await assert.rejects(
    deliver(h.api, { from: "sender", message: "hello", to: "recipient" }),
    /matches several agents/u
  );
  assert.equal(h.sent.length, 0);
});

test("an archived full ID cannot receive a message", async () => {
  const h = fixture([], new Date().toISOString());
  await assert.rejects(
    deliver(h.api, { from: "sender", message: "hello", to: id }),
    /No active agent/u
  );
  assert.equal(h.sent.length, 0);
});
