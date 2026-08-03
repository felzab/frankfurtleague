# Ledger template

Copy everything below the horizontal rule to `docs/audit/0-remediation-ledger.md` once a programme's
passes are complete, then fill it in. `<Angle-bracketed text>` is a placeholder to replace; every
other line is a standing rule and copies verbatim.

The rules baked into this template are the countermeasures for the ways a ledger breaks — see
[`lessons.md` §7](lessons.md#7-ledger-discipline--the-failure-modes-and-their-rules).

**Part order is execution order.** Parts 1 to 3 are built once, before any wave. Part 4 runs at the
end of every wave, top to bottom, with no reordering. Parts 5 and 6 are reference.

---

# Remediation Ledger — \<programme name\>

**Purpose.** The single working document for remediating all findings from the \<N\> audit reports.
The reports are the evidence; this file is the plan and the state. A session reads this file plus
the _specific report sections_ its wave names — never a whole report, never two reports.

**Wave reports live in [`wave-reports.md`](wave-reports.md).** This file tracks _what must be done
and whether it is done_. That file records _what was actually done and why_. Status here, narrative
there.

**Source reports** (in `docs/audit/`, listed in the order they were written):

| Ref | File     | Findings | CRIT  | HIGH  | Character                       |
| --- | -------- | -------: | :---: | :---: | ------------------------------- |
| R1  | \<file\> |    \<n\> | \<n\> | \<n\> | \<one line on the pass's lens\> |

## How to read this file

- **ID** — stable identifier, `R<report>-<section>`. Cite it in commit messages and pull request
  titles. A finding discovered outside the reports gets `NEW-<theme><n>`.
- **§** — the section to open in the source report. Always read it before editing; the summaries
  here are lossy by design.
- **Files** — the primary file reference. A _starting point_, never the blast radius.
- **Status** — `[ ]` open · `[~]` in progress · `[x]` done · `[!]` blocked · `[-]` won't do.

**The ledger row wins wherever it contradicts the source report.** Wave 0 answers and later waves
amend findings; the reports are never rewritten to match.

**Severity is not priority.** Wave assignment already accounts for severity, blast radius, cost and
dependency order. Work the waves in order; never re-sort by severity.

**Row hygiene.** A closed row is a status marker, the forward constraints a later wave must obey,
and a report link — 150 to 600 characters. `[-]` and `[!]` additionally need the reason, the
evidence, and a **reversal trigger**. Never bulk-edit this file with pattern-matched scripts; use
line-scoped edits and diff against the latest `.snapshots/` copy before moving on.

---

# Part 1 — Wave 0: what blocks work

Everything here is settled **before any code changes**. Answers routinely invert findings.

## 1.1 — Questions answerable only outside this surface's code

\<One row per question: # | Question | Blocks (row IDs) | Why it matters. Answer each by reading the
other surface's code or by asking the owner, and record the answer of record inline, dated, with its
evidence.\>

## 1.2 — Product and owner decisions

\<# | Decision | Blocks | Options with trade-offs. Put these to the owner as ONE batch, each with a
recommendation. Record the answer inline and dated.\>

## 1.3 — Architectural decisions to ratify

\<Findings that the passes flagged and that are in fact deliberate. Ratify each into an ADR under
`docs/_decisions/` and the CLAUDE.md §9 summary, so no future audit or session re-litigates it.
This is consistently the cheapest, highest-value item in a programme.\>

## 1.4 — Work items on other surfaces created by the answers

\<ID `XX-n` | Change | What it gates | Wave. Duplicate each as a row in the wave it gates.\>

---

# Part 2 — Cross-report overlap map

\<The passes run independently against the same tree, so one defect surfaces in several reports
under different lenses. One table: Single fix | Closes (all IDs) | Wave. These are fix-once items;
working the reports in sequence instead of this map means fixing each of them more than once.\>

---

# Part 3 — The waves

\<One `## Wave N — <name>` section per wave, in execution order. Wave count is whatever the
dependency structure needs. Proven ordering constraints: guardrails first · broken-in-production
next · boundaries before extraction · design tokens before extraction · accessibility after
extraction · performance late · cleanup last. Sub-split a long wave (5a/5b, 8a/8b/8c) rather than
letting one pull request become unreviewable.\>

## Wave N — \<name\>

**Report:** [Wave N — \<name\>](wave-reports.md#wave-n--anchor)

\<One paragraph: what the wave is for, and any standing discipline that applies to every row in it.\>

| ID  | §   | Sev | Item | Files | Status |
| --- | --- | :-: | ---- | ----- | :----: |

**Exit gate:** \<the checks that must pass before this wave merges — the `./scripts/verify.sh` exit
code, plus wave-specific clauses such as a lint rule flipping to `error`, a manual browser check, or
a measurement. A clause needing a human or wall-clock time becomes its own row with a trigger: never
tick it unverified, and never stall the wave on it.\>

---

# Part 4 — Close-out, run at the end of every wave in this order

## 4.1 Gate

```bash
./scripts/verify.sh
```

**The full gate runs on every wave.** The single exception is a wave that changed **documentation
only**, which may use `./scripts/verify.sh --quick`. Any wave touching source, config, scripts,
Docker or CI runs the full form regardless of how small the change looks — the defect classes that
pass a partial gate and break the built image are exactly the ones that look harmless in a diff.

**Run the script, never a hand-typed chain** — a hand-typed chain is a chain someone drops a link
from. Any new check goes _inside_ the script, so no future session has to be told about it. Report
the actual output and exit code, never the word "passing".

Record the lint-warning baseline here at Wave 1, so later waves can tell new violations from
inherited ones.

## 4.2 Handle what the gate rewrote

The gate mutates the tree — the formatter runs in write mode first. Commit what it reformats, as its
own commit when the reformat is large, and **read the post-gate diff**: the formatter has corrupted
conditional class strings before, and nothing else in the gate sees that.

## 4.3 Confirm the wave's own exit gate

Every clause, manual ones included. A clause needing a human or wall-clock time becomes its own row
with a trigger — never tick it unverified, and never stall the wave on it.

## 4.4 Independent review

Review the wave's full diff **as unreviewed code from a stranger**, against CLAUDE.md and the ADRs —
not by re-checking the list that produced it. Verify every ticked row against the diff at **all** its
call sites, not the one the report named. File what it finds: fix in-wave if this wave introduced it,
otherwise open a row in the wave that owns it. This is a phase, not an owner favour, and it reliably
finds shipped defects.

## 4.5 Wave report and lessons harvest

Write this wave's section in `wave-reports.md` using the template there. **A wave is not finished
until its report exists.** Then trim the ledger rows — rows are status, the report is the story.

**Wave reports are written for humans, not machines.** The audience is someone who was not in the
session: the owner months later, a reviewer, a future session. That means the "what this wave was
for" paragraph must be readable by a non-engineer; changes are grouped by theme and explained as
defect → fix → visible effect in full sentences; row IDs appear in passing for greppability and never
as the load-bearing text, because a reader must not need the ledger open to follow the story; tables
carry enumerable facts and prose carries every explanation; and failed attempts, reversals and
unresolved anomalies are narrated honestly, because a report listing only successes tells the next
reader nothing the diff does not.

**In the same step and the same commit, harvest lessons.** Any new misstep, false positive, library
trap, environment trap or process failure with value beyond this programme is **verified first** —
reproduced, or confirmed at the library source or the running system — and then merged into the
matching section of [`../_auditing/lessons.md`](../_auditing/lessons.md). Merge into existing
sections; never append a per-wave dump. Programme-local detail stays in the wave report; only the
durable, transferable lesson moves.

## 4.6 Consistency sweep

**Revise in place. Never append a correction below text that still says the old thing.** Five checks:

1. **Rows against code** — every row touched matches what is actually in the final diff.
2. **Report body against final state** — read it as a stranger; every section states the end position.
3. **Numbers** — gate output, test counts, advisory counts and commit ranges go stale first.
4. **Row ownership** — every row lives in the wave that owns it.
5. **Forward instructions** — this wave's Part 6 entry, and any constraints written onto later rows,
   reflect what was actually decided.

## 4.7 Push and hand over

Push the branch, then print in one copy-paste block the pull request **title**
(`Scope: what changed`) and **body**. The body must **stand alone**: `docs/audit/` is untracked, so a
reviewer on GitHub can see neither this file nor the wave report — never point at them. `gh` is not
installed; the owner creates the pull request and merges it.

---

# Part 5 — Session protocol

**One wave = one branch = one pull request = one fresh session.** Never merge across wave
boundaries, and never run two waves at once — they share this file.

**Context budget.** Each session gets this ledger plus the specific `§` sections named in its wave's
rows. Never a whole report, never two.

**Commit granularity and resume.** Commit code per row or small row-group, updating this (untracked)
file at the same moment: `[~]` when work on a row starts, `[x]` when its commit lands. If the session
dies, the next one reconciles the on-disk ledger against `git diff main...` and continues from the
first unfinished row — `/audit:status` does this. Never accumulate a whole wave into one uncommitted
diff.

**This file is local-only.** `docs/audit/` is gitignored because the repository is public and unfixed
findings must not publish. Snapshot to `docs/audit/.snapshots/<date>-<time>.md` before any bulk edit,
so a botched edit has a last-good version to diff against.

**Front-load the owner's decisions.** Before writing code, inventory every row that needs a human —
user-visible changes, contrast and colour, anything reopening a ratified decision, any row naming the
owner — and ask them as ONE batch with measured options and recommendations. Ask more rather than
less; a question is cheaper than a reverted wave.

---

# Part 6 — Per-wave prompt substitutions

\<One entry per wave, giving the `{SECTIONS}` and `{NOTES}` values for
`docs/_auditing/prompts/remediation-wave.md`. `{SECTIONS}` is derived mechanically from the `§`
column of that wave's rows — re-derive it whenever a row is added, merged or moved, because a
hand-maintained copy goes stale silently. After a wave completes, rewrite its entry as a record of
the traps it hit, so a re-run cannot repeat them.\>
