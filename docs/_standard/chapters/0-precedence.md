# Precedence

**Verified against:** `cda2912d`, 2026-08-19\
**Applies to:** any disagreement between two written sources, and the placement and shape of every
rule in this standard.

| ID    | Rule                                  |
| ----- | ------------------------------------- |
| PRE-1 | The ladder                            |
| PRE-2 | Correct the summary, never the source |
| PRE-3 | One home per rule                     |
| PRE-4 | The anatomy of a rule                 |

---

### PRE-1 — The ladder

**Rule:** when two sources disagree, the higher one wins:

1. the code, and what it actually does
2. a spec sheet, for a current contract
3. CLAUDE.md, which summarises the code and the specs
4. an overview, which is orientation

**Why:** a disagreement needs one deterministic answer, or every conflict becomes a fresh judgment
call taken under pressure.

**Exceptions:** —

**Enforced by:** unenforced — judgment, applied at the moment two sources disagree.

**Example:** —

### PRE-2 — Correct the summary, never the source

**Rule:** when a summary disagrees with what it summarises, the source decides and the summary is
corrected — CLAUDE.md to the spec sheet, an index to its entries, a README to its chapters. Where any
document disagrees with the code, the document is wrong: fix it in the same commit that discovered
it.

**Why:** editing the source to match its summary launders a transcription error into a decision.

**Exceptions:** —

**Enforced by:** unenforced — judgment.

**Example:** —

### PRE-3 — One home per rule

**Rule:** every rule is stated in full in exactly one place — its home — and every other mention
states the claim briefly and cites the home. The enforcement layer (CLAUDE.md, the gate's messages)
states rules; the reasoning layer (these chapters) carries the argument.

**Why:** two full copies of a rule disagree eventually, and the copy nobody revisits is the one
that goes stale.

**Exceptions:** —

**Enforced by:** `/docs:audit` (the duplication read).

**Example:** —

### PRE-4 — The anatomy of a rule

**Rule:** a rule here is `### <ID> — <the rule as a claim>` followed by `**Rule:**`, `**Why:**`,
`**Exceptions:**`, `**Enforced by:**` and `**Example:**` in that order, a row in its chapter's
table, and one line in [`rules-index.md`](../rules-index.md). `Enforced by` names only checks
`check_docs.py :: CHECKS` declares, or says plainly that the rule is unenforced and rests on review
judgment; a field naming a command rather than a check says which read of that command covers it,
and one naming a linter names the selection that covers it. A rule and the check it claims land in
the same commit, and the check is proven against a constructed violation before it is claimed — one
that parses a document is proven against that document in its real position on the page, never
against an example of its shape.

**Why:** the enforcement field is the line a reader trusts without checking, so a claim that
overstates the gate is worse than an unenforced rule: it reads as covered, and nobody looks again. A
check proven only against an example of the shape it parses passes on the example and misreads every
real page — an indented table, a heading that is not at column zero, a second table on the same page.

**Exceptions:** —

**Enforced by:** gate checks `enforced-by`, which resolves every backticked check name a field
carries; `rule-id`, which resolves every cited id to exactly one heading; `rule-shape`, which holds
the heading, the five fields in order and the chapter row; and `rule-index`, which holds the one
index line. Proving a new check is review judgment.

**Example:** —
