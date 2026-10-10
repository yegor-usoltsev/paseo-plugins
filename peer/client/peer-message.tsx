import { useAgent } from "@getpaseo/plugin/client";
import type {
  PluginHostProps,
  PluginTimelineItemProps,
} from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { TextStyle } from "react-native";
import { z } from "zod";

export const peerMessageSchema = z.object({
  body: z.string(),
  senderId: z.string(),
});

export const outgoingSchema = z.object({
  body: z.string(),
  error: z.string().nullable(),
  recipientId: z.string().nullable(),
  status: z.enum(["sending", "delivered", "failed"]),
  to: z.string(),
});

type PeerMessage = z.output<typeof peerMessageSchema>;
type Outgoing = z.output<typeof outgoingSchema>;

const FULL_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const PROVIDER_NAMES = new Map([
  ["claude", "Claude"],
  ["codex", "Codex"],
  ["opencode", "OpenCode"],
  ["pi", "Pi"],
]);

// React Native Web passes this CSS property through to the DOM; React Native's
// style types do not declare it.
declare module "react-native" {
  interface TextStyle {
    overflowWrap?: "anywhere";
  }
}

// Long paths and URLs wrap instead of widening the card. Only the web needs
// this.
const WRAP_ANYWHERE: TextStyle =
  Platform.OS === "web" ? { overflowWrap: "anywhere" } : {};

// Long messages fold to this many lines until expanded. React Native Web
// reports no line layout, so length is judged from the text itself.
const FOLDED_LINES = 12;
function isLong(text: string) {
  return text.split("\n").length > FOLDED_LINES || text.length > 1200;
}

function useAgentIdentity(agentId: string) {
  const agent = useAgent(agentId, (snapshot) => ({
    provider: snapshot.provider,
    title: snapshot.title,
  }));
  return {
    name: PROVIDER_NAMES.get(agent?.provider ?? "") ?? "Agent",
    title: agent?.title ?? undefined,
  };
}

interface CardProps extends PluginHostProps {
  icon: string;
  heading: string;
  title?: string;
  agentId: string | null;
  body: string;
  timestamp: Date;
  footer?: { text: string; tone: "muted" | "danger" };
}

function MessageCard({
  icon,
  heading,
  title,
  agentId,
  body,
  timestamp,
  footer,
  theme,
}: CardProps) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const folded = isLong(body);
  const { colors } = theme;
  const time = timestamp.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  async function copy(text: string, what: string) {
    try {
      await copyText(text);
    } catch {
      toast.error(`Cannot copy the ${what.toLowerCase()}`);
      return;
    }
    toast.show(`${what} copied`, { variant: "success" });
  }
  const action = { color: colors.foregroundMuted, fontSize: 12 };
  const headingText = (
    <Text
      numberOfLines={1}
      accessibilityHint={title}
      style={{
        color: colors.foreground,
        flexShrink: 1,
        fontSize: 13,
        fontWeight: "600",
      }}
    >
      {heading}
    </Text>
  );
  return (
    <View
      style={{
        borderColor: colors.border,
        borderRadius: 12,
        borderWidth: 1,
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
        <Icon name={icon} size={14} color={colors.foregroundMuted} />
        {Platform.OS === "web" ? (
          // oxlint-disable-next-line github/a11y-no-title-attribute -- The web tooltip shows the full agent title on hover; accessibilityHint carries it for assistive technology.
          <span title={title} style={{ flexShrink: 1, minWidth: 0 }}>
            {headingText}
          </span>
        ) : (
          headingText
        )}
        {agentId === null ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Copy agent ID ${agentId}`}
            onPress={() => {
              void copy(agentId, "Agent ID");
            }}
            hitSlop={8}
          >
            <Text style={{ ...action, fontFamily: "monospace" }}>
              {agentId.slice(0, 8)}
            </Text>
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
        <Text style={action}>{time}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy message"
          onPress={() => {
            void copy(body, "Message");
          }}
          hitSlop={8}
        >
          <Icon name="Copy" size={14} color={colors.foregroundMuted} />
        </Pressable>
      </View>
      <Text
        selectable
        numberOfLines={folded && !expanded ? FOLDED_LINES : undefined}
        style={[
          { color: colors.foreground, fontSize: 14, lineHeight: 20 },
          WRAP_ANYWHERE,
        ]}
      >
        {body}
      </Text>
      {folded ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          aria-expanded={expanded}
          onPress={() => {
            setExpanded(!expanded);
          }}
        >
          <Text style={action}>{expanded ? "Show less" : "Show more"}</Text>
        </Pressable>
      ) : null}
      {footer ? (
        <Text
          style={{
            color:
              footer.tone === "danger"
                ? colors.statusDanger
                : colors.foregroundMuted,
            fontSize: 12,
          }}
        >
          {footer.text}
        </Text>
      ) : null}
    </View>
  );
}

export function PeerMessageCard({
  item,
  timestamp,
  ...host
}: PluginTimelineItemProps<PeerMessage>) {
  const { senderId, body } = item.data;
  const { name, title } = useAgentIdentity(senderId);
  return (
    <MessageCard
      {...host}
      icon="MessageSquare"
      heading={`From ${name}`}
      title={title}
      agentId={senderId}
      body={body}
      timestamp={timestamp}
    />
  );
}

export function OutgoingMessageCard({
  item,
  timestamp,
  ...host
}: PluginTimelineItemProps<Outgoing>) {
  const { to, recipientId, body, status, error } = item.data;
  const id = recipientId ?? (FULL_ID.test(to) ? to : null);
  const { name, title } = useAgentIdentity(id ?? to);
  return (
    <MessageCard
      {...host}
      icon="Send"
      heading={`To ${id === null ? shorten(to) : name}`}
      title={title ?? to}
      agentId={id}
      body={body}
      timestamp={timestamp}
      footer={statusFooter(status, error)}
    />
  );
}

function shorten(text: string) {
  return text.length > 24 ? `${text.slice(0, 23)}…` : text;
}

function statusFooter(
  status: Outgoing["status"],
  error: string | null
): CardProps["footer"] {
  if (status === "failed") {
    return { text: error ?? "Not delivered.", tone: "danger" };
  }
  if (status === "sending") {
    return { text: "Sending…", tone: "muted" };
  }
  return undefined;
}
