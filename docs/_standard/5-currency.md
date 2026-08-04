# Currency — how documentation stays true

**Verified against:** `55966d7`, 2026-08-04

A documentation standard that only says how to write is a standard that produces accurate documents
once. This chapter is about the other problem: keeping them accurate while the code moves.

**The design principle: never rely on anyone remembering.** Every mechanism here is either mechanical
(the gate fails), structural (the document cannot go stale by construction), or attached to a step
that already happens for another reason. A rule whose only enforcement is diligence is a rule that
holds until the first busy afternoon.

---

## 1. Why some documents cannot go stale

The cheapest currency mechanism is choosing a shape that has no failure mode.

| Layer          | Describes               | Can it go stale?                                                                  |
| -------------- | ----------------------- | --------------------------------------------------------------------------------- |
| **ADR**        | A decision, at its date | **No.** It records what was decided then, which stays true. Reversal is a new ADR |
| **Spec sheet** | The current contract    | Yes — and **detectably**, because every claim is anchored to code                 |
| **Overview**   | What a surface is for   | Slowly, and only when a surface's purpose changes                                 |
| **Glossary**   | What a term means       | Slowly, and detectably where entries cite code                                    |

This is why the three layers exist with three different update triggers. The layer most likely to go
stale is the one built to fail loudly when it does.

**A document that cannot state anchored claims is a document in the wrong shape.** Narrative prose
about current behaviour is the shape that goes quietly, confidently wrong — if a page is drifting
toward that, the answer is to move its content into a spec sheet, not to promise to re-read it.

## 2. The four defences

They run at different moments, and each catches what the one before it misses.

| #   | Defence                | When                  | Catches                                         |
| --- | ---------------------- | --------------------- | ----------------------------------------------- |
| 1   | Anchored citations     | Write time            | Claims that were never checkable                |
| 2   | The same-commit rule   | Change time           | Drift, at the only moment it is cheap to fix    |
| 3   | The documentation gate | `./scripts/verify.sh` | Dangling references, broken links, dead anchors |
| 4   | The close-out question | Before every PR       | Everything the first three cannot see           |

### Defence 1 — anchored citations

Every claim about current behaviour cites something, and the citation is anchored to survive edits
(P6): a file plus a symbol, or a file plus a short quoted fragment. **Never a line number.**

```markdown
| I2 | Base tags are invalidated unconditionally | `fl_frontend/src/features/spiele/actions.ts :: updateTag("spiele")` | … |
```

Two properties follow, and both matter:

- **A reader who doubts a row settles it in seconds.** That is what makes a spec sheet different from
  confident prose.
- **The gate can check it.** An unanchored claim is an assertion; an anchored one is a testable
  statement. This is the whole reason the citation form is mandated.

### Defence 2 — the same-commit rule

**A change that invalidates a documented claim updates that document in the same commit.**

This is the only mechanism that fixes drift at the moment it costs nothing. An hour later the author
has moved on; a week later nobody knows the claim was ever true.

It applies to the assistant and to any person working here, and it is stated in CLAUDE.md because
that is where rules are enforced rather than described. **It is not satisfied by intending to update
the doc afterwards.** A commit that changes behaviour and leaves its documentation contradicting the
code is an incomplete commit, not a commit with a follow-up.

### Defence 3 — the documentation gate

The mechanical layer, and the reason the other three are more than good intentions. It runs inside
`./scripts/verify.sh`, so no session and no person has to be told about it.

**Implemented in `scripts/check_docs.py`, run by `scripts/verify.sh`.** What it checks:

| Check                                                                                                   | Failure means                                                | Verdict  |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------- |
| Every `ADR-NNNN` cited anywhere resolves to a file in `docs/_decisions/`                                | A citation points at nothing — the reader finds no reasoning | **Fail** |
| Every relative markdown link resolves to an existing file                                               | A moved or renamed file left a dead link                     | **Fail** |
| Every in-page `#anchor` link matches a heading in that file                                             | A renamed heading left a link that silently goes nowhere     | **Fail** |
| Every `<file> :: <anchor>` citation: the file resolves unambiguously and the anchor still appears in it | The claim's evidence is gone; the claim may be too           | **Fail** |
| Every backticked repo path exists, unless git ignores it                                                | The page names something that is not there (P3)              | **Fail** |
| Every `Verified against` SHA is an ancestor of `HEAD`                                                   | The stamp is fabricated, or history was rewritten under it   | **Fail** |
| A stamped SHA that this clone does not contain                                                          | Usually a shallow clone rather than a defect                 | Report   |
| Files a page **cites** changed since that page's stamp                                                  | The page **may** be stale — a human decides                  | Report   |
| DS14's history phrases in the branch diff                                                               | Possibly a P3 violation — the hits must be read              | Report   |

Four properties of the implementation worth knowing, because each is a deliberate choice rather than
an omission:

- **Fenced code blocks are stripped before anything is extracted.** A link or citation inside a fence
  is a worked example, and a template is made almost entirely of those.
- **Placeholder text is skipped everywhere** — anything containing `<` `>` `{` `}` `*` `?` or the
  literal `NNNN`. That is what lets a template ship `<sha>` and `ADR-NNNN` on purpose, and it is also
  how a document describes the citation syntax without the checker treating the description as a
  citation.
- **A gitignored path is never a failure.** `docs/audit/` is named across the process documentation
  and is absent from every clone by design.
- **Drift is measured against the files a page cites, never against the page itself.** Editing a page
  is not evidence its claims went stale, and counting it as such would make every documentation commit
  report drift on the file it had just corrected.

**Enforcement is scoped, and widens deliberately.** A failing check fails the run only for paths
listed in the script's `ENFORCED_PATHS`; everywhere else it is counted and reported. The repository
adopts the standard folder by folder, and a repo-wide hard failure before every folder conformed would
have to be suppressed — a suppressed check being worse than no check. Widening is one edit to that
tuple, and each widening belongs in the commit that makes the folder conform.

The three reporting checks are reports rather than failures on purpose: a cited file changing does not
prove a claim wrong, a shallow clone is not a defect, and "the former … the latter" is ordinary
English. **A check that cries wolf gets suppressed.**

### Defence 4 — the close-out question

Before any pull request, one question, answered out loud rather than assumed:

> **What did this change make untrue?**

Then check the places a claim could live about what was touched: the module header, the surface spec
sheet, the glossary if a term's meaning moved, CLAUDE.md if a rule changed, and any ADR this now
contradicts — which is a new ADR, never an edit to the old one.

Answering "nothing" is a legitimate answer. Not asking is not.

## 3. What each document type stamps

| Document                         | Carries `Verified against` | Why                                                                                                                                    |
| -------------------------------- | :------------------------: | -------------------------------------------------------------------------------------------------------------------------------------- |
| Surface overview, spec, glossary |            Yes             | Describes current state; the stamp is what makes drift measurable                                                                      |
| `docs/README.md`, `workflows/`   |            Yes             | Same                                                                                                                                   |
| **ADR**                          |           **No**           | Dated to when the decision was taken. A stamp would imply a re-check that by design never happens — its `Date` field is the equivalent |
| Roadmap files                    |            Yes             | They describe current intent                                                                                                           |
| `_standard/`                     |            Yes             | It describes rules currently in force, and exempting it is how it rotted before (DS19)                                                 |
| Prompts and command files        |             No             | They are instructions, not descriptions. They are governed by P1 and P3 like anything else                                             |

The stamp is `**Verified against:** \`<sha>\`, <date>` near the top. **It means someone confirmed the
page against that commit** — not that the file was edited then. Writing one without checking is
falsifying a record the gate treats as true.

## 4. When a document is wrong

Fix it in place and move on. Three specifics:

- **Never append a correction below text that still says the old thing.** Edit the text to state the
  final position. A document contradicting itself two screens apart is worse than either version
  alone.
- **A wrong ADR is never edited.** Write the next one, and change exactly two lines in the old one:
  its status and its `Superseded by`. The reasoning stays intact — that property is the entire value
  of the log.
- **A claim you cannot verify gets deleted or marked**, not left standing. "This is believed to be
  true and was not checked" is a useful sentence; a confident unverified claim is not.

## 5. What is deliberately not here

**No scheduled review.** A quarterly documentation review is realistic only if it actually runs, and
with a single maintainer it does not. Every mechanism above is attached to work that was going to
happen anyway.

**No coverage target.** A percentage would manufacture filler on the symbols whose names already say
everything, which is the outcome DS3 and DS4 exist to prevent.

**No documentation-only tickets as the primary path.** Drift is fixed in the commit that caused it.
The roadmap holds work that is genuinely separate, not a queue of debts the same-commit rule should
have prevented.
