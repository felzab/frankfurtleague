# Final report

**Shape:** [`programme.md`](programme.md) §1.5. Copy the page below to
`docs/audit/<yyyy-mm>-<surface>.md` and delete this heading and this line.

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
the dependency reasoning behind its order — enough that a reader understands the shape of the work
without the deleted working documents. Cite the method rather than restating it.\>

## 2. Outcome in numbers

\<One table, before → after, for everything measurable: findings by severity and how each closed
(`fixed` / `won't-fix with evidence` / `false positive` / `superseded`) · test counts · lint baseline
· bundle and shell sizes · each guardrail added, with what it now catches.\>

### Compared with the previous programme on this surface

\<A table against the most recent earlier report for this surface, or the sentence "first programme
on this surface" if there is none. One row each, with its delta: findings by severity · the
false-positive rate, which says whether the passes are getting more accurate · findings in classes an
earlier programme's guardrail was supposed to have prevented · hazards the risk pass reported as
covered by no pass.

A programme should find less than the last one. Where it did not, say so plainly and give the
reading: the surface grew, the lenses got sharper, or the guardrails are not holding.\>

## 3. Major changes, fully described

\<One `###` subsection per theme — security, correctness, caching, boundaries and types,
deduplication, accessibility, performance, guardrails, cleanup. Within a theme, each major change
gives **the defect** (what was wrong and what it cost), **the fix** (what shipped, citing the file or
the ratified decision), **the visible effect** (what a user or a developer notices now), and any
measurement.

Full sentences telling a story, not a changelog: the reader is me in a year, or someone meeting the
project for the first time. Finding IDs appear in passing for greppability, never as a sentence's
subject. Tables carry numbers and enumerations; prose carries every explanation. Any vocabulary the
programme invented — wave names, row IDs, internal shorthand — is explained at first use or left
out.\>

## 4. Decisions ratified

\<One table: the decisions this programme settled into the CLAUDE.md ratified-decisions index and
into the governing spec sheet's invariants, each with a one-line description and where it is
recorded.\>

## 5. Where the audit was wrong

\<How many findings inverted, evaporated, or carried fixes that would not have worked, with
representative examples and what now covers the gap. Point at `docs/_auditing/lessons.md` for the
transferable catalogue rather than repeating it.\>

## 6. The complete record of minor changes

\<Per wave, a compact bullet list covering **every** closed row not already described in section 3 —
one bullet per row or tightly-related group, as `**<ID>** <what changed, in one line>`. A won't-fix
row appears with its reason and its reversal trigger. Allowed to be long: it is the index a future
reader greps.\>

## 7. Left open

\<Everything that survived the programme: open items with their analysis and their triggers ·
accepted deviations with the recorded reasoning · anything that could not be verified, with the
reason. **Each entry names where it is now tracked.**\>

## 8. Verification state at close

\<The final gate run, with its actual output shape and exit code · what is enforced continuously
(lint rules at `error`, test suites, CI) · the manual checks a human performed · and plainly, what
was never verified and why.\>
