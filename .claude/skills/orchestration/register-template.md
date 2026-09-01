# Agent register template

One file, written before any agent runs, updated as the only record of fleet state. Its purpose is
stated at the top so a session resuming into it knows what it is trusting.

```
# Agent register -- <programme / session name>

Purpose. With a large fleet running, my memory of what each agent is doing is the weakest link.
This file is the source of truth instead. Every dispatch is recorded here BEFORE it runs, every
report lands at a known path, and nothing is carried in my head between turns.

The rule that makes it sound: an agent's condensed final message is what I read into context; its
FULL report stays on disk and is opened only when a specific fix needs the detail.

Repository state at the start of this fleet: <branch, tip subject, tree clean or not, what is
being written to the repository while the fleet runs>.
Concurrency budget: <cap>, helpers included. Sub-agent cap per agent: <normally zero>.

## File ownership -- the map every dispatch is checked against

| Files owned | Agent | Unit of work |
| ----------- | ----- | ------------ |

Hubs (written by more than one unit, so one owner each, in sequence):
Leaves (single owner, dispatchable at any time):
Couplings that are not file edges:

## Live agents

| # | Slice | Brief | Report path | Sub-agents | Status |
| - | ----- | ----- | ----------- | ---------- | ------ |

## Standing actions -- queued work and the condition that releases each

| Trigger | The whole brief, written out now | Dispatched? |
| ------- | -------------------------------- | ----------- |

## Decisions taken by the owner, and where each was routed

| # | Question | Ruling | Routed to |
| - | -------- | ------ | --------- |

## Open, awaiting the owner

## Cross-agent handoffs in flight

<Agent A writes X to a scratch file; agent B owns the file it lands in; I route it.>

## Findings banked

<Per completed agent: the condensed verdict only, plus the path to the full report.>
```

## How to use it

- **Record the dispatch before it runs.** A dispatch you meant to record and did not is a dispatch
  you will later believe never happened.
- **Write the standing action's whole brief when you queue it**, not a note to write one. A queued
  brief recovered from memory later is a different brief.
- **Tick a standing action only against evidence that it went out.** One recorded correctly here was
  never dispatched, and only the end-of-session handoff caught it.
- **Route a cross-agent handoff yourself.** When agent A's output belongs in a file agent B owns, A
  writes it to a scratch file and you apply it — never A editing B's file, and never A's conclusion
  reaching B as a premise.
- **Reconcile the ownership map against `git diff --name-only` at every wave boundary.** A path in
  the diff that the map does not assign is a conflict incident, and it appears in no prose report.
