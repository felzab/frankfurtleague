# The owner's commands, and the session's mode

Each project command under `.claude/commands/` runs one section below, and the owner's own words to
the same effect run it too. Every one belongs to a session that invoked `/orchestration`: in any
other, say so and stop, since its state lives in the register.

A command that sets a mode rewrites the register's `Mode:` field with
`reg.py resume <register> --file <path>` in the turn it arrives, so a compaction or a resume keeps
it. The field holds the speed, `full speed` or `paced to <n>%`, and the attendance, `attended` or
`away until <time>`, as in `Mode: paced to 95%; away until 07:00`. A register written before the
field existed gains the line `Mode: full speed; attended` under its resume point once, by hand,
before the first command writes it: `reg.py resume` refuses a field the block does not hold.

## Contents

- [Full speed, the default: /fullspeed](#full-speed-the-default-fullspeed)
- [A usage-limit stop](#a-usage-limit-stop)
- [/pace](#pace)
- [/away](#away)
- [/back](#back)
- [/estimate](#estimate)
- [/fleet](#fleet)

## Full speed, the default: /fullspeed

`/fullspeed` writes `full speed` into `Mode:`, ending any `/pace`. A session starts at full speed
and returns to it on no word but the owner's.

Full speed is a dispatch rule and nothing more: the quota is never a reason to hold work back, and
every ready agent goes out. It never shortens a brief, a check, an audit or a cycle, never tells an
agent to be quick, sets no time limit, and leaves the skill's quality bar as it stands. Being the
coordinator's rule alone, it is named in no brief.

- **Dispatch every agent the critical path can use**, up to the owner's cap, attended or not.
- **Make a stop cheap instead.** Each writer commits every item as soon as its acceptance evidence
  holds (`.claude/agents/implementer.md` section 5), so a stop loses only the item in hand; the
  resume point is current (SKILL.md); and the usage is read at each notification, for the warnings
  below alone. The desktop app's `get_usage` gives each window's percent used and its reset; where
  no such tool answers, as in a terminal session, say so once and judge by notifications alone.
- **The five-hour window.** Where the slope between your last two readings, carried forward,
  reaches 100% before the reset, bring the resume point current, naming every live agent, and,
  attended, tell the owner in one line when the stop is due and, in the desktop app, that ticking
  the limit card's _Auto-continue when limits reset_ box continues the session (below).
- **The weekly window.** Where its slope reaches 100% before its own reset, tell the owner at once
  and in the turn's first line, attended or not: a weekly stop never continues on its own, and only
  the owner can lift it.
- **What wakes the session.** Short of the owner's message, only a notification re-invokes it: an
  agent's report or a background command's exit. Never end a turn with ready work and nothing live
  or running in the background.

## A usage-limit stop

- **Every live agent's call fails at the stop.** Each stays resumable by its id once the limit
  resets, its context intact.
- **The terminal continues on its own.** Its documentation reads: "Automatic continue is on by
  default in interactive sessions signed in with a claude.ai subscription. Requires Claude Code
  v2.1.234 or later." It starts no wait for "A reset more than 24 hours away: a weekly limit can
  reset days out", re-arms "at most twice in a row", and after a sleep of more than about 30 minutes
  across the reset waits for Enter.
- **The desktop app continues only where the box is ticked.** "When you hit your session limit in
  the Code tab of Claude Code Desktop, the limit card now offers an **Auto-continue when limits
  reset** checkbox. Check it, and the Desktop app retries the interrupted turn after the reset. … The
  weekly-limit card doesn't offer it." The card appears at the stop, so an unattended desktop stop
  continues only if the owner ticked it there; whether a tick carries to a later stop is not
  established. The box and the terminal's setting are separate.
- These passages mirror https://code.claude.com/docs/en/interactive-mode,
  https://code.claude.com/docs/en/errors and https://code.claude.com/docs/en/whats-new/2026-w33, read
  2026-10-16; they move without us.
- **The continuation is a resume.** Run [resume.md](resume.md) to its end, whose step 3 brings the
  agents back.

## /pace

`/pace [n]` writes `paced to <n>%` into `Mode:`, n being the five-hour reading to reach at its reset,
95 where none is given, until `/fullspeed`.

- **The width.** The points a minute the window allows are n less the reading, over the minutes to
  its reset; the live agents, each counted at its rate, stay within them. An agent expected to run
  past the reset counts against the lower of that and n over 300 minutes, what a fresh window
  sustains (about 0.32 a minute at 95): near a reset the first grows without bound, and an agent
  dispatched then spends the next window's points.
- **The rate.** Between two readings, the slope over the agent-minutes between them. Before a
  second, about 0.06 points per agent-minute, and about 0.09 for an agent whose `reg.py context`
  reads past about 300k tokens: one session's readings on 2026-10-16 ran 0.04 to 0.09, and six
  resumed agents of large context 0.53 a minute against 0.29 to 0.38 for five or six mostly fresh
  ones.
- **Readings.** Before each dispatch, at each notification, and, while agents are live, from one
  background `sleep` of about twenty minutes restarted as it ends: a long agent sends no
  notification, and the harness notifies no usage change.
- **Above the width, pause gracefully.** Pause the agents beyond it, furthest from the critical path
  first: message each to commit its work in progress on its branch, restore any plant, write its
  state to its scratch folder and end its turn. A hard `TaskStop` leaves an agent mid-plant or
  mid-edit, and the harness removes a worktree holding no commit. Once each has ended its turn,
  `reg.py pause <register> <NAME>…` sets its live row PAUSED, which `reg.py live` lists apart from
  the RUNNING count; a message resumes it as the width allows, and the messages hook sets its row
  RUNNING again.
- **Where the width allows no agent**, start one background `sleep` ending at the five-hour reset.
- **The weekly window** is warned of as at full speed: no per-agent rate in weekly points has been
  measured.

## /away

`/away [until]` writes `away until <until>` into `Mode:`, or `away` where no time is given, until
`/back` or the owner's word that they are back. In the turn it arrives:

1. Read `date`, write `Mode:`, and append an UPDATE line naming `HEAD`, from which `/back` reports.
2. Prepare the stretch as [unattended.md](unattended.md) says; its rules hold until `/back`.
3. Reply once, asking nothing: what runs while the owner is away; when the five-hour slope reaches
   its limit and whether that stop continues on its own (the terminal does, the desktop app only
   where the owner ticks the card's box); whether the weekly slope reaches its limit inside the
   stretch, which nothing continues past; and what will wait for the owner. An open question goes to
   the queue, never the ask tool, which nobody would answer before the owner is back.

## /back

`/back` writes `attended` into `Mode:`. One reply, in this order:

1. Every unattended change the register lists restored by its restore command, and each confirmed.
2. What changed since `/away`'s UPDATE line: the landings
   (`git log --first-parent --format='%h %s' <that sha>..HEAD`), each push and its CI verdict, the
   reports banked, and any usage-limit stop with how the session continued.
3. Every provisional build: what it decided, where it is, and what reversing it costs.
4. The `/fleet` status.
5. Last, the queued questions through the ask tool, in batches, each with its recommendation first
   and the provisional build it confirms or reverses named. Each answer becomes a ruling row, and
   the build is kept or reversed to match it.

## /estimate

A chat message, never an artifact, every time in this shape:

1. **The estimate**, section by section and then lane by lane, of everything still planned: each
   wave, the ending's steps and the handoff; each live or queued agent with its start and expected
   end; the owner's own pending items as lanes of their own. Every figure is marked measured or
   estimated, and every clock time is an offset from a `date` read in this turn. Name the critical
   path, what dominates it, and any usage-limit stop the readings project, as wall time.
2. **The read-back**: the estimate read again for what to change, in performance, quality,
   parallelism and the owner's own items. A wave costs its longest agent, so an optimisation leaving
   the dominating block untouched buys nothing: shorten that agent, or start it earlier.
3. **Action in the same turn.** Dispatch whatever can run in parallel without hurting quality; weigh
   anything else worth doing, needed or only a quality gain, and do it or decline it with its
   reason.
4. **The record.** The resume point's estimate field rewritten by `reg.py resume --file`, and one
   UPDATE line by `reg.py append` naming the read-back's actions.

Words given with the command narrow the estimate or name what to weigh. A measured figure the owner
will act on is taken in one announced quiet window, the fleet stopped, other load recorded.

## /fleet

A short status in chat, read from commands rather than recalled, in this order:

- **Running:** `reg.py live <register>`, each agent with the question it settles.
- **Landed** since the last status:
  `git log --first-parent --format='%h %s' <sha>..HEAD`, the sha from the register's last `STATUS`
  UPDATE line, or before the first one the session branch's fork from `main`.
- **Next** on the critical path, and what it waits on.
- **CI:** the last push's verdict from `ci.py <register> --head`, which refuses a run not yet
  concluded, so say it is running.
- **Usage:** both windows' readings and resets, and any stop a slope projects.
- **The owner:** what waits on them, from the register's "Open, awaiting the owner" and any browser
  pass due.

Then append one UPDATE line, `STATUS at <HEAD sha>`, and close with the gauge. The status itself
dispatches, lands and asks nothing.
