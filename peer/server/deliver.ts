import type { PaseoAgentSendOptions, PaseoApi } from "./sdk.ts";
import { wrap } from "../shared/envelope.ts";
import type { SendRequest, SendResult } from "./socket";

interface Recipient {
  id: string;
  title: string | null;
}

const FULL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Steer joins a running turn and starts a normal one when the agent is idle.
// Without it the daemon interrupts a running turn and cancels its subagents.
// The 0.10.3 SDK forwards this option but does not declare it.
const STEER = { activeTurnBehavior: "steer" } as PaseoAgentSendOptions;

async function resolveRecipient(paseo: PaseoApi, to: string): Promise<Recipient> {
  const wanted = to.trim();
  if (FULL_ID.test(wanted)) {
    const handle = paseo.agents.ref(wanted);
    await handle.refresh();
    const agent = handle.current();
    if (!agent || agent.archivedAt) throw new Error(`No active agent has ID ${wanted}.`);
    return { id: agent.id, title: agent.title ?? null };
  }
  const matches: Recipient[] = [];
  let cursor: string | undefined;
  do {
    const { entries, pageInfo } = await paseo.agents.list({ page: { limit: 200, cursor } });
    for (const { agent } of entries) {
      if (agent.id.startsWith(wanted) || agent.title === wanted) {
        matches.push({ id: agent.id, title: agent.title ?? null });
      }
    }
    cursor = pageInfo.nextCursor ?? undefined;
  } while (cursor);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`No active agent matches "${wanted}".`);
  const names = matches.map((agent) => `${agent.id} (${agent.title ?? "untitled"})`).join(", ");
  throw new Error(`"${wanted}" matches several agents: ${names}. Use a full agent ID.`);
}

export async function deliver(paseo: PaseoApi, request: SendRequest): Promise<SendResult> {
  if (!request.from) {
    return { ok: false, text: "Cannot tell which agent is sending: PASEO_AGENT_ID was not found." };
  }
  const recipient = await resolveRecipient(paseo, request.to);
  if (recipient.id === request.from) {
    return { ok: false, text: "Refusing to send a message to yourself." };
  }
  await paseo.agents.ref(recipient.id).send(wrap(request.from, request.message), STEER);
  const name = recipient.title ? `${recipient.title} (${recipient.id})` : recipient.id;
  return { ok: true, text: `Delivered to ${name}.` };
}
