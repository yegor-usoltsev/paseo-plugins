Paseo peer lets agents message each other without interrupting each other's work. It adds a `peer.send` tool to every agent Paseo creates, for Claude Code and Codex alike.

Paseo's own agent prompt tool interrupts a running agent and cancels its subagents. A `peer.send` message instead joins the recipient's current turn, or starts a new turn when the recipient is idle. Each message starts with `[from:<sender-agent-id>]`, so the recipient knows whom to answer with the same tool.

`peer.send` takes `to`, which is a full agent ID, a unique ID prefix or an exact title, and `message`, which is delivered verbatim. It returns once Paseo has accepted the message, not when the recipient has read it. Sending to yourself or to an archived agent fails with an explanation.

In the chat, incoming messages render as "From <agent>" cards and the sender's own calls as "To <agent>" cards, with the time, delivery errors, folding for long text and copy actions.

Agents that existed before installation do not get the tool; start new ones. The plugin needs Paseo 0.11.2 or later and npm on the daemon host.
