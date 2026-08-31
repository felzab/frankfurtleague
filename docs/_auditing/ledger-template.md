# Remediation ledger

**Shape:** [`programme.md`](programme.md) §2. Copy the page below to
`docs/audit/programme/0-remediation-ledger.md` and delete this heading and this line.

# Remediation Ledger — \<programme name\>

**Purpose.** The plan and the state for remediating the reports listed below; those reports are the
evidence. The context budget a session reads them under is `docs/_auditing/programme.md` §3.\
**Wave reports.** `docs/audit/programme/wave-reports.md` records what was actually done and why.
Status here, narrative there.\
**Wave 0 status:** `OPEN` — \<replace with `SETTLED <yyyy-mm-dd>` once every Part 1 answer is
recorded; `/audit:wave` refuses to run while this reads `OPEN`\>

## Source reports

\<One row per pass report, in the order the passes were written.\>

| Ref | File                                   | Audited at                    | Findings | CRIT  | HIGH  | Character                       |
| --- | -------------------------------------- | ----------------------------- | -------: | :---: | :---: | ------------------------------- |
| R1  | \<name under `docs/audit/programme/`\> | \<the sha the pass recorded\> |    \<n\> | \<n\> | \<n\> | \<one line on the pass's lens\> |

**Drift check, re-run at the start of every wave.** Compare each report's `Audited at` SHA against
`HEAD` with `git log --oneline <sha>..HEAD -- <that surface's path>`. A report the code has moved a
long way past needs heavier verification rather than discarding — **record the drift on the wave's
rows rather than deciding silently.**

## How to read this file

| Column     | Holds                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**     | `R<report>-<section>`, stable. Cite it in commit messages and pull request titles; a finding discovered outside the reports gets `NEW-<theme><n>` |
| **§**      | The section to open in the source report. Read it before editing the row — the summaries here are lossy by design                                 |
| **Sev**    | The severity its report assigned; where the risk pass rated the same outcome, its severity wins                                                   |
| **Item**   | The defect in one line, and the fix the row commits to                                                                                            |
| **Files**  | The primary file reference — a starting point, never the blast radius                                                                             |
| **Status** | `[ ]` open · `[~]` in progress · `[x]` done · `[!]` blocked · `[-]` won't do                                                                      |

**The ledger row wins wherever it contradicts the source report.** Wave 0 answers and later waves
amend findings; the reports are never rewritten to match.

**Severity is not priority.** Work the waves in order; never re-sort by severity.

**Row hygiene.** A closed row is a status marker, the forward constraints a later wave must obey, and
a report link — 150 to 600 characters. A `[-]` or `[!]` row additionally carries the reason, the
evidence and a **reversal trigger**. Never bulk-edit this file with pattern-matched scripts: use
line-scoped edits, and diff against the latest `.snapshots/` copy before moving on.

---

# Part 1 — Wave 0: what blocks work

Written once, before any wave runs. Everything here is settled **before any code changes**.

**A hazard the risk pass reported as covered by no pass is settled here as well** — as a ledger row,
as an accepted risk with my reasoning recorded, or as a roadmap item. Never as nothing: no later part
of this file has a place to put it.

## 1.1 — Questions answerable only outside this surface's code

\<One row per question: # | Question | Blocks (row IDs) | Why it matters. Answer each by reading the
other surface's code or by asking me, then record the answer of record inline, dated, with its
evidence.\>

## 1.2 — Product decisions for me

\<One row per decision: # | Decision | Blocks (row IDs) | Options with their trade-offs. Put these to
me as ONE batch, each carrying a recommendation, then record the answer inline and dated.\>

## 1.3 — Architectural decisions to ratify

\<The findings the passes flagged that are in fact deliberate. Ratify each as a never-clause in
`.claude/CLAUDE.md` §7 and as an invariant on the governing spec sheet, so no future audit or session
re-litigates it.\>

## 1.4 — Work items on other surfaces created by the answers

\<One row each: ID `XX-n` | Change | What it gates | Wave. Duplicate every row into the wave it
gates.\>

---

# Part 1b — The guardrail backlog

Written once, before any wave runs.

\<Every "controls that would prevent recurrence" entry from every report, merged and deduplicated:
`G-n` | the defect class it closes | the control, which is a lint rule, a test, a schema constraint, a
database validator or a gate step | the findings it would have caught | its cost | **lands in wave** |
**enforced from wave**. Where the honest answer is that no automated control is possible, record that
with its reason.\>

**A control lands before its violations are fixed, so it needs two waves**, since setting a rule to
`error` while known violations remain fails the gate on the first run:

1. **Lands in wave N** — at warning level, with the current violation count recorded on its row as an
   explicit baseline.
2. **Enforced from wave M** — the wave clearing the last violation flips it to `error` in the same
   commit that removes that violation. A deferred flip is its own row with a trigger.

Schedule guardrails as early as their dependencies allow ([`lessons.md`](lessons.md) §8). One left
permanently at warning level is a report rather than a control, so every row names the wave that
flips it, or records why the class cannot be fully cleared.

---

# Part 2 — Cross-report overlap map

Written once, before any wave runs.

\<One table: Single fix | Closes (all IDs) | Wave. The passes run independently against the same
tree, so one defect surfaces in several reports under different lenses; these rows are the fix-once
items.\>

---

# Part 3 — The waves

Written once, before any wave runs.

\<One `## Wave N — <name>` section per wave, in execution order. Wave count is whatever the dependency
structure needs, and the ordering constraints are `docs/_auditing/lessons.md` §8. Sub-split a long
wave — 5a/5b, 8a/8b/8c — rather than letting one pull request become unreviewable.\>

## Wave N — \<name\>

**Report:** \<link to this wave's section of `wave-reports.md`\>

\<One paragraph: what the wave is for, and any standing discipline applying to every row in it.\>

| ID  | §   | Sev | Item | Files | Status |
| --- | --- | :-: | ---- | ----- | :----: |

**Exit gate:** \<the checks that must pass before this wave merges — the `./scripts/verify.sh` exit
code, plus wave-specific clauses such as a lint rule flipping to `error`, a manual browser check or a
measurement. A clause needing a human or wall-clock time becomes its own row with a trigger: never
tick it unverified, and never stall the wave on it.\>

---

# Part 4 — Close-out, run at the end of every wave in this order

`docs/_auditing/programme.md` §4, in that order and with no step skipped.

---

# Part 5 — Session protocol

`docs/_auditing/programme.md` §3.

---

# Part 6 — Per-wave prompt substitutions

Amended as each wave finishes.

\<One entry per wave giving the `{SECTIONS}` and `{NOTES}` values for the wave prompt embedded in
`.claude/commands/audit/wave.md`. Derive `{SECTIONS}` mechanically from the `§` column of
that wave's rows and re-derive it whenever a row is added, merged or moved. Once a wave completes,
rewrite its entry as a record of the traps it hit, so a re-run cannot repeat them.\>
