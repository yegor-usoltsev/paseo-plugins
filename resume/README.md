# Paseo resume

A [Paseo](https://paseo.sh) plugin that continues a Claude Code or Codex agent by itself after the provider's usage limit resets.

Without it, an agent that hits its session limit at 2 a.m. sits idle until someone types "continue". With it, the agent picks up a couple of minutes after the reset, and the chat shows when that will happen and lets you change it.

- **Knows the reset time.** It reads the reset from the provider-wide usage windows Paseo reports, skipping model and feature quotas and providers with several signed-in accounts, then from Claude's "resets" notice with its timezone or Codex's local "try again at" message. When neither gives one, it estimates 30 minutes and rechecks the usage API every five minutes after Paseo's cache expires. A known reset gets two minutes of margin.
- **Visible and controllable.** While a resume is pending, a "Resumes in 12 min" pill sits above the agent's message box. It opens a popover with the exact time in your time zone, Try now, and Cancel this resume.
- **Stays out of your way.** Messages, including peer messages and heartbeats, keep the pending resume. A busy agent resumes once its turn ends and the resume is due, with a five-minute retry as a fallback. Stop does not trigger an immediate retry; Cancel or archiving cancels it. Short-lived API throttling and replies that merely discuss limits do not schedule one.
- **Survives restarts.** Pending resumes are saved to disk and continue after a daemon restart. Restored timers connect to the local daemon directly and always steer instead of interrupting a concurrent turn. If a resume cannot reach the agent, it retries in five minutes.
- **Tells the parent.** When a resumed agent was started by another agent, the parent hears when the resumed turn finishes, because Paseo's own finish notification can be lost after a limit stop.

```text
Codex:  You've hit your usage limit. … try again at 4:06 PM.
Chat:   ── Usage limit reached · resumes at 4:08 PM ──
Pill:   Resumes in 3 min
4:08:   Your previous turn stopped on the provider usage limit, which has now reset. Continue where you left off.
Chat:   ── Resumed after usage limit at 4:08 PM ──
```

## Install

You need Paseo 0.10.3 or later and npm. GitHub installation prepares the locked runtime dependencies automatically. On the daemon host, run:

```sh
paseo plugin install github:yegor-usoltsev/paseo-plugins:resume
```

Nothing else is needed: the plugin works for every existing and new Claude Code and Codex agent.

## Which stops count

The plugin acts only on a usage limit, recognised per provider:

- **Codex**: a failed turn whose error starts with "You've hit your usage limit".
- **Claude Code**: a turn whose last message is the limit notice alone, such as "You've hit your session limit · resets 3:40pm (UTC)" or "Claude AI usage limit reached".

## Where state lives

Pending resumes are kept in `$XDG_STATE_HOME/paseo-resume/`, by default `~/.local/state/paseo-resume/`, one file per Paseo home. Removing the plugin leaves that file in place.

## Schedules

According to Paseo 0.10.3's scheduler implementation, new-agent schedule runs archive their workspace when the turn ends by default (`archiveOnFinish`), including after a usage limit. Archiving cancels that agent's pending resume. A recurring schedule should read saved progress on its next run; auto-resume does not keep an archived run alive.

## Parent notices

A parent notice arrives as a message starting with `[from:<child-agent-id>]`. With the [peer](../peer/) plugin installed, Paseo shows it as a "From <agent>" card, and the parent can answer the child with `peer.send`.
