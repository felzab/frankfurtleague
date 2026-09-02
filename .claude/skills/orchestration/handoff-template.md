# Handoff template

A handoff answers what a transcript cannot: **what the previous session believed, and how much of it
was verified.** Write it incrementally as the session runs, have it audited by an agent that has
seen none of the work, and fix what that audit finds before the session ends.

## Required sections

```
# Handoff -- <session name> to <next session name>

## Read these, in this order
<Each file, and the one question it answers. Point at files; do not restate them.>

## What this session settled, so you do not re-open it
<Decisions with the argument's location, not the argument. Every owner ruling taken this session,
dated, in the owner's words -- and copied into the owner's standing-instructions file in the
same edit, so the two never diverge.>

## The single most important thing in this handoff
<One item. If everything is important, nothing is.>

## What actually bit, this session
<Incidents, not advice. Each one: the mechanism, what it cost, and the rule it leaves behind.
An entry with no incident behind it belongs in a standing rules file, not here.>

## What NOT to redo
<Every rejected option with the reason it was rejected and, where one exists, the condition that
would re-open it. Each entry cost someone a measurement.>

## Open, and owed to the owner
<Every unanswered question, each with what is blocked behind it. The first item is whatever must
be raised before the next session starts work. Nothing the owner has already ruled.>

## Writing your own handoff
<The standard, restated only where this session learned something about it.>

## VERIFIED STATE
<Established by running a command, with the exit status taken from the command itself and never
through a pipe, between <time> and <time> on <date>. Where a fact would have needed a command
this session could not run, say so instead of guessing.>

- Branch, and the commit SUBJECTS -- never SHAs, which a rebase invalidates silently.
- Gate state: the scope run, the real exit code, the findings.
- Counts, each with the moment it was taken and a note that it will move.
- What could NOT be established here, and why.
```

## What earns its place

- **Verified state with real exit codes**, taken from the command and never through a pipe. Never
  the word "passing".
- **Per-item traps** — what will bite the next session specifically, not what bites everyone.
- **The conventions that actually bit**, each with the incident that taught it.
- **What you measured, and what you could not measure and why.** The most useful reports in this
  programme said "not measurable here" rather than quoting a number nobody could trust.
- **Point at files; do not restate them.** A handoff that restated the rules file, the plan and this
  skill for a third of its length buried the four incidents only it knew.

## What to leave out

- **A stamped total.** Name the things instead. Counts in prose go stale while they are being read:
  one paragraph named twelve modules where there were fourteen, and a collected test count moved
  through four values during a single audit.
- **A commit SHA on a live branch.** Cite subjects and let the next session re-derive.
- **A figure quoted as a baseline** that nobody re-measured in the state the next session inherits,
  and any figure taken while the fleet was running: it measured a contended machine, and three
  agents timing one quantity got three answers.
- **A filename a pending fix round will rename.** Hand over only what has reached the end of its
  cycle; a handoff written mid-cycle sent the next session to a file about to be split.
- **A question the owner has ruled.** One handoff re-asked the ruling that changed the per-slice
  discipline, against its own "do not re-ask" line, because the ruling was in one copy of the
  owner's file and not the other.

## Planning a programme

- **Plan in a separate session.** It produces the programme plan and the starter prompt for session
  one; the plan lays out the whole path — each session's scope, dependencies and exit condition — so
  no later session re-derives the shape under pressure.
- **One pull request per session.** Size a session to be worth its own branch and not exhaust its
  context. A phase whose verification verdict must stand alone gets its own session.

## The starter prompt

The planning session produces two artefacts: the programme plan, and the **starter prompt** for
session one. Every later session's starter prompt is its predecessor's handoff plus the lines below,
which is what makes the chain self-sustaining. The owner sends `/orchestration` as its own message
before pasting the starter ([USAGE.md](USAGE.md)); the first line is the fallback for the day that
is forgotten.

```
- Invoke the `orchestration` skill first if it is not already in context.
- Read <owner's standing-instructions path>, then <handoff path>, in that order, before doing
  anything else. Where the two disagree, the owner's file wins.
- Your scope is <session scope>. Its exit condition is <exit condition>. One pull request.
- Raise every open question the moment it arises, in one batch where you can, never in a wrap-up.
- You end by writing the handoff for the next session and having an agent that has not seen your
  work audit it, then fixing what it finds.
```

Both live in the durable plan directory beside the plan, with every document they cite in the same
directory and one copy of each governing file — a second copy diverges. Never a session scratchpad,
which dies with its session, and never an artifact, which the next session does not read.
