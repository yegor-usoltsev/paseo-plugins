// The first line of a peer message names the sender. The format predates this
// plugin, so messages written by older tooling render the same way.
const ENVELOPE = /^\[from:(?<senderId>[^\]\s]+)\]\r?\n/u;

/**
 * Prefixes a message with its sender's envelope line.
 *
 * @param senderId - The sending agent's ID.
 * @param text - The message text.
 * @returns The message as the recipient receives it.
 */
export const wrap = (senderId: string, text: string): string =>
  `[from:${senderId}]\n${text}`;

/**
 * Splits a received message into its sender and body.
 *
 * @param text - A user message from the timeline.
 * @returns The sender and body, or null when the text has no envelope.
 */
export const unwrap = (
  text: string
): { senderId: string; body: string } | null => {
  const match = ENVELOPE.exec(text);
  return match?.groups
    ? { body: text.slice(match[0].length), senderId: match.groups.senderId }
    : null;
};
