# Agent register template

One file, written before any agent runs, updated as the only record of fleet state. Its purpose is
stated at the top so a session resuming into it knows what it is trusting. How the fleet is run is
`SKILL.md` §3 to §5; this file is only what the register records and what makes a row trustworthy.

**Name it `REGISTER-<session>.md`, in the session's own plan directory beside the plan.** A resume
searches for exactly that shape and takes the newest match ([resume-prompt.md](resume-prompt.md)
step 1), so a register named anything else is one the owner has to hand over a path for, in the
message where they are least able to.

```
# Agent register -- <programme / session name>

Purpose. With a large fleet running, my memory of what each agent is doing is the weakest link.
This file is the source of truth instead, kept in the durable plan directory beside the plan.
Every dispatch is recorded here BEFORE it runs, nothing is carried in my head between turns, and
a quota stop costs exactly what this file does not hold.

The rule that makes it sound: every agent's condensed verdict is copied into this file as it
lands, and its status is closed in the same edit. Its own report file at the scratch path
outlives it; my memory of what it said does not.

Repository state at the start of this fleet: <branch, tip subject, tree clean or not, what is
being written to the repository while the fleet runs>.
Concurrency budget: <cap>, helpers included. Sub-agent cap per agent: zero, always -- a fresh
agent is a second dispatch of mine.
Scratch path: <one directory, outside the repository, a subdirectory per agent, named in every
brief>.
Starter prompt: <path>. Previous handoff: <path, or none>. Owner's standing instructions: <path>.
These three are what a resume re-reads (`resume-prompt.md` steps 2 and 5), and a compacted
transcript may name none of them.

## Resume point -- rewritten in the same edit as whatever it names, never at a wave boundary

Next action, and why it is next:
Reports landed and not yet judged:
Commit about to land (from the commit table):
Last gate run: <scope, real exit code, when>

## File ownership -- the map every dispatch is checked against

| Files owned | Agent | Unit of work |
| ----------- | ----- | ------------ |

Hubs (written by more than one unit, so one owner each, in sequence):
Leaves (single owner, dispatchable at any time):
Couplings that are not file edges, shared contracts included:

## Commits -- the ownership map's other half, drawn with it

| Commit subject | Files | Message drafted by | Lands after | Audit dispatched to | Landed |
| -------------- | ----- | ------------------ | ----------- | ------------------- | ------ |

A leaf's commit lands in the turn its agent's report is judged, a hub's in the turn its owner's
is. "Lands after" holds the ordering constraints (`SKILL.md` §5) -- a citation's target, a
workflow's manifest -- never prose elsewhere. "Audit dispatched to" is filled in the same edit as
"Landed", and a landed row with it empty is committed work nobody is auditing.

## The cycle, per slice -- decided here, before any finding exists

| Slice | Rounds | Lightened? Reason, or "no" |
| ----- | ------ | -------------------------- |

## Live agents

| Agent name | The question it settles | Owns | Cycle | Last write to an owned file | Status |
| ---------- | ----------------------- | ---- | ----- | --------------------------- | ------ |

The agent name is the name it was dispatched under, and it is one value doing three jobs: its
scratch subdirectory is named for it, its brief calls it `<your agent name>`, and it is the address
a resume is sent to. Record it at dispatch; a resume has nothing to aim at otherwise.

Cycle is one of: implement, audit, fix, re-audit, fix, done.

## Plant-and-restore windows currently open

| Agent | Files it may break | Declared at | Restore confirmed |
| ----- | ------------------ | ----------- | ----------------- |

## Standing actions -- queued work and the condition that releases each

| Trigger | The whole brief, written out now | Dispatched? |
| ------- | -------------------------------- | ----------- |

## The ending -- enumerated before the last wave goes out

<Assembly of the last wave; the gate at <scope>; the draft pull request; the `verify` run's
conclusion; the handoff and its independent audit; the starter prompt. Once one wave plus this
list is what remains, dispatch nothing new.>

## Decisions taken by the owner, and where each was routed

| # | Question | Ruling | Routed to |
| - | -------- | ------ | --------- |

## Open, awaiting the owner

## Cross-agent handoffs in flight

<Agent A writes X to the scratch path; agent B owns the file it lands in; I route it. Both briefs
name the path.>

## Findings banked, and handoff material

<Per completed agent: the condensed verdict. What the next session's handoff will need is written
here as it lands, never reconstructed at the end.>
```

## What makes a row trustworthy

- **Keep every row short enough that adding one is cheaper than skipping it.** Under load a
  coordinator dispatched first and recorded later twice, then rewrote the table wholesale hours
  after the fact — the cost of a wide row is paid every time the fleet is busiest.
- **Close a status in the same edit that banks the verdict, never in batches.** Eight rows read
  RUNNING for agents that had finished, and the coordinator spent that stretch tracking eleven live
  agents against a register describing a different fleet. A stale register is worse than none,
  because it is trusted.
- **The live-agent column is the question the agent settles, not its subject.** Two agents were sent
  to prove one negative under two different subject headings; file ownership catches nothing when
  both write different files or none.
- **Fill "last write to an owned file" from the file's timestamp**, never from the agent's status
  label. Two agents stalled silently for over an hour behind a live-looking label, while another
  looked stalled for 45 minutes because only its notes file was being watched.
- **Open a plant-and-restore row before the agent plants and close it when the restore is
  confirmed.** While one is open, red reported by any other agent is attributed there before it is
  believed.
- **Write the standing action's whole brief when you queue it**, not a note to write one, and tick
  it only against evidence that it went out. A queued brief recovered from memory later is a
  different brief; one recorded correctly here was never dispatched, and only the end-of-session
  handoff caught it.
- **Name a cross-agent hand-over's path in both briefs.** One named in one brief is written and
  never collected, or waited for twenty minutes and never written.
