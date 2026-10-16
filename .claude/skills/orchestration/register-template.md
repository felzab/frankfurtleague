# Register template

The register is the fleet's only record, kept outside the repository, so nothing but its writer
holds it. Name it `REGISTER-<session>.md` in the session's own plan directory: a resume and the
compaction hook search for exactly that shape. It holds what no command can answer: what git, the
briefs and the tools derive is read from them, never copied here, since a copy no tool writes goes
stale.

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
Reports: <the directory every `<report>` path given to `ledger.py bank` lies in, which `ledger.py show` reads, spelled the same way, alone after the colon>
Starter prompt: <path>. Previous handoff: <path, or none>.
Coordinator session id: <the id SKILL.md renders, alone after the colon>

## Unattended changes
<What was changed, where its byte-exact backup sits outside the tree, and the command that
restores it. Empty while the session runs attended; emptied as each is restored.>

## Resume point -- rewritten whenever what it names changes
<Each field rewritten by `reg.py resume <register> --file <path>`, whose file holds a line per field
it changes, opening with the field's label as it stands below; a field the file does not name
stays as it is. `Mode:` starts as below and changes only by the owner's commands (modes.md).>
Mode: full speed; attended
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
deletion. A NEW line that is only a job's verdict or its name gets no row, since one would expect
every later failure of that job: it stays NEW, judged from the job's log at each read, until the job
passes. `--commit <sha>` reads another commit's run and writes nothing. The `invariant-number`
finding on a reserved invariant id that landed above a lower one not yet landed, or above one left
unused, is one row, cleared when the lower id lands or the ending closes the gap.>

## File ownership -- the plan's map
<Each agent's files are its brief's `Owns:` lines, which `reg.py overlap --brief` reads, and its
invariant ids its brief's VALUES line. A new block of real ids, never a placeholder, starts one past
the highest any brief in the `Briefs:` directory reserves, never the highest landed, which would
hand out again an id an unlanded branch holds. An id left unused is a gap the ending closes.>
Hubs (written by more than one slice), each with its owner or its named regions:
Leaves:
Couplings that are not file edges, shared contracts included:
Tracked generated files: <each agent whose change moves one commits it regenerated>

## Landing order -- the ownership map's other half
<One line per ordering constraint, "<branch or agent> lands after <branch or agent>, because
<reason>". What landed, and when, is `git log --first-parent` on the session branch.>

## The cycle, per slice -- decided before any finding exists
| Slice | Rounds | Silent if wrong? Reason | Browser pass |
| ----- | ------ | ----------------------- | ------------ |

## Live agents
| Agent name, then the id the Agent tool returned in backticks | The question it settles | Status |
| ------------------------------------------------------------ | ----------------------- | ------ |
<The messages hook finds a send's recipient by the name or the id in the first cell, and the id
names the agent's worktree branch. Status: RUNNING, written by `reg.py dispatch`, and again on a
resume by its `--id` or by the messages hook when a message reaches a DONE or PAUSED row;
`PAUSED <stamp>`, written by `reg.py pause`; `DONE <stamp> <report file>`, written by
`ledger.py bank --from`. `reg.py live` lists the RUNNING rows and, apart from their count, the
PAUSED ones. What an agent owns is its brief's.>

## Standing actions
| Trigger | The whole brief, written out now | Dispatched? |
| ------- | -------------------------------- | ----------- |

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
<Each question, sent through the ask tool the moment it exists, the recommended option first; or,
while the owner is away, queued here with its options and any provisional build marked, until
`/back` asks it. A question leaves this list when its ruling row is written.>

## Findings ledger
| # | Source report | Finding (file :: anchor) | Status | Owner, or the evidence that closed it |
|---|---|---|---|---|
<The fleet's only ledger: no other file holds findings. One row per labelled finding of every
report, a fixer's included, written by `ledger.py bank` before the next dispatch. A report
labelling a number on several prose lines, or only above its own F1, banks nothing until
`ledger.py bank --line F<n>=<line>` names the line its finding opens on, or `--cited F<n>` names
the label a citation of another report's finding. A row moves to
ROUTED, one owner at a time, by `bank --route`, by a writer's brief's `Rows:` line at
`reg.py dispatch --brief`, by a sent message's `Rows:` line or by `ledger.py route`; its owner is a
live agent or one of the queues `ledger.py route` names when it refuses another, and
`reg.py dispatch --takes <owner>` hands a new agent every row routed to that queue or finished
agent, rows a `Rows:` line naming them cannot take. A row owed to a fixer not yet briefed stays
OPEN until that brief routes it. It moves to FIXED by the landing of its owner's branch whose
`Rows fixed:` line names it, and otherwise to a closed status by `bank --close` or
`ledger.py close`, never by hand. The landing prints one
`ledger.py close … FIXED <merge> <row>` line per row its commits name while it is OPEN and per row
its agent still holds, and names alone a row they name that another owner holds or that is closed:
run the line of each row the merge fixed and no other, since a row can stay routed for a later
round, and no landing closes an OPEN row itself.
Status: one of
`.claude/skills/orchestration/tools/ledger.py :: STATUSES`, a closed one followed by its evidence; a
word outside it stops every ledger command, a landing included.
A routed finding is a claim until its fixer has judged it real. The ending closes every row.>

## Verdicts, and handoff material
<Per banked report, a one-line verdict; its saved path is in the agent's live row. What the handoff
will need, written as it lands. Before banking a novelty as a preference, run the command that
would fail if it were not one.>
```

## Keeping it true

- Keep every row short enough that adding one is cheaper than skipping it.
- Edit the register by hand at most once per message, and never in a tool batch with a command
  that writes it: each tool holds a lock file beside the register across its read and its write, so
  tool writes in one batch, the messages hook's and a background `ci.py --wait`'s all land, while a
  hand edit takes no lock, and of two whole-file writes that overlap the later drops the earlier.
- Record in the live-agent table the question an agent settles, and diff dispatches by path, never by
  task.
- An agent owns every path its brief's `Owns:` lines name until its report lands.
- Write a standing action's whole brief when you queue it, with
  `reg.py queue <register> <trigger> <brief>`; `reg.py dispatch` ticks the row naming the brief it
  dispatches, and `reg.py queue <register> <trigger> <brief> --done <evidence>` ticks any other
  row, a message's among them, once it went out, or withdraws it on the reason given. The trigger
  `window` is the next concluded CI run, and `land.py` refuses to land past a concluded run while
  such a row is unticked, naming `--after-dispatch`, which says the rows went out and ticks them. A
  live agent waiting on a landing is a standing action too, its trigger naming that branch or its
  agent, which `land.py` then names when it lands.
