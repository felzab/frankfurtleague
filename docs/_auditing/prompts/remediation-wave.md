# Remediation wave prompt

The session prompt for every remediation wave. `/audit:wave <id>` substitutes `{WAVE}`, `{SECTIONS}`
and `{NOTES}` from the ledger's Part 6 and runs it; to run it by hand, substitute them yourself.
`{SECTIONS}` is derived mechanically from the `§` column of the wave's rows — re-derive it if any row
has changed since Part 6 was written.

**Where the prompt states method, [`../programme.md`](../programme.md) is the source and this is a
served copy.** The two change in the same commit.

---

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
   otherwise walk into: findings that are claims rather than facts, replacement
   snippets that ship defects verbatim, the gate's own traps, runtime
   environment artifacts, ledger discipline, and stack-specific facts.
2. docs/audit/programme/0-remediation-ledger.md — the plan and the state.
3. These report sections, and NOTHING else:
{SECTIONS}

Never read a whole report. Loading more than the sections above summarises away
the caveats that matter. Sections marked "Already-correct" exist to stop you
fixing things that are right — respect them.

RESUME CHECK, before anything else: reconcile per programme.md section 3,
"Recording work as it happens", and continue from the first unfinished row.

PHASE 1 — VERIFY THE FINDINGS. A report is a list of claims, not facts. Before
planning any fix, re-verify every finding this wave touches against the current
code:
- the file:line still exists and the defect still reproduces, or demonstrably
  exists by reading;
- the counts are right — grep for the pattern yourself, because a report names
  the site it saw, not the blast radius, and a fix applied to some call sites and
  not others can be worse than no fix;
- the proposed fix is safe — every replacement snippet in a report is untested
  code that has never been executed.
Record the outcome ON THE LEDGER ROW, not only in the session: confirmed /
stale / false positive / count-corrected, with the evidence. A false positive
closes `[-]` with that evidence; it is a first-class result, not a failure.
Verification is a phase of its own — do it for every row this wave touches
before planning any fix, not row by row as you reach them, because one
verification result routinely changes what a later row should do.

Read each row's FULL text, including any "Forward constraint", before acting on
it. The ledger row wins wherever it contradicts the source report, and later
waves amend earlier rows.

CLAUDE.md §7 lists the decisions that read as violations and are deliberate,
and §6 the traps that fail silently. Do not "fix" a §7 row without an
instruction that names it; if you believe one is wrong, say so and stop.

PHASE 2 — FRONT-LOAD MY DECISIONS. From the verified rows, inventory
everything that needs a human: contrast and colour choices, anything
user-visible, anything reopening a ratified decision, any row whose text names
me, and any verification result that flips a fix's direction. Put the
inventory to me as ONE batch, each item with its measured options and your
recommendation; where two halves must be decided together, ask them together. Err
toward asking — a question is cheaper than a reverted wave. Then execute the
whole wave without stopping again, except for genuinely new discoveries.

PHASE 3 — EXECUTE, in table order.
- Verify library behaviour at its source in node_modules or the installed
  package before building on any assumption about it.
- A fix is not done when it compiles. Confirm it changes the thing it was
  supposed to change — a test, a measurement, a rendered check. Where a fix does
  not work, MEASURE rather than trying plausible causes: if changing the
  parameter changes nothing, that parameter is not the variable.
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
  one uncommitted diff — a dead session must be resumable from the on-disk ledger
  plus git alone.
- Edit the ledger with line-scoped edits only, never pattern-matched bulk
  scripts. Snapshot it to docs/audit/programme/.snapshots/<date>-<time>.md before any bulk
  edit and diff against that snapshot afterwards.
- A new finding becomes a row in the wave that will fix it — not a silent fix
  here, unless this wave introduced it.
- A fix removes one instance; a control removes the class. Where this wave has a
  guardrail row in the ledger's Part 1b, land the control BEFORE the fixes it
  covers, so it catches mistakes made in this wave rather than only in later
  ones. Demonstrate it failing on the old code, THEN fix.
  Land it at WARNING level with the current violation count recorded on the row
  as a baseline — setting it to `error` while known violations remain fails the
  gate and blocks the wave. The wave that clears the last violation flips it to
  `error` in the same commit. If this wave is that wave, flip it; if the flip is
  deferred, it is its own row with a trigger, never an intention.
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
