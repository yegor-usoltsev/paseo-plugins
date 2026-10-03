# Paseo peer

A [Paseo](https://paseo.sh) plugin that lets agents message each other without interrupting each other's work.

Paseo's own `send_agent_prompt` tool and `paseo send` command interrupt a running agent and cancel its subagents ([getpaseo/paseo#5163](https://github.com/getpaseo/paseo/issues/5163)). This plugin adds a `peer.send` tool whose message joins the recipient's current turn instead, so a Claude Code agent and a Codex agent can review and steer each other while both keep working.

- **Never interrupts.** A running recipient gets the message inside its current turn; an idle one starts a new turn with it.
- **Reply address included.** The message starts with `[from:<sender-agent-id>]`, so the recipient knows whom to answer.
- **Readable in the chat.** Incoming messages render as "From <agent>" cards and the sender's own calls as "To <agent>" cards, with the time, delivery errors, folding for long text, and copy actions.
- **Claude Code and Codex.** The tool works the same for both providers.

```text
Agent A calls:  peer.send(to: "3f2a91c4", message: "Review abc123 when you reach a stopping point.")
Tool returns:   Delivered to reviewer (3f2a91c4-…).
Agent B sees:   From builder  7d10e2b8
                Review abc123 when you reach a stopping point.
```

## Install

You need Paseo 0.10.3 or later. On the daemon host, run:

```sh
paseo plugin install github:yegor-usoltsev/paseo-plugins:peer
```

Agents created after installation have the tool; agents that already existed do not, so start new ones.

## Use

Ask an agent to talk to another one, or describe the workflow in your agents' instructions:

```text
When you finish a part, send its commit to the reviewer with peer.send and keep working.
```

`peer.send` takes two arguments:

- **`to`**: the recipient's full agent ID, a unique ID prefix, or its exact title.
- **`message`**: the text to deliver.

It returns once Paseo has accepted the message, not when the recipient has read it. Sending to yourself or to an archived agent fails with an explanation.

## How it works

The plugin adds a `peer` MCP server to every agent Paseo creates. That server is a short Node script with no files of its own. It works out which agent is calling: Claude Code passes `PASEO_AGENT_ID` to MCP servers, and for Codex the script reads it from the parent `codex app-server` process. It then forwards the call over a Unix socket to the plugin's process in the Paseo daemon, which sends the message with the Paseo SDK in steer mode.

Right after the plugin is reloaded, delivery waits for the first agent event on the daemon, because the plugin receives its SDK handle from those events. A send made in that moment fails with "paseo-peer is still starting; retry in a moment."
