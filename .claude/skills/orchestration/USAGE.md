# Using the orchestration skill

Addressed to the owner: every step below is yours to perform. The coordinator never reads this page.

## How it loads

- Only the skill's description is in context until it is invoked, so type `/orchestration` rather
  than rely on Claude judging it relevant. Text after it on the same line arrives as
  `ARGUMENTS: <text>` at the end of the skill.
- An agent definition's `initialPrompt`, with the session launched by `--agent`, is documented to
  submit a first turn whose skills are processed, which could invoke the skill at launch. It is
  untried here, and unknown in the desktop app.
- The skill stays in the conversation once invoked; an edit to it mid-session needs a fresh
  `/orchestration`. A compaction after that re-attached the session's first, older copy rather
  than the latest the documentation names, so the compaction hook tells the coordinator that the
  file on disk is the current core.
- Compaction re-attaches the first 5,000 tokens of each invoked skill, within 25,000 shared by all of
  them and filled from the most recent: the skill's core is held under that size by
  `.claude/skills/orchestration/tests/test_orchestration_skill.py`, so it comes back whole, and its
  other files are read when the core points at them. A session that invoked many other skills since can lose it entirely;
  invoke it again then.
- Compact at a wave boundary rather than when the window is full, with a focus instruction, for
  example `/compact keep the register path, the branch and the live agent ids`.
- A subagent does not inherit the skill: its agent definition and its brief carry what it needs.

## Starting a programme session

1. Open a new session in the repository, on `main`, named after the session in the plan.
2. Message 1: `/orchestration`, and nothing else. Wait for the turn to end.
3. Message 2: the session's `START-*.md`, verbatim. A starter opening with a slash command would be
   read as that command's argument, so it goes as its own message.

## Resuming after a pause, a kill or a quota stop

1. Resume the same session — the sidebar in the desktop app, or `claude --continue` /
   `claude --resume <name>`. Pass any launch flags again; a resume restores none of them. Offered a
   summary or the full session, take the full session.
2. One message: `/orchestration resume`. The coordinator runs the resume protocol, which finds the
   register on its own.
3. Send no work instruction until the reply names the single next action.

A resumed agent's entry in the app can keep showing its transcript up to the pause while it works,
so a live lane looks hung there; its commits on its own branch, which the coordinator reads for you
on asking, are where its work shows.

The fallback: `/orchestration` as one message, then the block in `resume.md` verbatim as the next.
Neither carries a register path.

## The planning session

1. A new session; message 1: `/orchestration`.
2. Message 2: the programme brief — the goal, the constraints, the durable plan directory, and the
   deliverables: the programme plan, session one's `START-*.md`, and an independent audit of both
   followed by its fix round.

## Steering a running session

Six commands steer a session that has run `/orchestration`; in any other, the session says so and
stops. Only you can run them: Claude cannot invoke them on its own. Send each as a message of its
own. One sent while Claude is working waits for that turn to end. A mode a command sets is written
to the register, so a compaction or a resume keeps it. A session started before a command file was
added or changed finds it after `/reload-skills`, which re-scans the command directories.

| Command         | Use it when                                                        | Example               |
| --------------- | ------------------------------------------------------------------ | --------------------- |
| `/estimate`     | you want to know when the session ends, and what would bring it in | `/estimate`           |
| `/fleet`        | you want a quick look at where things stand                        | `/fleet`              |
| `/pace [n]`     | you need usage left at the five-hour reset                         | `/pace` or `/pace 80` |
| `/fullspeed`    | you want to end a `/pace`                                          | `/fullspeed`          |
| `/away [until]` | you are about to leave the session unattended                      | `/away 07:00`         |
| `/back`         | you have returned after `/away`                                    | `/back`               |

- **`/estimate`** replaces asking for a detailed estimate and its read-back. You get one chat
  message: an estimate section by section and lane by lane, every figure marked measured or
  estimated, the critical path and what dominates it, your own pending items as lanes, then a
  read-back for speed, quality and parallelism. Claude acts on the read-back in the same turn and
  records both in the register. Words after the command narrow it, for example
  `/estimate the lens round only`.
- **`/fleet`** gives a short status: what is running, what landed since the last status, the next
  step on the critical path and what it waits on, CI, both usage readings, and what waits on you. It
  changes nothing.
- **Full speed is the default** in every session, attended or not: every agent the work can use is
  dispatched, and a usage-limit stop is made cheap instead of avoided. It changes only how many
  agents run: no brief, check, audit or review round is shortened, and no agent is told to hurry.
  Agents commit each finished item, and the resume point is kept current. After a stop, the
  terminal continues on its own once the limit resets. The desktop app continues only if you tick
  _Auto-continue when limits reset_ on the session-limit card, which appears at the stop. A weekly
  limit never continues on its own, so Claude tells you before one nears.
- **`/pace [n]`** keeps the five-hour window under a line that reaches n percent at its reset, 95
  when you give no number, by sizing the fleet to it and pausing agents gracefully above it. It holds
  until `/fullspeed`.
- **`/away [until]`** prepares the session before you leave. Claude adds the permission overlay that
  keeps an agent's prompt from parking the fleet, and replies once, asking nothing. The reply says
  when a usage stop is due, whether it will continue on its own, and what will wait for you. While
  you are away, questions are queued with a recommendation instead of asked. Where one blocks work,
  the recommended option is built provisionally.
- **`/back`** undoes the preparation and reports what changed while you were away, every
  provisional build and what reversing it would cost, and the `/fleet` status. Then it asks the
  queued questions, in batches.
