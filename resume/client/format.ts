import type { PendingEntry } from "../shared/rpc";

// Times are shown in the client's own time zone: the daemon may run elsewhere.
/**
 * Formats a time of day, with the date when it is not today.
 *
 * @param at - The time to format.
 * @param now - The current time.
 * @returns The formatted time.
 */
export const clockTime = (at: Date, now = new Date()): string => {
  const time = at.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (at.toDateString() === now.toDateString()) {
    return time;
  }
  return `${at.toLocaleDateString([], { day: "numeric", month: "short", weekday: "short" })}, ${time}`;
};

/**
 * Formats how long until a time, such as "in 1 h 5 min".
 *
 * @param at - The time to count down to.
 * @param now - The current time.
 * @returns The countdown, or "now" once it has passed.
 */
export const untilTime = (at: Date, now = new Date()): string => {
  const minutes = Math.ceil((at.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) {
    return "now";
  }
  if (minutes < 60) {
    return `in ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours} h` : `in ${hours} h ${rest} min`;
};

/**
 * Labels the composer pill of a pending resume.
 *
 * @param entry - The pending resume.
 * @param now - The current time.
 * @returns The pill label.
 */
export const pillLabel = (entry: PendingEntry, now = new Date()): string => {
  if (entry.attempting) {
    return "Resuming…";
  }
  const when = untilTime(new Date(entry.resumeAt), now);
  if (when === "now") {
    return "Resume due";
  }
  return entry.basis === "reset" ? `Resumes ${when}` : `Retry ${when}`;
};
