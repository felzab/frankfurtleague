---
description: Run a remediation wave — /audit:wave <id>, e.g. /audit:wave 2
---

Run remediation wave `$ARGUMENTS` of `docs/audit/programme/0-remediation-ledger.md`, in a fresh
session, on its own branch.

**Preconditions — check first, report what fails, stop where stated:**

| Check                                                   | If it fails                                                                                                     |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| The ledger exists                                       | **Stop.** Run `/audit:plan` first                                                                               |
| Its `Wave 0 status:` line reads `SETTLED <date>`        | **Stop.** Present the open Part 1 questions and wait                                                            |
| The named wave exists in the ledger                     | **Stop.** List the waves that do exist                                                                          |
| Every earlier wave is closed (no `[ ]` or `[~]`)        | **Stop** unless the owner says to proceed. Waves are dependency-ordered — later ones assume earlier work landed |
| `main` is up to date with `origin/main`                 | Pull before branching, so the wave does not build on a stale base                                               |
| The working tree is clean                               | **Stop.** Uncommitted work would be swept into this wave's commits                                              |
| Report drift since each cited report's `Audited at` SHA | Report it and raise the verification bar for this wave's rows accordingly                                       |

**Steps:**

1. Read `docs/_auditing/lessons.md` in full — passing the preconditions above is no reason to skip
   that read. Then read the ledger and locate the wave.
2. Take the wave's `{SECTIONS}` and `{NOTES}` from the ledger's Part 6 entry. Re-derive `{SECTIONS}`
   from the wave rows' `§` column and compare against Part 6 — if they differ, Part 6 is stale:
   correct it first, then use the derived list.
3. Substitute `{WAVE}`, `{SECTIONS}` and `{NOTES}` into the prompt below and execute it as written,
   end to end.
4. Append to `docs/audit/programme/state.md` as the wave runs, in the shape
   `docs/_auditing/programme.md` §3 gives. The ledger carries a row's status; this carries what the
   session was doing when it stopped, which is what a successor cannot infer.

The session ends with the branch pushed, the draft pull request open and its `verify` run's
conclusion named, per CLAUDE.md §2 and `docs/_git/spec.md`.

## The wave prompt

Where the prompt states method, `docs/_auditing/programme.md` is the source.

```
Working {WAVE} of docs/audit/programme/0-remediation-ledger.md.

DONE MEANS: every row of this wave is `[x]`, `[-]` or `[!]` with its evidence;
the full gate passed; the wave report exists; the branch is pushed; and the pull
request title and body are printed. Anything less is an unfinished wave, however
much code landed.

BRANCH FIRST. If you are not already on this wave's branch, create
`wave-<id>-<kebab-name>` off current main before the first edit. One wave = one
branch = one pull request. Never commit to main, never merge locally.

READ FIRST, in this order:
1. docs/_auditing/lessons.md, in full. It records the traps this wave will
   otherwise walk into.
2. docs/audit/programme/0-remediation-ledger.md — the plan and the state.
3. These report sections, and NOTHING else:
{SECTIONS}

Never read a whole report. Sections marked "Already-correct" exist to stop you
fixing things that are right — respect them.

RESUME CHECK, before anything else: reconcile per programme.md section 3,
"Recording work as it happens", and continue from the first unfinished row.

PHASE 1 — VERIFY THE FINDINGS. Do this for every row this wave touches, before
planning any fix. A report is a list of claims (lessons.md section 1):
- the file:line still exists and the defect still reproduces, or demonstrably
  exists by reading;
- the counts are right — grep the pattern yourself rather than trusting the
  report's list of sites;
- every replacement snippet is untested code that has never been executed.
Record the outcome ON THE LEDGER ROW, not only in the session: confirmed /
stale / false positive / count-corrected, with the evidence. A false positive
closes `[-]` with that evidence; it is a first-class result, not a failure. One
verification result routinely changes what a later row should do.

Read each row's FULL text, including any "Forward constraint", before acting on
it. The ledger row wins wherever it contradicts the source report, and later
waves amend earlier rows.

CLAUDE.md section 7 lists the decisions that read as violations and are
deliberate, and section 6 the traps that fail silently; both hand the clauses a
glob can reach to the files under `.claude/rules/`, which section 7 indexes. Do
not "fix" one without an instruction that names it; if you believe one is wrong,
say so and stop.

PHASE 2 — FRONT-LOAD MY DECISIONS. From the verified rows, inventory
everything that needs a human: contrast and colour choices, anything
user-visible, anything reopening a ratified decision, any row whose text names
me, and any verification result that flips a fix's direction. Put the
inventory to me as ONE batch, each item with its measured options and your
recommendation; where two halves must be decided together, ask them together.
Err toward asking. Then execute the whole wave without stopping again, except
for genuinely new discoveries.

PHASE 3 — EXECUTE, in table order.
- Verify library behaviour at its source in node_modules or the installed
  package before building on any assumption about it.
- A fix is not done when it compiles. Confirm it changes the thing it was
  supposed to change — a test, a measurement, a rendered check. Where a fix does
  not work, MEASURE rather than trying plausible causes.
- Where a change is visual, the default is that both sides become identical.
  Keeping a difference needs my agreement first, and the reason goes in
  the pull request description. Ask when unsure whether to abstract — a little
  duplication can beat a large abstraction.
- Where a row removes code, delete it rather than deprecating it, and name in
  the commit which copy died. A row that adds a shared module without deleting
  what it replaces has not closed.
- Commit code per row or small row-group, updating the ledger at the same moment:
  `[~]` when you start a row, `[x]` when its commit lands. The ledger is
  UNTRACKED, so it lives on disk, not in commits. Never accumulate the wave into
  one uncommitted diff. Edit it with line-scoped edits only, and snapshot it
  before any bulk edit, to the path programme.md section 2 names.
- A new finding becomes a row in the wave that will fix it — not a silent fix
  here, unless this wave introduced it.
- Where this wave has a guardrail row in the ledger's Part 1b, land the control
  BEFORE the fixes it covers, demonstrated failing on the old code, so it catches
  mistakes made in this wave rather than only in later ones. Part 1b sets the
  warning-then-error sequence it lands under.
- If a row turns out to cost materially more than its wave assumed — a
  three-line fix that is really a refactor — STOP and put it to me with
  the measured size and the options. Absorbing it silently is how a wave becomes
  unreviewable; dropping it silently is how a finding disappears.

{NOTES}

PHASE 4 — CLOSE OUT. Run every step of programme.md section 4, in order, with
none skipped. Report net lines changed, separating what was relocated from what
was removed: a reshaping that moves content between files is not a reduction,
and a diffstat that excludes new untracked files overstates one.
```
