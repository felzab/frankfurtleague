# Pacing the quota, and an unattended stretch

## Pacing the quota

The desktop app's `get_usage` tool gives each window's percent used and its reset time. Whether a
session outside the app has such a tool is not established: where none answers, ask the owner for a
reading before the fleet grows, and pace on the rate below alone.

- **The width.** The agents the five-hour line allows are 95 less the reading, over the minutes to
  the reset, over about 0.06 per agent-minute, rounded down; the owner's cap bounds it from above.
- **The rate.** Measured 2026-10-16 from one session's readings: 0.04 to 0.09% of the five-hour
  window per agent-minute. Six resumed agents of large context ran 0.53%/min against 0.29 to 0.38
  for five or six mostly fresh ones, so count a large-context agent as more than one.
- **The weekly line.** No per-agent rate in weekly points has been measured: judge the weekly
  reading by its slope between readings against its own line.
- **What wakes the session.** Short of the owner's message, only a notification re-invokes it: an
  agent's report or a background command's exit. Where the line allows no agent, start one
  background `sleep` that ends at the five-hour reset; with no live agent and no background command,
  nothing wakes the session at all.
- **After a stop.** In the terminal, an interactive session on a claude.ai subscription continues on
  its own once a five-hour limit resets, automatic continue being on by default from v2.1.234. The
  desktop app continues only where someone ticks _Auto-continue when limits reset_ on the
  session-limit card, which appears at the stop, so an unattended desktop night has pacing alone.
  Neither continues after a weekly limit. Read 2026-10-16 at
  https://code.claude.com/docs/en/interactive-mode and
  https://code.claude.com/docs/en/whats-new/2026-w33, which move without us. Either way the stop
  has killed every live agent: [resume.md](resume.md) brings them back.

## An unattended stretch

Prepare before a stretch nobody will answer starts. A subagent's permission prompt surfaces in the
owner's session, not the agent's, so one unanswered prompt parks the whole fleet; the register is
what stays true until the owner is back.

- Bypass permissions mode does not suppress an explicit `ask` rule, the standard's
  `Edit(**/docs/_standard/**)` in `.claude/settings.json` among them, so bypass is no preparation.
- Turn the ask into a deny: add `Edit(**/docs/_standard/**)` to `permissions.deny` in the gitignored
  `.claude/settings.local.json`, which a running session reloads, and confirm one refusal before
  leaving. Deny is evaluated before ask: an agent reaching the standard is refused and works on, and
  the change still waits for the owner.
- Add rules only. Removing or loosening a permission rule or a hook registration is the owner's to
  give, never yours to take, and the denies stay in force through the night.
- The prompt surface is not enumerable from the rules: the harness's permission classifier raises
  prompts no rule names, so one command running unprompted establishes that command alone.
- Undo by mechanism: a byte-exact backup, outside the tree, of a `settings.local.json` that existed
  before, and the restore command — the backup put back, or the file deleted where the deny created
  it — written into the register's unattended section and its resume point.
- Execute a pre-authorisation against its intent: where applying it literally would defeat its
  purpose, leave it unexecuted. Surface two instructions in tension as a tension.
- Record every call taken alone as it is taken, with its reasoning and what reversing it would cost.
- Deciding in the owner's place is a grant for a named stretch only, covering routine judgement on
  best-practice terms.
- A question that arises goes through no ask tool, which nobody would answer before the owner is
  back: queue it under the register's "Open, awaiting the owner" with its options, your
  recommendation first. Where it blocks work, build the recommended option provisionally and mark
  it so there; every provisional choice goes to the owner as one batch on their return. A rule
  change, and any string a visitor navigates by, waits for the owner.
