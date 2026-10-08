import assert from "node:assert/strict";
import { test } from "node:test";
import { limitMessage, providerWindows, retryTimeFromMessage, retryTimeFromUsage } from "./limit.ts";

const codex =
  "You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 26th, 2026 11:33 AM.";

test("a failed Codex turn is a limit stop", () => {
  assert.equal(limitMessage("codex", { kind: "failed", error: { message: codex } }, []), codex);
});

test("an ordinary failure is not", () => {
  assert.equal(limitMessage("claude", { kind: "failed", error: { message: "Connection reset" } }, []), null);
});

test("a short Claude notice ends a completed turn", () => {
  const notice = "You've hit your limit · resets 3am (Europe/Berlin)";
  assert.equal(limitMessage("claude", { kind: "completed" }, [{ type: "assistant_message", text: notice }]), notice);
});

test("Claude session-limit notices end completed and failed turns", () => {
  for (const notice of [
    "You've hit your session limit · resets 3:40pm (UTC)",
    "You’ve hit your session limit · resets 3:40pm (UTC)",
  ]) {
    assert.equal(limitMessage("claude", { kind: "completed" }, [{ type: "assistant_message", text: notice }]), notice);
    assert.equal(limitMessage("claude", { kind: "failed", error: { message: notice } }, []), notice);
  }
});

test("other Claude notice forms end a completed turn", () => {
  for (const notice of ["Claude AI usage limit reached|1791048000", "You've hit your usage limit"]) {
    assert.equal(limitMessage("claude", { kind: "completed" }, [{ type: "assistant_message", text: notice }]), notice);
  }
});

test("an assistant reply that discusses limits is not a stop", () => {
  for (const reply of [
    "I added a rate limit check; you've hit your usage limit only when the counter overflows.",
    "You've hit your usage limit is the error string we now detect. All requested tests passed.",
    "You've hit your session limit is the notice we now detect. All requested tests passed.",
  ]) {
    assert.equal(limitMessage("claude", { kind: "completed" }, [{ type: "assistant_message", text: reply }]), null);
  }
});

test("API throttling is not a usage-limit stop", () => {
  assert.equal(limitMessage("claude", { kind: "failed", error: { message: "429 rate limit exceeded, retry later" } }, []), null);
});

test("Codex's try-again time is read as local time", () => {
  assert.deepEqual(retryTimeFromMessage(codex, new Date(2026, 8, 26, 9, 0)), new Date(2026, 8, 26, 11, 33));
});

test("a try-again time without a date is its next occurrence", () => {
  const message = "You’ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage or try again at 4:06 PM.";
  assert.deepEqual(retryTimeFromMessage(message, new Date(2026, 9, 3, 15, 52)), new Date(2026, 9, 3, 16, 6));
  assert.deepEqual(retryTimeFromMessage(message, new Date(2026, 9, 3, 16, 10)), new Date(2026, 9, 4, 16, 6));
  const midnight = "You’ve hit your usage limit. Try again at 12:15 AM.";
  assert.deepEqual(retryTimeFromMessage(midnight, new Date(2026, 9, 3, 23, 50)), new Date(2026, 9, 4, 0, 15));
});

test("Claude's named timezone controls the reset independently of the daemon TZ", (t) => {
  const old = process.env.TZ;
  t.after(() => { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; });
  for (const zone of ["UTC", "Europe/Minsk", "America/Los_Angeles"]) {
    process.env.TZ = zone;
    assert.deepEqual(
      retryTimeFromMessage("You've hit your session limit · resets 11:40pm (Europe/Minsk)", new Date("2026-10-03T17:32:00Z")),
      new Date("2026-10-03T20:40:00Z"),
    );
  }
});

test("Claude reset times cross midnight in the notice's timezone", () => {
  assert.deepEqual(
    retryTimeFromMessage("You've hit your limit · resets 12:15am (Europe/Minsk)", new Date("2026-10-03T20:50:00Z")),
    new Date("2026-10-03T21:15:00Z"),
  );
  assert.deepEqual(
    retryTimeFromMessage("You've hit your limit · resets 3am (UTC)", new Date("2026-10-03T04:00:00Z")),
    new Date("2026-10-04T03:00:00Z"),
  );
});

test("Claude reset times respect DST transitions and repeated hours", () => {
  const notice = "You've hit your limit · resets 1:30am (America/New_York)";
  assert.deepEqual(retryTimeFromMessage(notice, new Date("2026-11-01T05:45:00Z")), new Date("2026-11-01T06:30:00Z"));
  assert.deepEqual(
    retryTimeFromMessage("You've hit your limit · resets 2:30am (America/New_York)", new Date("2026-03-08T06:00:00Z")),
    new Date("2026-03-09T06:30:00Z"),
  );
});

test("invalid Claude zones and wall-clock times keep the fallback", () => {
  for (const time of ["3am (Unknown/Zone)", "13pm (UTC)", "0am (UTC)", "3:60pm (UTC)"]) {
    assert.equal(retryTimeFromMessage(`You've hit your limit · resets ${time}`, new Date("2026-10-03T12:00:00Z")), null);
  }
});

test("the latest exhausted future window wins", () => {
  const now = new Date("2026-10-03T12:00:00Z");
  const windows = [
    { usedPct: 100, resetsAt: "2026-10-03T15:00:00Z" },
    { usedPct: 100, resetsAt: "2026-10-05T00:00:00Z" },
    { usedPct: 40, resetsAt: "2026-10-03T13:00:00Z" },
    { usedPct: 100, resetsAt: "2026-10-03T11:00:00Z" },
  ];
  assert.deepEqual(retryTimeFromUsage(windows, now), new Date("2026-10-05T00:00:00Z"));
  assert.equal(retryTimeFromUsage([{ usedPct: 40, resetsAt: "2026-10-03T13:00:00Z" }], now), null);
});

test("several accounts of one provider give no usage windows", () => {
  const window = { usedPct: 100, resetsAt: "2026-10-03T15:00:00Z" };
  const providers = [
    { providerId: "codex", windows: [window] },
    { providerId: "codex", windows: [{ ...window, resetsAt: "2026-10-03T18:00:00Z" }] },
    { providerId: "claude", windows: [window] },
  ];
  assert.deepEqual(providerWindows(providers, "codex"), []);
  assert.deepEqual(providerWindows(providers, "claude"), [window]);
  assert.deepEqual(providerWindows(providers, "other"), []);
});

test("model and feature quotas are ignored when summary windows are flagged", () => {
  const now = new Date("2026-10-03T12:00:00Z");
  const windows = [
    { usedPct: 100, resetsAt: "2026-10-03T13:00:00Z", summary: true },
    { usedPct: 10, resetsAt: "2026-10-08T00:00:00Z", summary: true },
    { usedPct: 100, resetsAt: "2026-10-03T18:00:00Z", summary: false },
    { usedPct: 100, resetsAt: "2026-10-04T00:00:00Z" },
  ];
  const applicable = providerWindows([{ providerId: "codex", windows }], "codex");
  assert.deepEqual(retryTimeFromUsage(applicable, now), new Date("2026-10-03T13:00:00Z"));
  // Paseo 0.10 reports no summary flags, so every window still applies.
  const unflagged = windows.map(({ summary: _, ...window }) => window);
  assert.equal(providerWindows([{ providerId: "codex", windows: unflagged }], "codex").length, 4);
});

test("reports with only scoped quotas give no usage windows", () => {
  const scoped = (id: string) => ({ id, usedPct: 100, resetsAt: "2026-10-03T18:00:00Z" });
  // Paseo 0.11 omits the summary flag from scoped windows rather than setting it false.
  const codex = [scoped("limit:other-model:five_hour"), scoped("code_review:weekly")];
  const claude = [scoped("weekly_model_opus"), scoped("weekly_surface_web")];
  assert.deepEqual(providerWindows([{ providerId: "codex", windows: codex }], "codex"), []);
  assert.deepEqual(providerWindows([{ providerId: "claude", windows: claude }], "claude"), []);
  const legacy = [{ id: "session", usedPct: 100, resetsAt: "2026-10-03T13:00:00Z" }, scoped("code_review")];
  assert.deepEqual(providerWindows([{ providerId: "codex", windows: legacy }], "codex"), [legacy[0]]);
});


test("usage-limit detection is scoped to provider notice forms", () => {
  for (const provider of ["codex", "claude", "other"]) {
    assert.equal(limitMessage(provider, { kind: "failed", error: {
      message: "The API reports usage limit reached for requests per second",
    } }, []), null);
  }
  const notice = "You've hit your session limit · resets 3:40pm (UTC)";
  assert.equal(limitMessage("codex", { kind: "completed" }, [{ type: "assistant_message", text: notice }]), null);
  assert.equal(limitMessage("other", { kind: "failed", error: { message: codex } }, []), null);
  assert.equal(limitMessage("codex/custom", { kind: "failed", error: { message: codex } }, []), codex);
});
