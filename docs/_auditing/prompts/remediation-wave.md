# Remediation wave prompt

The session prompt for every remediation wave. `/audit:wave <id>` substitutes `{WAVE}`, `{SECTIONS}`
and `{NOTES}` from the ledger's Part 6 and runs it; to run it by hand, substitute them yourself.
`{SECTIONS}` is derived mechanically from the `§` column of the wave's rows — re-derive it if any row
has changed since Part 6 was written.

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
1. docs/_auditing/lessons.md — the traps this wave will otherwise walk into. Its
   §1 (findings are claims), §5 (the gate), §6 (runtime environment), §7 (ledger
   discipline) and §10 (stack-specific facts) all apply to this session directly.
2. docs/audit/programme/0-remediation-ledger.md — the plan and the state.
3. These report sections, and NOTHING else:
{SECTIONS}

Never read a whole report. Loading more than the sections above summarises away
the caveats that matter. Sections marked "Already-correct" exist to stop you
fixing things that are right — respect them.

RESUME CHECK, before anything else: if any of this wave's rows is `[~]`, or the
wave's branch already exists with commits, a previous session died mid-wave.
Reconcile the ledger against `git log` and `git diff main...` — a `[~]` row means
inspect the diff, the work may be partial — then continue from the first
unfinished row. Do not redo committed work.

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

CLAUDE.md's ratified-decisions index and docs/_decisions/ list them. Several read as
violations and are deliberate. Do not "fix" one without an instruction that
names it; if you believe one is wrong, say so and stop.

PHASE 2 — FRONT-LOAD THE OWNER'S DECISIONS. From the verified rows, inventory
everything that needs a human: contrast and colour choices, anything
user-visible, anything reopening a ratified decision, any row whose text names
the owner, and any verification result that flips a fix's direction. Put the
inventory to the owner as ONE batch, each item with its measured options and your
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
  Keeping a difference needs the owner's agreement first, and the reason goes in
  the pull request description. Ask when unsure whether to abstract — a little
  duplication can beat a large abstraction.
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
  three-line fix that is really a refactor — STOP and put it to the owner with
  the measured size and the options. Absorbing it silently is how a wave becomes
  unreviewable; dropping it silently is how a finding disappears.

Two environment facts, so you do not misread them as bugs (lessons.md §6 has the
rest): the embedded browser pane does not composite while hidden, so geometry
reads 0, `:focus` never matches and transitions freeze at their start value — when
screenshots time out, the pane is hidden, so say what could not be verified
instead of reasoning around it. And /admin needs a session while credentials are
off-limits: use throwaway probe routes under a public segment, delete them before
committing, and state plainly what stays unverified.

{NOTES}

PHASE 4 — CLOSE OUT, in this exact order, identical every wave:

1. GATE. Run the FULL ./scripts/verify.sh. The only wave that may use --quick is
   one that changed documentation only; any wave touching source, config,
   scripts, Docker or CI runs the full form regardless of how small the change
   looks. Report its actual output and exit code; never the word "passing",
   never a hand-typed substitute chain.

2. WHAT THE GATE REWROTE. It mutates the tree because the formatter runs first.
   Commit what it reformats, and READ the post-gate diff: the formatter has
   corrupted conditional class strings before, and nothing else in the gate sees
   that.

3. EXIT GATE AND GUARDRAILS. Confirm this wave's own clauses, manual ones
   included. A clause needing a human or wall-clock time becomes its own row
   with a trigger — never tick it unverified, never stall the wave on it.
   Then confirm the guardrails: for every defect class this wave fixed, either
   the control from the ledger's Part 1b is in place AND was demonstrated
   failing against the old code, or a row records why no control is possible.
   A control never shown to fail on the defect it targets is an untested
   assertion — a rule can pass every one of its tests with its load-bearing
   part deleted.

4. INDEPENDENT REVIEW. Review the wave's full diff as unreviewed code from a
   stranger, against CLAUDE.md and the ADRs — not by re-checking the list that
   produced it. Verify every ticked row against the diff at ALL its call sites.
   This reliably finds shipped defects, including regressions introduced earlier
   in this same wave. Fix what it finds before proceeding.

5. WAVE REPORT + LESSONS, same step, same commit. Write this wave's section in
   docs/audit/programme/wave-reports.md, FOR HUMANS: an opening paragraph a non-engineer
   can read, changes explained as defect → fix → visible effect in full
   sentences, row IDs in passing only so a reader never needs the ledger open,
   and failures, reversals and unresolved anomalies narrated honestly. Then trim
   each ledger row to status + forward constraints + report link (150–600
   characters).
   Harvest lessons in the same commit: any new misstep, library trap, environment
   trap or process failure with value beyond this programme is VERIFIED first —
   reproduced, or confirmed at the source — then merged into the matching section
   of docs/_auditing/lessons.md. Never append a per-wave dump at the end of that
   file.

6. CONSISTENCY SWEEP. Rows against code, report against final state, numbers, row
   ownership, forward instructions. Where anything changed after a row or section
   was written, REVISE it in place — never append a correction below text that
   still says the old thing.

7. PUSH AND HAND OVER. Push the branch, then print in one copy-paste block the
   pull request title in the repo convention (`Scope: what changed`,
   docs/workflows/) and the body: what the branch achieves, what was verified and
   how, what was deliberately left undone, every resolved divergence, and ADR
   links wherever a ratified decision was touched. The body must STAND ALONE —
   docs/audit/ is untracked, so a reviewer on GitHub can see neither the ledger
   nor the wave report; never point at them. Open it with gh pr create --draft
   and hand over the link. NEVER run gh pr ready or gh pr merge -- marking a
   draft ready says it passed review, and that is the owner's step.
```
