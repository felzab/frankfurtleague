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

## The cycle, per slice -- decided here, before any finding exists

| Slice | Rounds | Lightened? Reason, or "no" |
| ----- | ------ | -------------------------- |

## Live agents

| # | Slice | Brief | Report path | Sub-agents | Last write to an owned file | Status |
| - | ----- | ----- | ----------- | ---------- | --------------------------- | ------ |

## Standing actions -- queued work and the condition that releases each

| Trigger | The whole brief, written out now | Dispatched? |
| ------- | -------------------------------- | ----------- |

## The ending -- enumerated before the last wave goes out

<Assembly of the last wave; the gate at <scope>; the draft pull request; the `verify` run's
conclusion; the handoff and its independent audit; the starter prompt. Once one wave plus this list is what remains, dispatch
nothing new.>

## Decisions taken by the owner, and where each was routed

| # | Question | Ruling | Routed to |
| - | -------- | ------ | --------- |

## Open, awaiting the owner

## Cross-agent handoffs in flight

<Agent A writes X to a scratch file; agent B owns the file it lands in; I route it.>

## Findings banked, and handoff material

<Per completed agent: the condensed verdict only, plus the path to the full report. What the
next session's handoff will need is written here as it lands, never reconstructed at the end.>
```

## How to use it

- **Record the dispatch before it runs.** A dispatch you meant to record and did not is a dispatch
  you will later believe never happened.
- **Read the live-agent table before every dispatch**, not only when reconciling — file ownership
  does not catch two agents investigating one question, and it happened twice.
- **Fill "last write to an owned file" from the file's timestamp**, never from the agent's status
  label. Two agents stalled silently for over an hour behind a live-looking label, while another
  looked stalled for 45 minutes because only its notes file was being watched.
- **Write the standing action's whole brief when you queue it**, not a note to write one. A queued
  brief recovered from memory later is a different brief.
- **Tick a standing action only against evidence that it went out.** One recorded correctly here was
  never dispatched, and only the end-of-session handoff caught it.
- **Route a cross-agent handoff yourself.** When agent A's output belongs in a file agent B owns, A
  writes it to a scratch file and you apply it — never A editing B's file, and never A's conclusion
  reaching B as a premise.
- **Reconcile the ownership map against `git diff --name-only` at every wave boundary.** A path in
  the diff that the map does not assign is a conflict incident, and it appears in no prose report.
