# Spec sheet

**Shape:** OUT-4 in [`../chapters/3-corpus.md`](../chapters/3-corpus.md). Copy the page below to
`docs/<surface>/spec.md` and delete this heading and this line.

# \<Surface\> — spec

**Verified against:** `<sha>`, \<yyyy-mm-dd\>\
**Scope:** \<the directories and files this covers\>

| Section               | Answers                                               |
| --------------------- | ----------------------------------------------------- |
| 1. Contract           | What this surface exposes, and on what terms          |
| 2. Invariants         | What must stay true, and what enforces it             |
| 3. Violation → remedy | The symptom is here; what caused it and what fixes it |
| 4. Known-open         | What is accepted as missing, and what owns it         |

## 1. Contract

\<What this surface exposes — endpoints, parameters, exports, configuration — as tables, not
prose. Add as many `1.<n>` subsections as the surface needs: the contract grows, and the three
fixed sections keep their numbers so a citation of section 3 means the same thing in every sheet.\>

### 1.1 \<Contract section\>

| Name     | Type     | Default     | Notes                                              |
| -------- | -------- | ----------- | -------------------------------------------------- |
| \<name\> | \<type\> | \<default\> | \<cite the decision where a value is non-obvious\> |

## 2. Invariants

\<This table and nothing else. A symptom a reader would observe is a row in section 3; the argument
for an invariant is in the commit that made it.\>

| #   | Invariant     | Enforced by                                            |
| --- | ------------- | ------------------------------------------------------ |
| I1  | \<statement\> | \<`<path> :: <symbol>`, or the review rule behind it\> |

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

| #     | Item     | State                                                 |
| ----- | -------- | ----------------------------------------------------- |
| \<n\> | \<item\> | \<Open / Accepted, plus the roadmap id that owns it\> |
