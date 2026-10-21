Paseo resume continues a Claude Code or Codex agent by itself after the provider's usage limit resets. An agent that stops on its limit at night picks up a couple of minutes after the reset instead of waiting for someone to type "continue".

The reset time comes from the provider-wide usage windows Paseo reports, then from Claude's "resets" notice with its time zone or Codex's "try again at" message. When neither gives a time, the plugin estimates 30 minutes and rechecks usage every five minutes. A known reset gets two minutes of margin. Only real usage limits count: short-lived API throttling and replies that merely discuss limits do not schedule a resume.

While a resume is pending, a pill above the agent's message box shows the countdown. It opens a popover with the exact time, Try now and Cancel this resume. Ordinary messages keep the pending resume; a busy agent resumes after its turn ends; Cancel this resume or archiving removes it. When another agent started the resumed one, the parent hears when the resumed turn finishes.

Pending resumes are saved in `$XDG_STATE_HOME/paseo-resume/`, by default `~/.local/state/paseo-resume/`, and continue after a daemon restart. Removing the plugin leaves that file in place. The plugin needs Paseo 0.12.0 or later, npm on the daemon host and a TCP daemon listener, and works for existing and new agents.
