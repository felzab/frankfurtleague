# Precedence

**Verified against:** `889c31dd`, 2026-08-19\
**Applies to:** any disagreement between two written sources, and the shape of every rule here.

| ID    | Rule                                  |
| ----- | ------------------------------------- |
| PRE-1 | The ladder                            |
| PRE-2 | Correct the summary, never the source |
| PRE-4 | The anatomy of a rule                 |

---

### PRE-1 — The ladder

**Rule:** when two sources disagree the higher wins: the code and what it actually does, then a spec
sheet for a current contract, then CLAUDE.md, then an overview.

**Why:** a disagreement needs one deterministic answer, or every conflict becomes a fresh judgment
call taken under pressure.

**Enforced by:** unenforced — judgment, applied at the moment two sources disagree.

### PRE-2 — Correct the summary, never the source

**Rule:** when a summary disagrees with what it summarises, the source decides and the summary is
corrected. Where any document disagrees with the code, the document is wrong: fix it in the commit
that discovered it.

**Why:** editing the source to match its summary launders a transcription error into a decision.

**Enforced by:** unenforced — judgment.

### PRE-4 — The anatomy of a rule

**Rule:** a rule is `### <ID> — <the rule as a claim>`, then `**Rule:**`, `**Why:**`, an optional
`**Exceptions:**`, `**Enforced by:**` and an optional `**Example:**` in that order, plus a row in its
chapter's table and one line in [`rules-index.md`](../rules-index.md). An optional field appears only
when it carries something; an empty one is deleted rather than filled with a dash.

**A rule the index states alone carries no chapter section and no chapter row.** That one line is the
whole rule, its enforcement claim included, and it is the whole of what a citation of that id
resolves to.

`Enforced by` names only checks `check_docs.py :: CHECKS` declares, or says the rule is unenforced. A
field naming a command says which read of it covers the rule; one naming a linter names the
selection. A rule and the check it claims land in the same commit, and the check is proven against a
constructed violation first — one that parses a document is proven against that document in its real
position on the page, never against an example of its shape.

**Why:** the enforcement field is the line a reader trusts without checking, so a claim overstating
the gate is worse than an unenforced rule: it reads as covered and nobody looks again. A check proven
only against an example of the shape it parses passes on the example and misreads every real page.

**Enforced by:** gate checks `enforced-by`, which resolves every backticked check name a field
carries; `rule-id`, which resolves every cited id to exactly one home; `rule-shape`, for the
heading, the field order and the chapter row; and `rule-index`, for the one index line. Proving a new
check is review judgment.
