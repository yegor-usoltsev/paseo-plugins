// The first line of a peer message names the sender. The format predates this
// plugin, so messages written by older tooling render the same way.
const ENVELOPE = /^\[from:(?<senderId>[^\]\s]+)\]\r?\n/u;

export const wrap = (senderId: string, text: string): string =>
  `[from:${senderId}]\n${text}`;

export const unwrap = (
  text: string
): { senderId: string; body: string } | null => {
  const match = ENVELOPE.exec(text);
  return match?.groups
    ? { body: text.slice(match[0].length), senderId: match.groups.senderId }
    : null;
};
