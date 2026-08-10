# The audit programme

**Purpose:** the method an audit-and-remediation programme runs by — its phases, its artifacts, the
rules a session works under, and the close-out every wave ends with.

The `/audit:*` commands in `.claude/commands/audit/` load and apply this page.

| Section                     | Answers                                                             |
| --------------------------- | ------------------------------------------------------------------- |
| 1 · The lifecycle           | Which phases exist, in which order, and what each one writes        |
| 2 · The artifacts           | What each file holds and how long it lives                          |
| 3 · Session rules           | What one session may do, and what it must never carry into the next |
| 4 · Close-out               | What every wave ends with                                           |
| 5 · The documentation sweep | Why `/docs:audit` is not a programme                                |

---

## 1. The lifecycle

| Phase      | Command           | Sessions     | Writes                                                 |
| ---------- | ----------------- | ------------ | ------------------------------------------------------ |
| 1 · Passes | `/audit:pass`     | One per pass | One report per pass, in `audit/programme/`             |
| 2 · Ledger | `/audit:plan`     | One          | `docs/audit/programme/0-remediation-ledger.md`         |
| 3 · Wave 0 | —                 | My answers   | Answers recorded in the ledger                         |
| 4 · Waves  | `/audit:wave <n>` | One per wave | Source code, on a branch, plus wave report             |
| 5 · Close  | `/audit:finish`   | One          | `reports/<yyyy-mm>-<surface>.md`; deletes `programme/` |

`/audit:status` reads `programme/state.md`, reconstructs from git whatever that file does not cover,
and resumes interrupted work. Run it first after any crash, token exhaustion, or return from a break.

**Not every part of this method has been executed.** The pass prompts, the shared protocol and
[`lessons.md`](lessons.md) have real runs behind them. The risk pass, the crosscut lens,
[`ledger-template.md`](ledger-template.md) and [`final-report-template.md`](final-report-template.md)
have none — a run of those is a trial of the machinery as much as of the code, so budget for it
failing and record what it costs.

**Each command checks its own preconditions and stops rather than guessing.** The checks are in the
command file.

**One programme runs at a time.** Every working document lives in the single `audit/programme/`
folder, so another programme cannot run beside it.

**What I do; everything else is the session's job.**

1. Run each command in its own session, `/clear` between them.
2. Answer the Wave 0 question batch after `/audit:plan`. `/audit:wave` refuses to run while the
   ledger's `Wave 0 status` reads `OPEN`.
3. Answer each wave's batched question set.
4. Per wave: click **Create pull request**, then **Merge**, then
   `git checkout main && git pull --ff-only`.
5. Confirm the deletion at `/audit:finish`.

### 1.1 Passes

One lens per session, one report each, **report-only — zero fixes, zero source changes**. How a pass
session runs: [`prompts/_shared-protocol.md`](prompts/_shared-protocol.md). How a prompt is built and
how a lens is added or split: §1.6 below.

**Run them risk → surface → crosscut**, because each order position buys something the next cannot:

1. **`risk` first.** It enumerates what would actually hurt, traces each outcome to the paths that
   could produce it, assigns every one to the pass that should look there, and sets the severity
   every later pass inherits. Skip it and every lens is shaped like the stack — a hazard no lens
   covers goes unreported rather than reported as uncovered, and severity means a different thing in
   each report.
2. **Surface passes next**, in their numbered order. Each cites the earlier reports of its own
   surface instead of re-reporting them, and states in its verdict whether it covered the hazards the
   risk pass assigned to it.
3. **`crosscut` last.** The seams between surfaces belong to none of them. It derives both halves of
   every seam from the code, so it runs in a programme auditing any surface.

Every pass ends by naming the **controls that would prevent recurrence** for the classes it found.
Those become the ledger's guardrail backlog.

**The risk pass's hazard table and coverage map live in its own report**, like every other pass's
findings, and reach the next programme through the ledger and through
[`lessons.md`](lessons.md).

### 1.2 Ledger

Built **once**, after the last pass, from each report's **summary table and verdict only** — never a
whole report. [`prompts/_shared-protocol.md`](prompts/_shared-protocol.md) makes those sections a
contract, so nothing the ledger needs is stranded in a report body.

What the ledger holds, in what order, and at what size:
[`ledger-template.md`](ledger-template.md).

**Every hazard the risk pass recorded leaves the programme as a ledger row, an accepted risk or a
roadmap item — never as nothing.**

### 1.3 Wave 0

Every blocking question answered and every decision of mine settled **before any code changes**. A
fix written against an unanswered question can be the exact opposite of correct.

### 1.4 Waves

**One wave = one branch = one pull request = one fresh session.** Wave count is whatever the
dependency structure needs; split any wave whose pull request would be too large to review. Each wave
verifies its findings, batches its questions for me, implements, and runs the close-out in §4.

### 1.5 Close

The final report goes to [`reports/`](reports/), then `docs/audit/programme/` is deleted. **Everything
still owed leaves that folder first** — an open item, an accepted deviation, an unbuilt guardrail or
an uncovered hazard goes somewhere that survives the delete, with its reasoning intact, or it is
lost. What the report must carry, and the publication rule it is written under, are on
[`final-report-template.md`](final-report-template.md), which is what a writer copies.

### 1.6 Writing a prompt

**A prompt states how to derive an inventory, never the inventory itself.** A grep or a config read,
not a list of files; a rule, not a count — anything hardcoded drifts from the code, and no gate
detects that. **Every prompt names its boundaries**, meaning which findings belong to which other
pass; without them one defect becomes several differently-worded findings and the ledger's overlap
map turns into archaeology. Begin a prompt by binding
[`prompts/_shared-protocol.md`](prompts/_shared-protocol.md), and put nothing in it that the shared
protocol already covers.

A new lens is numbered inside its surface folder as `<n>-<kebab-lens>.md` and takes a row in
[`prompts/README.md`](prompts/README.md); `/audit:pass` resolves `<surface>/<n>-*.md` by glob, so
nothing else needs updating. **Name the report path it writes to** —
`docs/audit/programme/<prefix><n>-<lens>.md`, where the prefix is `r` risk · `f` frontend ·
`b` backend · `o` ops · `x` crosscut, so a report is identifiable from its filename alone. **Split a
lens rather than letting one report grow too large to load**, at the size
[`lessons.md`](lessons.md) records: a pass whose report cannot be opened in a wave session is a pass
whose findings cannot be worked.

---

## 2. The artifacts

| Artifact                                   | Holds                                                  | Lifetime                   |
| ------------------------------------------ | ------------------------------------------------------ | -------------------------- |
| `audit/programme/<prefix><n>-*.md`         | Evidence — every finding with its citation             | Deleted at close           |
| `audit/programme/0-remediation-ledger.md`  | The plan and its status                                | Deleted at close           |
| `audit/programme/wave-reports.md`          | Narrative — what was done and why                      | Deleted at close           |
| `audit/programme/state.md`                 | What each session finished, and what it left in flight | Deleted at close           |
| `_auditing/reports/<yyyy-mm>-<surface>.md` | The permanent account                                  | Permanent, tracked, public |

### Why `audit/` is gitignored

This repository is public, so committing the pass reports or the ledger would publish unfixed
findings — security findings included — while they are still being remediated. CLAUDE.md's security
section names `docs/audit/` as the one ignored path this workflow may read and write.

What follows from it:

- **Nothing under `audit/` has git history to recover from.** Snapshot the ledger to
  `docs/audit/programme/.snapshots/<date>-<time>.md` before any bulk edit, and use line-scoped edits
  only — a pattern-matched script has matched the wrong cell and taken rows, an exit gate and a wave
  heading with it.
- **A pull request body can point at none of it**, which is why
  [`../_git/spec.md`](../_git/spec.md) §1.4 requires a body that stands alone.

### Rules per artifact

- **A pass report is written once and never edited afterwards.** The ledger amends findings; reports
  are not rewritten to match. Each report records the **commit it was audited at**, so a later phase
  can measure how far the code has moved.
- **The ledger is the only artifact that survives a context reset.** It must be complete enough for a
  fresh session to continue from it plus git alone.
- **A ledger row is status, not story** — a status marker, the constraints a later wave must obey,
  and a link to the wave report, within the size [`ledger-template.md`](ledger-template.md) sets.
  Anything longer belongs in the wave report.
- **A wave report is revised in place, never appended to.** A correction appended below text that
  still says the old thing leaves a document contradicting itself.
- **`state.md` is appended to, never revised.** It is the one artifact whose value is its order: an
  entry rewritten after the fact describes a session that is no longer there to correct it.

---

## 3. Session rules

- **One session per pass, one session per wave**, and never a pass and a wave together. `/clear`
  between sessions: carrying one pass's context into the next makes the model summarise instead of
  scan.
- **Context budget.** Never load a whole pass report, and never load more than one. A wave session
  gets the ledger plus only the report sections its rows name, derived from the rows' `§` column —
  re-derive that list whenever a row is added, merged or moved.
- **Findings are claims, not facts.** Every wave starts by re-verifying the findings it is about to
  act on against the current code. [`lessons.md`](lessons.md) §1 catalogues the shapes.
- **Ask more, not less.** An ambiguous finding, a user-visible change, a decision that reopens
  something ratified, two fixes that conflict — each is a question for me. Collect them during
  planning and put them as **one batch** with measured options and a recommendation. A question is
  cheaper than a reverted wave.
- **Independent review is a phase, not a favour.** After implementation and before the wave report,
  review the wave's own diff as if it were unreviewed code from a stranger. Re-checking the list that
  produced the diff is a weaker lens and misses what this catches.
- **Revise in place, never append a correction.** When later work changes what an already-written row
  or report section says, edit that text to state the final position and log the change under
  "Revisions after first publication".

### Recording work as it happens

**Write work to disk as it completes, so that at every moment the files on disk state what is done.**
That a dead session can then be resumed cheaply is the consequence, not the purpose.

**Every pass and every wave appends to `docs/audit/programme/state.md`**: one entry when it begins,
naming what it is about to do, and one when it ends, naming what it produced. Append before the work
rather than after it — the entry a successor most needs is the one describing what was in flight when
the session stopped, and a session cannot write that once it is gone. One line per entry, in this
shape:

```
2026-08-09 14:02 · pass backend 2 · start · writing b2-schema-boundary.md
2026-08-09 15:40 · pass backend 2 · done · b2-schema-boundary.md, verdict written
2026-08-09 16:10 · wave 3 · start · rows R2-S4, R2-S5 · branch wave-3-write-path
2026-08-09 16:55 · wave 3 · progress · R2-S4 committed, R2-S5 verified and open
```

**In a wave:** commit code per row or small row-group, and update the ledger **at the same moment** —
`[~]` when work on a row starts, `[x]` when its commit lands. **Never batch a whole wave into one
commit.** A large uncommitted diff is unreviewable while it exists, unrecoverable if it is lost, and
hides which rows are actually finished from everyone including the session writing it.

**Resuming is then mechanical.** `/audit:status` reads `state.md` first, because a session states
what it was doing more cheaply and more exactly than an inference from the tree can. Where that file
is missing, or its last entry is older than the newest commit or the newest artifact, it is not the
record for what happened after it and the reconstruction below is: a killed pass leaves its finished
checks on disk, so continue from the first check with no section, or one marked `INCOMPLETE`, and do
not redo a completed check; a killed wave leaves the branch and the on-disk ledger agreeing, so read
the wave's rows, run `git log` and `git diff main...`, reconcile — a `[~]` row means inspect the
diff, the work may be partial — and continue from the first unfinished row.

---

## 4. Close-out, identical every wave

Every step below is the session's job, in this order, with none skipped.

### 4.1 Run the full gate

```bash
./scripts/verify.sh
```

**The full gate runs on every wave.** The one exception is a wave that changed **documentation
only**, which may use `./scripts/verify.sh --quick`. A wave touching source, config, scripts, Docker
or CI runs the full form whatever the change looks like — [`lessons.md`](lessons.md) §5 holds the
classes that pass a partial gate and break the built image.

Report the script's **actual output and exit code**. Never the word "passing", never a hand-typed
substitute chain.

### 4.2 Handle what the gate rewrote

The gate mutates the tree — the formatter runs in write mode first. Commit what it reformats, and
**read the post-gate diff**: the formatter can corrupt a conditional class string, and nothing else
in the gate sees that.

### 4.3 Confirm the exit gate and the guardrails

Every exit-gate clause, manual ones included. A clause that needs a human or wall-clock time becomes
its own ledger row with a trigger — never tick it unverified, and never stall the wave on it.

Then the guardrails. For every defect class this wave fixed, either its control from the ledger's
guardrail backlog is in place and was **demonstrated failing against the old code**, or a row records
why no control is possible. A control never shown to fail on its target is an untested assertion — a
rule can pass every one of its tests with its load-bearing part deleted. The warning-then-error
sequence a control lands under is [`ledger-template.md`](ledger-template.md) Part 1b.

### 4.4 Independent review

Review the wave's full diff as unreviewed code from a stranger, against CLAUDE.md and the ADRs.
Verify every ticked row against the diff at **all** its call sites, not the one the report named. Fix
what it finds before proceeding.

### 4.5 Write the wave report and harvest lessons

The report and the harvest land in the same commit. The wave report goes in `wave-reports.md`,
written for a reader who was not in the session, in the shape [`lessons.md`](lessons.md) §9 gives.
The harvest merges any durable, **verified** trap into the matching section of
[`lessons.md`](lessons.md). Then trim the ledger rows: rows are status, the report is the story.

### 4.6 Run the consistency sweep

Rows against code · report against final state · numbers · row ownership · forward instructions.
Where anything changed after a row or section was written, revise it in place.

### 4.7 Push and hand over

Push the branch, then print the pull request title and body in one copy-paste block, to
[`../_git/spec.md`](../_git/spec.md) §1.4. Open it with `gh pr create --draft` and hand
over the link. **Never `gh pr ready` and never `gh pr merge`** — marking a draft ready is the act of
saying it passed review, and that is mine.

---

## 5. The documentation sweep is not a programme

**`/docs:audit` audits what is written down rather than what runs**, so almost nothing above applies
to it. Its behaviour is in `.claude/commands/docs/audit.md`; where it sits against the gate and
against one branch's slice is CUR-6.

| It shares                                                     | It does not have                                    |
| ------------------------------------------------------------- | --------------------------------------------------- |
| Report-only: the audit session fixes nothing                  | A risk pass, or severities I set                    |
| Findings are claims, re-verified before anything acts on them | A ledger and waves — fixes go in one pull request   |
| Working documents under `docs/audit/`, gitignored             | A permanent report; a sweep's value expires quickly |

**Its report goes beside `programme/`, never inside it** — `/audit:finish` deletes that folder, and a
sweep belongs to no programme's lifecycle.
