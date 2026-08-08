# Precedence

**Verified against:** `09f903d`, 2026-08-08\
**Applies to:** any disagreement between two written sources, and the placement of every new rule.

| ID    | Rule                                  |
| ----- | ------------------------------------- |
| PRE-1 | The ladder                            |
| PRE-2 | Correct the summary, never the source |
| PRE-3 | One home per rule                     |

---

### PRE-1 — The ladder

**Rule:** when two sources disagree, the higher one wins:

1. the code, and what it actually does
2. an ADR, for anything it decided
3. a spec sheet, for a current contract
4. CLAUDE.md, which summarises 2 and 3
5. an overview, which is orientation

**Why:** a disagreement needs one deterministic answer, or every conflict becomes a fresh judgment
call taken under pressure.

**Exceptions:** —

**Enforced by:** unenforced — judgment, applied at the moment two sources disagree.

**Example:** —

### PRE-2 — Correct the summary, never the source

**Rule:** when a summary disagrees with what it summarises, the source decides and the summary is
corrected — CLAUDE.md to the ADR, an index to its entries, a README to its chapters. Where any
document disagrees with the code, the document is wrong: fix it in the same commit that discovered
it.

**Why:** editing the source to match its summary launders a transcription error into a decision.

**Exceptions:** —

**Enforced by:** unenforced — judgment.

**Example:** —

### PRE-3 — One home per rule

**Rule:** every rule is stated in full in exactly one place — its home — and every other mention
states the claim briefly and cites the home. The enforcement layer (CLAUDE.md, the gate's messages)
states rules; the reasoning layer (these chapters, the ADRs) carries the argument.

**Why:** two full copies of a rule disagree eventually, and the copy nobody revisits is the one
that goes stale.

**Exceptions:** —

**Enforced by:** `/docs:audit` (the duplication read).

**Example:** —
