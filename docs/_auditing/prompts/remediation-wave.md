# Remediation wave prompt

The session prompt for every remediation wave — the optimized successor of the frontend programme's
Part 6 template, which changed shape repeatedly mid-programme; this version bakes in everything
those changes learned. Paste it with `{WAVE}`, `{SECTIONS}` and `{NOTES}` substituted from the
ledger's Part 6 table (or run `/audit:wave <id>`, which does the substitution). `{SECTIONS}` is
mechanically derived from the `§` column of the wave's rows — re-derive it if any row changed since
the table was written.

---

```
Working {WAVE} of docs/audit/0-remediation-ledger.md.

Read the ledger first — it is the plan and the state. Then read ONLY these report
sections, nothing more:
{SECTIONS}

Do not read whole reports, ever. Loading more than the sections above summarises
away caveats that matter. Sections marked "Already-correct" exist to stop you
fixing things that are right — respect them.

RESUME CHECK, before anything else: if any of this wave's rows is `[~]` or the
wave's branch already exists with commits, a previous session died mid-wave.
Reconcile the ledger against `git log` and `git diff main...` — a `[~]` row means
inspect the diff, the work may be partial — then continue from the first
unfinished row. Do not redo committed work.

PHASE 1 — VERIFY THE FINDINGS. Before planning any fix, re-verify every finding
this wave touches against the current code: the file:line still exists, the
defect still reproduces (or demonstrably exists by reading), the report's counts
are right (grep for the pattern yourself — reports name the site they saw, not
the blast radius), and the proposed fix is safe (treat every replacement snippet
as untested code; several shipped defects verbatim in the previous programme).
Record the outcome per row: confirmed / stale / false positive / count-corrected.
A false positive closes `[-]` with evidence — that is a first-class result, not a
failure. The ledger row wins wherever it contradicts the source report; later
waves also amend earlier rows — read a row's full text, including any "Forward
constraint", before acting on it.

CLAUDE.md §9 and docs/_decisions/ list ratified decisions. Several read as
violations and are deliberate. Do not "fix" one without an instruction that
names it; if you think one is wrong, say so and stop.

PHASE 2 — FRONT-LOAD THE OWNER'S DECISIONS. From the verified rows, inventory
everything that needs a human: contrast and colour choices, anything
user-visible, anything reopening a ratified decision, any row whose text names
the owner, and any finding-verification result that flips a fix's direction. Put
the inventory to the owner as ONE batch, each item with the measured options and
your recommendation; where two halves must be decided together, ask them
together. Err toward asking — a question is cheaper than a reverted wave. Then
execute the whole wave without stopping again except for genuinely new
discoveries.

PHASE 3 — EXECUTE, in table order. Discipline:
- Verify library behaviour at the source in node_modules (or the installed
  package) before building on an assumption about it. Multiple fixes in the
  previous programme turned on details no amount of reasoning produced.
- Where a change is visual, the default is that both sides become identical —
  keeping a difference requires the owner's agreement first, and the reason goes
  in the PR description. Ask when unsure whether to abstract; a little
  duplication can beat a large abstraction.
- Commit code per row or small row-group, updating the ledger at the same
  moment — tick the row when its commit lands, mark it `[~]` when you start it.
  The ledger is UNTRACKED (docs/audit/ is gitignored on this public repo), so
  it lives on disk, not in commits. Never accumulate the wave into one
  uncommitted diff — a dead session must be resumable from the on-disk ledger
  plus git alone.
- New findings go to the wave that will fix them, as new ledger rows — not
  silently fixed here unless this wave introduced them.
- Edit the ledger with line-scoped edits only; never pattern-matched bulk
  scripts. Snapshot it to docs/audit/.snapshots/<date>-<time>.md before any
  bulk edit and diff against that snapshot afterwards.

Verification environment, so you do not misread it as a bug:
- The embedded browser pane does not composite while hidden: rAF never fires,
  hard loads look stuck on the loader, geometry reads 0, :focus never matches,
  and the animation clock freezes transitions at their start value. Trust
  client-side navigation, manually flushed reveals, compiled CSS, and CDP-driven
  headless runs; when screenshots time out the pane is hidden — say what could
  not be verified instead of reasoning around it.
- element.click() on a Next <Link> is a HARD navigation here; drive router.push
  to exercise the client router.
- /admin needs a session and credentials are off-limits: use throwaway probe
  routes under /dashboard that replicate the shape, delete them before
  committing, and state plainly what stays unverified.

{NOTES}

PHASE 4 — CLOSE OUT, identical every wave, in this order:
1. Run the Part 4 gate — ./scripts/verify.sh (full when the wave touches
   src/core/config.ts, src/core/auth.ts, src/instrumentation.ts, or rendering;
   --quick otherwise). Report its actual output and exit code; never "passing",
   never a hand-typed substitute chain. It mutates the tree (prettier writes
   first) — commit what it reformats, and read the post-gate diff: the formatter
   has corrupted conditional class strings before.
2. Confirm the wave's own exit gate. A clause needing a human or wall-clock time
   becomes its own row with a trigger — never tick it unverified, never stall
   the wave on it.
3. INDEPENDENT REVIEW (Part 4d): review the wave's full diff as unreviewed code
   from a stranger, against CLAUDE.md and the ADRs — not by re-checking the list
   that produced it. Verify every ticked row against the diff at ALL its call
   sites. This pass found shipped defects in every wave of the previous
   programme; do not skip it, and fix what it finds before proceeding.
4. Write the wave's report in docs/audit/wave-reports.md per Part 4b — required,
   not optional, and written FOR HUMANS: the opening paragraph readable by a
   non-engineer, changes explained as defect → fix → visible effect in full
   sentences, row IDs in passing only (a reader must not need the ledger open),
   failures and reversals narrated honestly. Keep the narrative there; trim each
   ledger row to status + forward constraints + report link (150–600 chars).
   In the same step, harvest lessons: any new misstep, library trap, environment
   trap or process failure with value beyond this programme is verified first
   (reproduced, or confirmed at the source) and merged into the matching theme of
   docs/_auditing/lessons.md — same commit, never a per-wave dump at the end of
   that file.
5. Run the Part 4c consistency sweep: rows against code, report against final
   state, numbers, row ownership, forward instructions. If anything changed
   after a row or section was written, REVISE it in place — never append a
   correction below text that still says the old thing.
6. Push the branch. Then print, in one copy-paste block: the PR title in the
   repo convention (`Scope: what changed`, docs/workflows.md) and the PR body —
   what the branch achieves, what was verified and how, what was deliberately
   left undone, every resolved divergence, and ADR links where a ratified
   decision was touched. The PR body must STAND ALONE: docs/audit/ is
   untracked, so a reviewer on GitHub can see neither the ledger nor the wave
   report — never point at them from the body. gh is not installed: never
   attempt gh pr create. The owner creates the PR and merges; that is their
   only step.
```
