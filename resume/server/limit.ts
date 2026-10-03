import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PluginTurnOutcome } from "@getpaseo/plugin/server";

// Codex fails the turn with "You've hit your usage limit. ... try again at Sep
// 26th, 2026 11:33 AM.", or "try again at 4:06 PM." when the reset is within a
// day. Claude Code ends the turn with a notice that is the
// whole message, such as "You've hit your session limit · resets 3:40pm (UTC)".
// Short-lived API throttling is the provider's own retry business, not ours.
const CODEX_FAILURE = /^you['’]ve hit your usage limit(?:[.!]|$)/i;
const NOTICE = /^(?:claude ai usage limit reached|you['’]ve hit your (?:(?:usage|session) )?limit)(?:\s*[·•|]\s*resets\b[^\n]*|\|\d+)?\.?$/i;
const TRY_AGAIN_AT = /try again at (?:([A-Z][a-z]{2,8} \d{1,2})(?:st|nd|rd|th)?,? (\d{4}),? )?(\d{1,2}):(\d{2})\s*([AP]M)/i;

/** Returns the limit message when the turn stopped on a usage limit. */
export function limitMessage(provider: string, outcome: PluginTurnOutcome, timeline: readonly AgentTimelineItem[]): string | null {
  const family = provider.split("/")[0];
  if (outcome.kind === "failed") {
    const text = outcome.error.message.trim();
    const pattern = family === "codex" ? CODEX_FAILURE : family === "claude" ? NOTICE : null;
    return pattern?.test(text) ? outcome.error.message : null;
  }
  if (family !== "claude") return null;
  if (outcome.kind !== "completed") return null;
  const last = timeline.at(-1);
  if (last?.type !== "assistant_message") return null;
  const text = last.text.trim();
  return NOTICE.test(text) ? text : null;
}

/** Reads Codex's local "try again at" time from a limit message. */
export function retryTimeFromMessage(message: string, now: Date): Date | null {
  const match = TRY_AGAIN_AT.exec(message);
  if (!match) return null;
  const [, day, year, hour, minute, half] = match;
  const parsed = day ? new Date(`${day}, ${year}`) : new Date(now);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours((Number(hour) % 12) + (half.toUpperCase() === "PM" ? 12 : 0), Number(minute), 0, 0);
  // A time without a date is the next such time of day.
  if (!day && parsed <= now) parsed.setDate(parsed.getDate() + 1);
  return parsed;
}

interface UsageWindow {
  usedPct?: number | null;
  remainingPct?: number | null;
  resetsAt?: string | null;
}

/** The latest reset among the provider's exhausted windows that are still in the future. */
export function retryTimeFromUsage(windows: readonly UsageWindow[], now: Date): Date | null {
  const exhausted = windows
    .filter((window) => (window.usedPct ?? 0) >= 99.5 || (window.remainingPct ?? 100) <= 0.5)
    .map((window) => (window.resetsAt ? new Date(window.resetsAt) : null))
    .filter((date): date is Date => date !== null && date.getTime() > now.getTime());
  if (exhausted.length === 0) return null;
  return new Date(Math.max(...exhausted.map((date) => date.getTime())));
}
