<!--
TEMPLATE — copy everything below this block to docs/_auditing/reports/<yyyy-mm>-<surface>.md at
programme close (`/audit:finish`), then fill it in; delete this block.
Rules: the close phase is `docs/_auditing/programme.md` §1.5; the shape rules are
`docs/_standard/chapters/1-core.md`.
  - `<Angle-bracketed text>` is a placeholder to replace. Every other line copies verbatim, section
    numbers and names included: a later report on the same surface is compared against this one
    section by section.
  - This report outlives `docs/audit/`, so no reference into that tree may carry substance. Cite
    ADRs, code and git history, which outlive the programme.
  - The repository is public. A remediated finding is described in full, defect and fix alike. An
    unremediated one is named only at a level an attacker cannot act on — the area and the fact that
    work remains, never the reachable path, the missing guard or the payload. Its detail goes to a
    private security advisory on this repository, the channel `SECURITY.md` names for exactly this,
    and the report says it is tracked there without saying what it is.
  - Completeness bar: every major change fully described, every minor change captured in at least
    one bullet, and nothing that merged during the programme left unmentioned.
  - Length is expected to be large; navigability matters more than brevity.
  - This page carries no stamp (CUR-3): it is a record of a programme, not a description of current
    state.
-->

# \<Surface\> audit and remediation — final report

**Programme:** \<yyyy-mm-dd\> → \<yyyy-mm-dd\> · **Method:** [`docs/_auditing/`](../README.md)\
**Scope:** \<what was audited: the directories, the file count with the date it was counted, and the
installed stack versions at audit time\>\
**Outcome in one line:** \<findings, waves, pull requests, and the verdict in one sentence\>

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

## 1. What this programme was, and how it ran

\<What was audited and why · one line per lens on what each pass looked for · the wave structure and
the dependency reasoning behind its order. Enough that a reader understands the shape of the work
without the deleted working documents. Cite the method rather than restating it.\>

## 2. Outcome in numbers

\<One table, before → after, for everything measurable: findings by severity and how each closed
(`fixed` / `won't-fix with evidence` / `false positive` / `superseded`) · test counts · lint baseline
· bundle and shell sizes · each guardrail added, with what it now catches.\>

### Compared with the previous programme on this surface

\<A table against the most recent earlier report for this surface in `docs/_auditing/reports/`, or
the sentence "first programme on this surface" if there is none. One row each, with its delta:
findings by severity · the false-positive rate, which says whether the passes are getting more
accurate · findings in classes an earlier programme's guardrail was supposed to have prevented ·
hazards the risk pass reported as covered by no pass.

A programme should find less than the last one. Where it did not, say so plainly and give the
reading: the surface grew, the lenses got sharper, or the guardrails are not holding.\>

## 3. Major changes, fully described

\<One `###` subsection per theme — security, correctness, caching, boundaries and types,
deduplication, accessibility, performance, guardrails, cleanup. Within a theme, each major change
gives **the defect** (what was wrong and what it cost), **the fix** (what shipped, citing the file or
the ADR), **the visible effect** (what a user or a developer notices now), and any measurement.

Full sentences telling a story, not a changelog: the reader is me in a year, or someone meeting the
project for the first time. Finding IDs appear in passing for greppability, never as a sentence's
subject. Tables carry numbers and enumerations; prose carries every explanation. Any vocabulary the
programme invented — wave names, row IDs, internal shorthand — is explained at first use or left out.
The completeness bar applies hardest here.\>

## 4. Decisions ratified

\<One table: the decisions this programme settled into ADRs and into the CLAUDE.md ratified-decisions
index, each with a one-line description and its ADR link.\>

## 5. Where the audit was wrong

\<How many findings inverted, evaporated, or carried fixes that would not have worked, with
representative examples and what now covers the gap. Point at `docs/_auditing/lessons.md` for the
transferable catalogue rather than repeating it.\>

## 6. The complete record of minor changes

\<Per wave, a compact bullet list covering **every** closed row not already described in section 3 —
one bullet per row or tightly-related group, as `**<ID>** <what changed, in one line>`. A won't-fix
row appears with its reason and its reversal trigger. This section is allowed to be long: it is the
index a future reader greps.\>

## 7. Left open

\<Everything that survived the programme: open items with their analysis and their triggers ·
accepted deviations with the recorded reasoning · anything that could not be verified, with the
reason. **Each entry names where it is now tracked** — an item tracked only here is an item that is
lost. An entry whose detail would be actionable by an attacker is one line naming the area and the
private advisory it is tracked in, and nothing further.\>

## 8. Verification state at close

\<The final gate run, with its actual output shape and exit code · what is enforced continuously
(lint rules at `error`, test suites, CI) · the manual checks a human performed · and plainly, what
was never verified and why.\>
