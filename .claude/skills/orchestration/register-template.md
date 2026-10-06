# Register template

The register is the fleet's only record, kept outside the repository, so nothing but its writer
holds it. Name it `REGISTER-<session>.md` in the session's own plan directory: a resume and the
compaction hook search for exactly that shape.

## Contents

- [The skeleton](#the-skeleton)
- [Keeping it true](#keeping-it-true)

## The skeleton

```
# Agent register -- <programme / session name>

Repository state at the start: <branch, tip subject, clean or not>.
Concurrency budget: <cap>, helpers included -- what the owner last said this session, else the
programme register's latest row, else 12, under a ceiling of 20; beneath it, the lower ceiling
quality bears, learned by watching quality.
Model: <what the owner last named for subagents>.
Scratch path: <one directory outside the repository, a subdirectory per agent>.
Briefs: <the directory holding each `<NAME>.md` brief and its `<NAME>-messages.md`, spelled as python opens it, alone after the colon>
Starter prompt: <path>. Previous handoff: <path, or none>.
Coordinator session id: <the id SKILL.md renders, alone after the colon>

## Unattended changes
<What was changed, where its byte-exact backup sits outside the tree, and the command that
restores it. Empty while the session runs attended; emptied as each is restored.>

## Resume point -- rewritten in the same edit as whatever it names
Next action, and why it is next:
Reports landed and not yet judged:
Branch about to land:
Last gate run: <the full `./scripts/gate/verify.sh`: its exit code, its closing line, when>
Unattended changes still open, and the command that restores each:
<UPDATE lines, each written by `reg.py append`; the marker line is copied as it stands>
<!-- reg.py appends UPDATE lines above this line -->

## Expected red -- every check known to fail at the pushed head, and the landing that clears it
| Matches | Why it is red | Cleared by (the pending landing) | Since (push) | Status |
| ------- | ------------- | -------------------------------- | ------------ | ------ |
<Matches: a literal every CI log line of this red holds, which `ci.py` matches. A row is written
when the landing causing it is pushed, its Status RED; it turns CLEARED <push> when a concluded run
shows its job passing, never by deletion. Checks failing on `I_NEW_*` invariant rows are one row,
cleared when the ending renumbers them.>

## File ownership
| Files owned | Agent | Slice | Worktree branch, and the sha it forked at |
| ----------- | ----- | ----- | ----------------------------------------- |
Hubs (written by more than one slice), each with its owner or its named regions:
Leaves:
Couplings that are not file edges, shared contracts included:
Tracked generated files: <each agent whose change moves one commits it regenerated>

## Landings -- the ownership map's other half
| Branch | Files | Lands after | Audit dispatched to | Landed (merge) |
| ------ | ----- | ----------- | ------------------- | -------------- |
<"Lands after" holds the ordering constraints. "Audit dispatched to" is filled in the edit that
fills "Landed".>

## The cycle, per slice -- decided before any finding exists
| Slice | Rounds | Silent if wrong? Reason | Browser pass |
| ----- | ------ | ----------------------- | ------------ |

## Tree health -- re-established at every wave boundary
<The shared tooling imports; `git status --porcelain` in my checkout is empty; `git worktree list`
matches the worktree table.>

## Live agents
| Agent name, then the id the Agent tool returned in backticks | The question it settles | Owns | Cycle | Last write to an owned file | Status |
| ------------------------------------------------------------ | ----------------------- | ---- | ----- | --------------------------- | ------ |
<Cycle: implement, audit, fix, re-audit, fix, done. The messages hook finds a send's recipient by
the name or the id in the first cell.>

## Worktrees -- one per writing agent, from dispatch until its branch is deleted
| Agent | Worktree path | Branch | Forked at | Merged | Removed | Branch deleted |
| ----- | ------------- | ------ | --------- | ------ | ------- | -------------- |

## Standing actions
| Trigger | The whole brief, written out now | Dispatched? |
| ------- | -------------------------------- | ----------- |

## The schedule -- rewritten at every wave boundary, then read back
| Wave | Wall clock | Measured or estimated | Waiting on |
| ---- | ---------- | --------------------- | ---------- |
<My own serial work -- landing, judging, routing -- is a row, estimated. A figure the owner will
act on is taken in one announced exclusive window, the fleet stopped, other load recorded.>

## The ending -- enumerated before the last wave goes out
<The last wave landed, its audit and its fix; every slice ticked to a landed commit; every
`I_NEW_*` invariant row renumbered and every expected-red row closed; `ledger.py open` printing
nothing; the full gate; the draft pull request's body; every check's conclusion; the owner's
deploy steps; the handoff and its independent audit; the starter.>

## Decisions taken by the owner
| # | Question | Ruling, dated, in the owner's words | Routed to |
| - | -------- | ----------------------------------- | --------- |
<"Routed to" names a live agent or my own next action, never an artefact. This table is every
ruling's single home: cite a row by its number, never copy it, and put no number into a tracked
file. A row closes when the tree matches the ruling's words at `HEAD`. A ruling binding the
repository beyond this programme is recorded in the tree as the constraint itself; one binding how
the owner works everywhere goes to their `~/.claude/CLAUDE.md`.>

## Open, awaiting the owner
<Each question, sent through the ask tool the moment it exists, the recommended option first.>

## Cross-agent handoffs in flight
<Writer, owner of the destination file, and the scratch path, named in both briefs.>

## Findings ledger
| # | Source report | Finding (file :: anchor) | Status | Owner, or the evidence that closed it |
|---|---|---|---|---|
<The fleet's only ledger: no other file holds findings. One row per labelled finding of every
report, a fixer's included, written by `ledger.py bank` before the next dispatch. A row moves to
ROUTED by a sent message's `Rows:` line or `ledger.py route`, one owner at a time, and to FIXED by
the landing whose commit body names it. Status: OPEN, ROUTED, FIXED (commit), RULED, HANDOFF, NOT A
DEFECT, MOOT. A routed finding is a claim until its fixer has judged it real. The ending closes
every row.>

## Findings banked, and handoff material
<Per agent: its report's saved path and a one-line verdict. What the handoff will need, written as
it lands. Before banking a novelty as a preference, run the command that would fail if it were
not one.>
```

## Keeping it true

- Keep every row short enough that adding one is cheaper than skipping it.
- Write the register once per message: two edits in one tool batch each read, append and write the
  file, and the later drops the earlier.
- Close a status in the edit that banks the verdict.
- Record in the live-agent table the question an agent settles, and diff dispatches by path, never by
  task.
- Fill "last write to an owned file" from timestamps inside the agent's worktree, across every file
  it owns.
- An agent owns every path in its brief until its report lands.
- Open a worktree row at dispatch and close it when the worktree and its branch are gone.
- Write a standing action's whole brief when you queue it, and tick it only on evidence it went out.
