import { useAgent, type PluginHostProps, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Platform, Pressable, Text, View, type TextStyle } from "react-native";
import { z } from "zod";

export const peerMessageSchema = z.object({ senderId: z.string(), body: z.string() });

export const outgoingSchema = z.object({
  to: z.string(),
  recipientId: z.string().nullable(),
  body: z.string(),
  status: z.enum(["sending", "delivered", "failed"]),
  error: z.string().nullable(),
});

type PeerMessage = z.output<typeof peerMessageSchema>;
type Outgoing = z.output<typeof outgoingSchema>;

const FULL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Long paths and URLs wrap instead of widening the card. Only the web needs
// this; React Native style types do not declare it.
const WRAP_ANYWHERE = (Platform.OS === "web" ? { overflowWrap: "anywhere" } : {}) as TextStyle;

// Long messages fold to this many lines until expanded. React Native Web
// reports no line layout, so length is judged from the text itself.
const FOLDED_LINES = 12;
const isLong = (text: string) => text.split("\n").length > FOLDED_LINES || text.length > 1200;

function useAgentName(agentId: string): string {
  const title = useAgent(agentId, (agent) => agent.title);
  return title ?? `agent ${agentId.slice(0, 8)}`;
}

interface CardProps extends PluginHostProps {
  icon: string;
  heading: string;
  agentId: string | null;
  body: string;
  timestamp: Date;
  footer?: { text: string; tone: "muted" | "danger" };
}

function MessageCard({ icon, heading, agentId, body, timestamp, footer, theme }: CardProps) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const folded = isLong(body);
  const colors = theme.colors;
  const time = timestamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const copy = (text: string, what: string) =>
    copyText(text).then(
      () => toast.show(`${what} copied`, { variant: "success" }),
      () => toast.error(`Cannot copy the ${what.toLowerCase()}`),
    );
  const action = { color: colors.foregroundMuted, fontSize: 12 };
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={icon} size={14} color={colors.foregroundMuted} />
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", flexShrink: 1 }}>
          {heading}
        </Text>
        {agentId ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Copy agent ID ${agentId}`}
            onPress={() => copy(agentId, "Agent ID")}
            hitSlop={8}
          >
            <Text style={{ ...action, fontFamily: "monospace" }}>{agentId.slice(0, 8)}</Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        <Text style={action}>{time}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Copy message" onPress={() => copy(body, "Message")} hitSlop={8}>
          <Icon name="Copy" size={14} color={colors.foregroundMuted} />
        </Pressable>
      </View>
      <Text
        selectable
        numberOfLines={folded && !expanded ? FOLDED_LINES : undefined}
        style={[{ color: colors.foreground, fontSize: 14, lineHeight: 20 }, WRAP_ANYWHERE]}
      >
        {body}
      </Text>
      {folded ? (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded} onPress={() => setExpanded(!expanded)}>
          <Text style={action}>{expanded ? "Show less" : "Show more"}</Text>
        </Pressable>
      ) : null}
      {footer ? (
        <Text style={{ color: footer.tone === "danger" ? colors.statusDanger : colors.foregroundMuted, fontSize: 12 }}>
          {footer.text}
        </Text>
      ) : null}
    </View>
  );
}

export function PeerMessageCard({ item, timestamp, ...host }: PluginTimelineItemProps<PeerMessage>) {
  const { senderId, body } = item.data;
  const name = useAgentName(senderId);
  return <MessageCard {...host} icon="MessageSquare" heading={`From ${name}`} agentId={senderId} body={body} timestamp={timestamp} />;
}

export function OutgoingMessageCard({ item, timestamp, ...host }: PluginTimelineItemProps<Outgoing>) {
  const { to, recipientId, body, status, error } = item.data;
  const id = recipientId ?? (FULL_ID.test(to) ? to : null);
  const title = useAgent(id ?? to, (agent) => agent.title);
  const name = title ?? (id ? `agent ${id.slice(0, 8)}` : to);
  const footer =
    status === "failed"
      ? { text: error ?? "Not delivered.", tone: "danger" as const }
      : status === "sending"
        ? { text: "Sending…", tone: "muted" as const }
        : undefined;
  return (
    <MessageCard {...host} icon="Send" heading={`To ${name}`} agentId={id} body={body} timestamp={timestamp} footer={footer} />
  );
}
