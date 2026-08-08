<!--
TEMPLATE — copy to docs/<surface>/spec.md; delete this block.
Rules: ../chapters/3-corpus.md — the spine is OUT-4.
  - Every claim carries an anchored citation: `<path> :: <symbol>` or an ADR number, never a
    line number (COR-6).
  - Invariant numbers are permanent. A retired invariant keeps its `I<n>`, and rules folded out
    of retired ADRs cite these anchors — renumbering silently breaks them.
-->

# \<Surface\> — spec

**Verified against:** `<sha>`, \<yyyy-mm-dd\>\
**Scope:** \<the directories and files this covers\>

## 1. \<Contract section\>

\<What this surface exposes — endpoints, parameters, exports, configuration — as tables, not
prose. Add as many numbered contract sections as the surface needs; the three fixed sections below
continue the numbering.\>

| Name     | Type     | Default     | Notes                                              |
| -------- | -------- | ----------- | -------------------------------------------------- |
| \<name\> | \<type\> | \<default\> | \<cite the decision where a value is non-obvious\> |

## 2. Invariants

\<All four columns, every row — an invariant with no stated failure mode is a preference, and the
last column is what tells a reader whether breaking it fails loudly or quietly.\>

| #   | Invariant     | Enforced by                                            | Breaks how                      |
| --- | ------------- | ------------------------------------------------------ | ------------------------------- |
| I1  | \<statement\> | \<`<path> :: <symbol>`, or the review rule behind it\> | \<what goes wrong, concretely\> |

## 3. Violation → remedy

\<Symptom-first, for the reader who has the bug and not yet the cause. Include the symptoms that
are correct behaviour — a row reading "working as intended, see I2" saves more time than any other
kind.\>

| Symptom     | Cause     | Remedy                                        |
| ----------- | --------- | --------------------------------------------- |
| \<symptom\> | \<cause\> | \<the fix, referencing the invariant number\> |

## 4. Known-open

\<Accepted gaps, each with what owns it — explicit here so a known limitation never reads as an
oversight and gets "fixed".\>

| #     | Item     | State                                                        |
| ----- | -------- | ------------------------------------------------------------ |
| \<n\> | \<item\> | \<Open / Accepted, plus the roadmap id or ADR that owns it\> |
