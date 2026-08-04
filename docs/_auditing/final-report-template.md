# Final report template

The final report is **the only artifact of a programme that stays in the repository**. The pass
reports, the ledger and the wave reports in `docs/audit/programme/` are deleted once it exists. It is written
at programme close (`/audit:finish`) to
`docs/_auditing/reports/<yyyy-mm>-<surface>.md`.

**It must be self-contained.** No reference into `docs/audit/programme/` may carry substance (DS12) — cite
ADRs, code and git history, all of which outlive the programme. A reader who has never seen the
programme must be able to follow it end to end.

**This report is committed to a public repository. An unfixed hazard does not go in it.** The working
documents are gitignored precisely so that unremediated findings stay private, and copying one into
the permanent report defeats that. The rule, in both directions:

- **A remediated finding is described in full**, defect and fix alike. It is fixed; describing it
  costs nothing and teaches the next reader.
- **An unremediated finding is named only at a level that is not actionable by an attacker** — the
  area and the fact that work remains, never the reachable path, the missing guard, or the payload.
  Its detail stays in `docs/audit/register.md`, which is gitignored and survives the close, and the
  report points there by name.
- **If you cannot describe something without publishing the exploit, do not describe it.** Say that an
  item is tracked privately and move on.

**Completeness bar:** every **major** change fully described — defect, fix and visible effect, in
prose a non-engineer could follow — and every **minor** change captured in at least one bullet.
Nothing that merged during the programme goes unmentioned.

**Written for humans.** The reader is the owner in a year, or someone encountering the project for
the first time. Major changes are full sentences telling a story: what was wrong, what it cost, what
shipped, what a user or developer notices now. Finding IDs appear in passing for greppability, never
as a sentence's subject. Tables carry numbers and enumerations; prose carries every explanation. Any
vocabulary the programme invented — wave names, row IDs, internal shorthand — is either explained at
first use or left out. **If a section reads like a changelog, rewrite it until it reads like an
account.**

**Group by theme, not by wave.** A reader asks "what happened to security?", not "what did Wave 3
do?". Length is expected to be large; navigability matters more than brevity.

The eight sections, and who each is for:

| Section                       | Answers                                          |
| ----------------------------- | ------------------------------------------------ |
| 1 · What this was, how it ran | "What did you actually do?"                      |
| 2 · Outcome in numbers        | "Was it worth it, and is it improving?"          |
| 3 · Major changes             | "What is different now?"                         |
| 4 · Decisions ratified        | "What must I not undo?"                          |
| 5 · Where the audit was wrong | "How much should I trust the next one?"          |
| 6 · Complete record           | "When did X change, and why?" — the grep target  |
| 7 · Left open                 | "What is still owed, and who holds it?"          |
| 8 · Verification state        | "What was actually checked, and what never was?" |

---

# \<Surface\> audit and remediation — final report

**Programme:** \<start date\> → \<end date\> · **Method:** [`docs/_auditing/`](../README.md)
**Scope:** \<what was audited: directories, file counts, and the stack versions at the time\>
**Outcome in one line:** \<findings, waves, pull requests, and the one-sentence verdict\>

> Sections 1 to 5 are the account: what was done and why. Sections 6 to 8 are the record: the
> complete index of changes, what remains open, and what was verified.

## 1. What this programme was, and how it ran

What was audited and why, then a short narrative of the passes — one line per lens — and of the wave
structure with the reasoning behind its dependency order. Enough that a reader understands the shape
of the work without the deleted working documents. Cite the method rather than restating it.

## 2. Outcome in numbers

One table, before → after, for everything measurable: findings by severity and how each closed
(`fixed` / `won't-fix with evidence` / `false positive` / `superseded`), test counts, lint baseline,
bundle and shell sizes, and the guardrails added with what each now catches. This is the section
that makes "the audit was worth it" checkable rather than asserted.

### Compared with the previous programme on this surface

A second table, against the most recent earlier report for the same surface in
`docs/_auditing/reports/`, or the sentence "first programme on this surface" if there is none. Four
numbers, each with its delta: findings by severity · **the false-positive rate**, which says whether
the passes are getting more accurate · findings in classes that a guardrail from a previous
programme was supposed to have prevented · register rows left `NOT COVERED`.

**A programme should find less than the last one.** If it did not, say so plainly and give the
reading: the surface grew, the lenses got sharper, or the guardrails are not holding. This is the
only place that question gets asked, and an audit programme nobody measures is an audit programme
that cannot be shown to work.

## 3. Major changes, fully described

One `###` subsection per theme — for example security, correctness, caching, boundaries and types,
deduplication, accessibility, performance, guardrails, cleanup. For each major change within a
theme: **the defect** (what was wrong and what it cost), **the fix** (what shipped, citing the file
or ADR), **the visible effect** (what a user or a developer notices now), and any measurement. Full
sentences. The completeness bar applies hardest here.

## 4. Decisions ratified

The decisions the programme settled into ADRs and the CLAUDE.md ratified-decisions index, as a table with one-line
descriptions and ADR links. These are the programme's most durable output — they are what stops a
future audit re-litigating the same patterns.

## 5. Where the audit was wrong

An honest accounting: how many findings inverted, evaporated, or carried fixes that would not have
worked, with representative examples and what now covers the gap. This is what justifies the
verify-before-acting rule to the next programme. Point to [`lessons.md`](../lessons.md) for the
transferable catalogue.

## 6. The complete record of minor changes

Per wave, a compact bullet list covering **every** closed row not already described in section 3 —
one bullet per row or tightly-related group, as `**<ID>** <what changed, one line>`. Won't-fix rows
appear with their reason and their reversal trigger. This section is allowed to be long; it is the
index a future reader greps when asking "when did X change, and why".

## 7. Left open

Everything that survived the programme: open items with their analysis and their triggers, accepted
deviations with the recorded reasoning, and anything that could not be verified, with the reason
stated. **Each entry names where it is now tracked** — an item tracked only here is an item that is
lost.

Apply the publication rule above. An item whose detail would be actionable by an attacker appears
here as one line naming the area and its tracked location, with the substance staying in the
gitignored register.

## 8. Verification state at close

The final gate run (its actual output shape and exit code), what is enforced continuously (lint rules
at `error`, test suites, CI), and the manual checks a human performed. State plainly what was never
verified, and why.
