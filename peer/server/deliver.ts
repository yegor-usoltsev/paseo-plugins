import { wrap } from "../shared/envelope.ts";
import type { PaseoAgentSendOptions, PaseoApi } from "./sdk.ts";
import type { SendRequest, SendResult } from "./socket";

interface Recipient {
  id: string;
  title: string | null;
}

const FULL_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// Steer joins a running turn and starts a normal one when the agent is idle.
// Without it the daemon interrupts a running turn and cancels its subagents.
// SAFETY: the 0.10.3 SDK forwards this option but does not declare it.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The daemon accepts an option the SDK's send-options type omits.
const STEER = { activeTurnBehavior: "steer" } as PaseoAgentSendOptions;

// Lists every agent page from the cursor on and keeps the matching agents.
const findMatches = async (
  paseo: PaseoApi,
  wanted: string,
  cursor?: string
): Promise<Recipient[]> => {
  const { entries, pageInfo } = await paseo.agents.list({
    page: { cursor, limit: 200 },
  });
  const matches = entries.flatMap(({ agent }) =>
    agent.id.startsWith(wanted) || agent.title === wanted
      ? [{ id: agent.id, title: agent.title ?? null }]
      : []
  );
  const next = pageInfo.nextCursor ?? "";
  return next === ""
    ? matches
    : [...matches, ...(await findMatches(paseo, wanted, next))];
};

const resolveRecipient = async (
  paseo: PaseoApi,
  to: string
): Promise<Recipient> => {
  const wanted = to.trim();
  if (FULL_ID.test(wanted)) {
    const handle = paseo.agents.ref(wanted);
    await handle.refresh();
    const agent = handle.current();
    if (agent === null || (agent.archivedAt ?? "") !== "") {
      throw new Error(`No active agent has ID ${wanted}.`);
    }
    return { id: agent.id, title: agent.title ?? null };
  }
  const matches = await findMatches(paseo, wanted);
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length === 0) {
    throw new Error(`No active agent matches "${wanted}".`);
  }
  const names = matches
    .map((agent) => `${agent.id} (${agent.title ?? "untitled"})`)
    .join(", ");
  throw new Error(
    `"${wanted}" matches several agents: ${names}. Use a full agent ID.`
  );
};

export const deliver = async (
  paseo: PaseoApi,
  request: SendRequest
): Promise<SendResult> => {
  if (request.from === null || request.from === "") {
    return {
      ok: false,
      text: "Cannot tell which agent is sending: PASEO_AGENT_ID was not found.",
    };
  }
  const recipient = await resolveRecipient(paseo, request.to);
  if (recipient.id === request.from) {
    return { ok: false, text: "Refusing to send a message to yourself." };
  }
  await paseo.agents
    .ref(recipient.id)
    .send(wrap(request.from, request.message), STEER);
  const name =
    recipient.title === null || recipient.title === ""
      ? recipient.id
      : `${recipient.title} (${recipient.id})`;
  return { ok: true, text: `Delivered to ${name}.` };
};
