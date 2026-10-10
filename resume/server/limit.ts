import type { PluginTurnOutcome } from "@getpaseo/plugin/server";

import type { AgentTimelineItem } from "./sdk.ts";

// Codex fails the turn with "You've hit your usage limit. ... try again at Sep
// 26th, 2026 11:33 AM.", or "try again at 4:06 PM." when the reset is within a
// day. Claude Code ends the turn with a notice that is the
// whole message, such as "You've hit your session limit · resets 3:40pm (UTC)".
// Short-lived API throttling is the provider's own retry business, not ours.
const CODEX_FAILURE = /^you['’]ve hit your usage limit(?:[.!]|$)/i;
const NOTICE =
  /^(?:claude ai usage limit reached|you['’]ve hit your (?:(?:usage|session) )?limit)(?:\s*[·•|]\s*resets\b[^\n]*|\|\d+)?\.?$/i;
const TRY_AGAIN_AT =
  /try again at (?:([A-Z][a-z]{2,8} \d{1,2})(?:st|nd|rd|th)?,? (\d{4}),? )?(\d{1,2}):(\d{2})\s*([AP]M)/i;
const CLAUDE_RESET =
  /\bresets\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)\s*\(([^)]+)\)/i;

/** Returns the limit message when the turn stopped on a usage limit. */
export function limitMessage(
  provider: string,
  outcome: PluginTurnOutcome,
  timeline: readonly AgentTimelineItem[]
): string | null {
  const family = provider.split("/")[0];
  if (outcome.kind === "failed") {
    const text = outcome.error.message.trim();
    const pattern =
      family === "codex" ? CODEX_FAILURE : family === "claude" ? NOTICE : null;
    return pattern?.test(text) ? outcome.error.message : null;
  }
  if (family !== "claude") return null;
  if (outcome.kind !== "completed") return null;
  const last = timeline.at(-1);
  if (last?.type !== "assistant_message") return null;
  const text = last.text.trim();
  return NOTICE.test(text) ? text : null;
}

// Resolve a wall-clock time using the notice's zone, independently of the
// daemon's TZ. Check both sides of a DST transition to retain repeated hours.
function nextZonedTime(
  hour: number,
  minute: number,
  zone: string,
  now: Date
): Date | null {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }
  const wallTime = (instant: number) => {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(instant)
        .map(({ type, value }) => [type, Number(value)])
    );
    return Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
  };
  const day = 24 * 60 * 60_000;
  const today = new Date(wallTime(now.getTime()));
  today.setUTCHours(hour, minute, 0, 0);
  // A nonexistent spring-forward time is skipped until the next day.
  for (let days = 0; days < 3; days++) {
    const wanted = today.getTime() + days * day;
    const offsets = new Set(
      [-day, 0, day].map((delta) => wallTime(wanted + delta) - (wanted + delta))
    );
    const candidates = [...offsets]
      .map((offset) => wanted - offset)
      .filter(
        (instant) => instant > now.getTime() && wallTime(instant) === wanted
      );
    if (candidates.length) return new Date(Math.min(...candidates));
  }
  return null;
}

/** Reads Claude's zoned reset or Codex's local "try again at" time. */
export function retryTimeFromMessage(message: string, now: Date): Date | null {
  const claude = CLAUDE_RESET.exec(message);
  if (claude) {
    const [, hour, minute = "0", half, zone] = claude;
    if (Number(hour) < 1 || Number(hour) > 12 || Number(minute) > 59)
      return null;
    return nextZonedTime(
      (Number(hour) % 12) + (half.toUpperCase() === "PM" ? 12 : 0),
      Number(minute),
      zone.trim(),
      now
    );
  }
  const match = TRY_AGAIN_AT.exec(message);
  if (!match) return null;
  const [, day, year, hour, minute, half] = match;
  if (Number(hour) < 1 || Number(hour) > 12 || Number(minute) > 59) return null;
  const parsed = day ? new Date(`${day}, ${year}`) : new Date(now);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(
    (Number(hour) % 12) + (half.toUpperCase() === "PM" ? 12 : 0),
    Number(minute),
    0,
    0
  );
  // A time without a date is the next such time of day.
  if (!day && parsed <= now) parsed.setDate(parsed.getDate() + 1);
  return parsed;
}

interface UsageWindow {
  id?: string;
  usedPct?: number | null;
  remainingPct?: number | null;
  resetsAt?: string | null;
  summary?: boolean;
}

interface ProviderUsage {
  providerId: string;
  windows: readonly UsageWindow[];
}

// Model, feature and code-review quotas. Codex 0.11 prefixes their IDs with a
// scope ("limit:<feature>:five_hour"), Claude 0.11 names them
// "weekly_<model|surface>_<id>", and Codex 0.10 reports "code_review".
const SCOPED_WINDOW = /:|^weekly_|^code_review$/;

/**
 * The provider's windows that bound any of its agents. Paseo 0.11 lists each
 * discovered account under the same provider ID without saying which one an
 * agent uses, so several entries are ambiguous. Scoped quotas never apply to
 * every agent; when summary flags are present, only those windows do.
 */
export function providerWindows(
  providers: readonly ProviderUsage[],
  provider: string
): readonly UsageWindow[] {
  const entries = providers.filter((entry) => entry.providerId === provider);
  if (entries.length !== 1) return [];
  const windows = entries[0].windows.filter(
    (window) => !window.id || !SCOPED_WINDOW.test(window.id)
  );
  return windows.some((window) => window.summary)
    ? windows.filter((window) => window.summary)
    : windows;
}

/** The latest reset among the provider's exhausted windows that are still in the future. */
export function retryTimeFromUsage(
  windows: readonly UsageWindow[],
  now: Date
): Date | null {
  const exhausted = windows
    .filter(
      (window) =>
        (window.usedPct ?? 0) >= 99.5 || (window.remainingPct ?? 100) <= 0.5
    )
    .map((window) => (window.resetsAt ? new Date(window.resetsAt) : null))
    .filter(
      (date): date is Date => date !== null && date.getTime() > now.getTime()
    );
  if (exhausted.length === 0) return null;
  return new Date(Math.max(...exhausted.map((date) => date.getTime())));
}
