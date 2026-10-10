import type { PluginClientContext } from "@getpaseo/plugin/client";

import { outgoingMessage } from "./client/outgoing";
import {
  OutgoingMessageCard,
  outgoingSchema,
  PeerMessageCard,
  peerMessageSchema,
} from "./client/peer-message";
import { unwrap } from "./shared/envelope";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addTimelineTransformer({
      id: "peer-message",
      query: { itemType: "user_message" },
      transform({ item }) {
        const message = unwrap(item.text);
        if (!message) return undefined;
        return {
          items: [
            { type: "plugin", kind: "peer-message", version: 1, data: message },
          ],
        };
      },
    }),
    client.addTimelineRenderer({
      kind: "peer-message",
      version: 1,
      schema: peerMessageSchema,
      Component: PeerMessageCard,
    }),
    // Shows an agent's own peer.send calls as the messages they are.
    client.addTimelineTransformer({
      id: "peer-outgoing",
      query: { itemType: "tool_call" },
      transform({ item }) {
        const message = outgoingMessage(item);
        if (!message) return undefined;
        return {
          items: [
            {
              type: "plugin",
              kind: "peer-outgoing",
              version: 1,
              data: { ...message },
            },
          ],
        };
      },
    }),
    client.addTimelineRenderer({
      kind: "peer-outgoing",
      version: 1,
      schema: outgoingSchema,
      Component: OutgoingMessageCard,
    }),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
