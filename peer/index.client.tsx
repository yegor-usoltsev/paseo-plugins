import type { PluginClientContext } from "@getpaseo/plugin/client";

import { outgoingMessage } from "./client/outgoing";
import {
  OutgoingMessageCard,
  outgoingSchema,
  PeerMessageCard,
  peerMessageSchema,
} from "./client/peer-message";
import { unwrap } from "./shared/envelope";

const MESSAGE_KIND = "peer-message";
const OUTGOING_KIND = "peer-outgoing";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addTimelineTransformer({
      id: MESSAGE_KIND,
      query: { itemType: "user_message" },
      transform({ item }) {
        const message = unwrap(item.text);
        return message
          ? {
              items: [
                {
                  data: message,
                  kind: MESSAGE_KIND,
                  type: "plugin",
                  version: 1,
                },
              ],
            }
          : undefined;
      },
    }),
    client.addTimelineRenderer({
      Component: PeerMessageCard,
      kind: MESSAGE_KIND,
      schema: peerMessageSchema,
      version: 1,
    }),
    // Shows an agent's own peer.send calls as the messages they are.
    client.addTimelineTransformer({
      id: OUTGOING_KIND,
      query: { itemType: "tool_call" },
      transform({ item }) {
        const message = outgoingMessage(item);
        return message
          ? {
              items: [
                {
                  data: { ...message },
                  kind: OUTGOING_KIND,
                  type: "plugin",
                  version: 1,
                },
              ],
            }
          : undefined;
      },
    }),
    client.addTimelineRenderer({
      Component: OutgoingMessageCard,
      kind: OUTGOING_KIND,
      schema: outgoingSchema,
      version: 1,
    }),
  ];
  return () => {
    for (const cleanup of cleanups) {
      void cleanup();
    }
  };
}
