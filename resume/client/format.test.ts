import assert from "node:assert/strict";
import { test } from "node:test";
import { clockTime, pillLabel } from "./format.ts";

const now = new Date("2026-10-03T12:00:00Z");
const entry = { agentId: "child", jobId: "job", resumeAt: now.toISOString(), basis: "reset" as const, attempting: false };

test("a passed deadline does not claim dispatch has started", () => {
  assert.equal(pillLabel(entry, now), "Resume due");
  assert.equal(pillLabel({ ...entry, attempting: true }, now), "Resuming…");
});

test("waiting labels retain the basis of the next attempt", () => {
  const later = { ...entry, resumeAt: new Date(+now + 30 * 60_000).toISOString() };
  assert.equal(pillLabel(later, now), "Resumes in 30 min");
  assert.equal(pillLabel({ ...later, basis: "estimate" }, now), "Retry in 30 min");
  assert.equal(pillLabel({ ...later, basis: "retry" }, now), "Retry in 30 min");
});

test("a next-day attempt includes its local date", () => {
  const later = new Date(+now + 24 * 60 * 60_000);
  assert.ok(clockTime(later, now).includes(later.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })));
});
