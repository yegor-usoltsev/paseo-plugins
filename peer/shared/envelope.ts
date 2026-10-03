// The first line of a peer message names the sender. The format predates this
// plugin, so messages written by older tooling render the same way.
const ENVELOPE = /^\[from:([^\]\s]+)\]\r?\n/;

export function wrap(senderId: string, text: string): string {
  return `[from:${senderId}]\n${text}`;
}

export function unwrap(text: string): { senderId: string; body: string } | null {
  const match = ENVELOPE.exec(text);
  return match ? { senderId: match[1], body: text.slice(match[0].length) } : null;
}
