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
Reports: <the directory `ledger.py bank --from` saves each report into, spelled the same way, alone after the colon>
Starter prompt: <path>. Previous handoff: <path, or none>.
Coordinator session id: <the id SKILL.md renders, alone after the colon>

## Unattended changes
<What was changed, where its byte-exact backup sits outside the tree, and the command that
restores it. Empty while the session runs attended; emptied as each is restored.>

## Resume point -- rewritten whenever what it names changes
<Each field rewritten by `reg.py resume <register> --file <path>`, whose file holds a line per field
it changes, opening with the field's label as it stands below; a field the file does not name
stays as it is.>
Next action, and why it is next:
Reports landed and not yet judged:
Branch about to land:
Estimate to the ending, each figure measured or estimated:
Last gate run: <the full `./scripts/gate/verify.sh`: its exit code, its closing line, when>
Unattended changes still open, and the command that restores each:
<UPDATE lines, each written by `reg.py append` or `reg.py resume`; the marker line is copied as it
stands>
<!-- reg.py appends UPDATE lines above this line -->

## Expected red -- every check known to fail at the pushed head, and the landing that clears it
| Matches | Lines | Why it is red | Cleared by (the pending landing) | Since (push) | Status |
| ------- | ----- | ------------- | -------------------------------- | ------------ | ------ |
<Matches: a literal every CI log line of this red holds, which `ci.py` matches; Lines: how many
distinct lines it matches, past which `ci.py` reads the surplus as new. A row is written by
`ci.py expect <register> <run> --cleared-by <landing>` from the run of the push that caused it, its
Status RED; `ci.py` turns it CLEARED <push> when a concluded run shows its job passing, never by
deletion. The `invariant-number` finding on a reserved invariant id
that landed above a lower one not yet landed, or above one left unused, is one row, cleared when the
lower id lands or the ending closes the gap.>

## File ownership
| Files owned | Agent | Slice | Invariant ids reserved | Worktree branch, and the sha it forked at |
| ----------- | ----- | ----- | ---------------------- | ----------------------------------------- |
<Invariant ids reserved: the block of real ids the agent's brief hands it, never a placeholder.
Each block starts one past the highest id reserved so far, never the highest landed, which would
hand out again an id an unlanded branch holds. An id left unused is a gap the ending closes.>
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
the name or the id in the first cell. Status: RUNNING, written by `reg.py dispatch` and again by
its `--id` on a resume; `DONE <stamp> <report file>`, written by `ledger.py bank --from`.
`reg.py live` lists the RUNNING rows.>

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
<The last wave landed, its audit and its fix; every slice ticked to a landed commit; every gap an
unused reserved invariant id left closed and every expected-red row closed;
`ledger.py open --unclosed` exiting 0; the full gate; the draft pull request's body; every check's conclusion; the owner's
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
ROUTED, one owner at a time, by `bank --route`, by a brief's `Rows:` line at
`reg.py dispatch --brief`, by a sent message's `Rows:` line or by `ledger.py route`; its owner is a
live agent or one of the queues `ledger.py route` names when it refuses another, and
`reg.py dispatch --takes <queue>` hands a queue's rows to a new agent. It moves to FIXED by the
landing of its owner's branch whose `Rows fixed:` line names it, and otherwise to a closed status
by `bank --close` or `ledger.py close`, never by hand. The landing prints one
`ledger.py close … FIXED <merge> <row>` line per row it leaves that its commits name or its agent
still holds: run the line of each row the merge fixed and no other, since a row can stay routed
for a later round, and no landing closes an OPEN row itself.
Status: one of
`.claude/skills/orchestration/tools/ledger.py :: STATUSES`, a closed one followed by its evidence; a
word outside it stops every ledger command, a landing included.
A routed finding is a claim until its fixer has judged it real. The ending closes every row.>

## Findings banked, and handoff material
<Per agent: its report's saved path and a one-line verdict. What the handoff will need, written as
it lands. Before banking a novelty as a preference, run the command that would fail if it were
not one.>
```

## Keeping it true

- Keep every row short enough that adding one is cheaper than skipping it.
- Write the register once per message: two edits in one tool batch each read, append and write the
  file, and the later drops the earlier.
- Record in the live-agent table the question an agent settles, and diff dispatches by path, never by
  task.
- Fill "last write to an owned file" from timestamps inside the agent's worktree, across every file
  it owns.
- An agent owns every path in its brief until its report lands.
- Open a worktree row at dispatch and close it when the worktree and its branch are gone.
- Write a standing action's whole brief when you queue it, with
  `reg.py queue <register> <trigger> <brief>`; `reg.py dispatch` ticks the row naming the brief it
  dispatches, and any other row is ticked only on evidence it went out. The trigger `window` is the
  next concluded CI run, and
  `land.py` refuses to land past a concluded run while such a row is unticked. A live agent waiting
  on a landing is a standing action too, its trigger naming that branch or its agent, which
  `land.py` then names when it lands.
