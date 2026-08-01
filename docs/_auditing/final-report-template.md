# Final report template

The final report is **the only artifact of a programme that stays in the repo** — the pass reports,
the ledger and the wave reports in `docs/audit/` are deleted once it exists. It is written at
programme close (`/audit:finish`), lives in `docs/_auditing/reports/<yyyy-mm>-<surface>.md`, and must
therefore be self-contained: no reference into `docs/audit/` may carry substance (DS12). Cite ADRs,
code, and git history instead — all of which outlive the programme.

**The completeness bar, set by the owner:** every **major** change fully described — defect, fix,
and visible effect, in prose a non-engineer could follow; every **minor** change captured in at
least one bullet point. Nothing that merged during the programme goes unmentioned.

Length is expected to be large; navigability matters more than brevity. Group by theme, not by wave
— a reader asks "what happened to security?", not "what did Wave 3 do?". The per-wave record
(sections 6–7) is where wave-shaped detail lives.

**Written for humans.** The reader is the owner in a year, or someone who has never seen the
programme. Major changes are full sentences telling a story — what was wrong, what it cost, what
shipped, what a user or developer notices now; finding IDs appear in passing for greppability,
never as the sentence's subject. Tables carry numbers and enumerations; prose carries every
explanation. Jargon invented by the programme (wave names, row IDs, internal shorthands) is either
explained at first use or left out. If a section reads like a changelog, rewrite it until it reads
like an account.

---

```markdown
# <Surface> audit & remediation — final report

**Programme:** <start date> → <end date> · **Method:** [`docs/_auditing/`](../README.md)
**Scope:** <what was audited — directories, file counts, versions at the time>
**Outcome in one line:** <findings count, waves, PRs, and the one-sentence verdict>

## 1. Numbers

One table, before → after, for everything measurable: findings by severity and how each closed
(`fixed / won't-fix with evidence / false positive / superseded`), test counts, lint baseline,
bundle/shell sizes, coverage of new guardrails. This is the section that makes "the audit was
worth it" checkable rather than asserted.

## 2. How it was run

A short narrative of the passes (lenses, one line each) and the wave structure with its dependency
reasoning. Enough that a reader understands the shape without the deleted working documents; the
method itself is cited, not restated.

## 3. Major changes — fully described

One `###` subsection per theme (e.g. security, correctness, caching, boundaries & types,
deduplication, accessibility, performance, guardrails, cleanup). For each major change within a
theme: **the defect** (what was wrong and what it cost), **the fix** (what shipped, citing
file/ADR), **the visible effect** (what a user or developer notices), and any measurement.
Full sentences — this is the section the completeness bar applies to hardest.

## 4. Decisions ratified

The decisions the programme extracted into ADRs / CLAUDE.md §9, as a table with one-line summaries
and ADR links. These are the programme's most durable output.

## 5. Where the audit was wrong

An honest accounting: how many findings inverted, evaporated, or carried unsafe fixes, with the
representative examples and what now covers the gap. This is what justifies the verify-first rule
to a future programme. Point to [`lessons.md`](../lessons.md) for the full catalogue.

## 6. Minor changes — the complete record

Per wave, a compact bullet list covering **every** closed row not already described in §3: one
bullet per row or tightly-related row group — `**<ID>** <what changed, one line>`. Won't-fix rows
appear with their reason and reversal trigger. This section is allowed to be long; it is the index
a future reader greps when asking "when did X change and why".

## 7. Left open

Everything that survived the programme: open items with their analysis and triggers, accepted
deviations (with the recorded reasoning), and anything that could not be verified with the reason
stated. Each entry names where it is now tracked — an item that is only tracked here is lost.

## 8. Verification state at close

The final gate run (actual output shape and exit code), what is enforced continuously (lint rules
at `error`, test suites, CI), and the manual checks a human performed. State plainly what was never
verified and why.
```
