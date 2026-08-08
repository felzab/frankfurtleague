# Decisions

**Verified against:** `09f903d`, 2026-08-08\
**Applies to:** `docs/_decisions/` — every ADR, and the index beside them.

| ID    | Rule                 |
| ----- | -------------------- |
| DEC-1 | The trigger test     |
| DEC-2 | The anatomy          |
| DEC-3 | The status set       |
| DEC-4 | Immutability         |
| DEC-5 | Numbering            |
| DEC-6 | Reversing a decision |
| DEC-7 | The index            |

---

### DEC-1 — The trigger test

**Rule:** write an ADR exactly when both halves hold — someone would reasonably propose the
opposite, and the argument would have to be re-derived to refuse them. Three things fail the test:

- how-to content
- anything with no rejected alternative
- anything readable off the code in ten seconds

**Why:** a log padded with non-decisions stops being worth reading, and the value of an ADR is the
part that left no trace in the source — why not the other thing.

**Exceptions:** —

**Enforced by:** unenforced — review judgment.

**Example:** "we use <framework>" is an ADR only if not using it was seriously considered.

### DEC-2 — The anatomy

**Rule:** an ADR is `# ADR-<NNNN> — <the decision, as a short statement>`, six metadata lines in
this order — Status, Date, Surface, Supersedes, Superseded by, Source — and exactly four H2
sections in this order: Context, Decision, Consequences, Alternatives considered. No other
section, and no stamp line — an ADR is dated, never re-verified. Source is required on every ADR:
its value resolves, or is a plain sentence carrying its date. Date is when the decision was taken,
not when the file was written.

**Why:** a fixed anatomy is what makes the corpus mechanically checkable, and Source is what keeps
the trail from a decision back to what prompted it intact.

**Exceptions:** —

**Enforced by:** gate check `adr-meta`.

**Example:** [`templates/adr.md`](../templates/adr.md).

### DEC-3 — The status set

**Rule:** Status is exactly one of `Accepted`, `Proposed`, `Deprecated`, or
`Superseded by ADR-NNNN`, in plain text. `Deprecated` means the subsystem went away and nothing
replaced the decision; anything reversed or replaced is `Superseded by ADR-NNNN`.

**Why:** a closed set is checkable, and a reader must never have to guess whether what they are
reading is in force.

**Exceptions:** —

**Enforced by:** gate check `adr-meta`.

**Example:** —

### DEC-4 — Immutability

**Rule:** an accepted ADR's reasoning is never edited — a wrong rationale is a new ADR that
supersedes it. The one editing class allowed is mechanical: a typo, or a reference repair the gate
demands because a path or identifier the text names stopped resolving. Context is the one section
written in the past tense (COR-3 lists the full exemption set); Decision and Consequences are
present tense, aimed at the reader about to break the rule.

**Why:** the log is trustworthy precisely because what it records cannot quietly change under its
readers.

**Exceptions:** the mechanical class above, and the two-line edit of DEC-6.

**Enforced by:** unenforced — review judgment.

**Example:** —

### DEC-5 — Numbering

**Rule:** sequential, zero-padded, never reused: `docs/_decisions/<NNNN>-<short-slug>.md`. The
number is the permanent identity code cites; the slug is for humans and may be adjusted. A retired
number is a permanent gap, mapped in the Retired numbers table of `docs/_decisions/README.md` —
never filled, never renumbered around.

**Why:** comments cite the number, so identity has to survive every reorganisation; a reused
number makes an old citation silently point at a different decision.

**Exceptions:** —

**Enforced by:** gate check `adr-meta` (the H1 must match the filename); the gaps are the index's
job (DEC-7).

**Example:** —

### DEC-6 — Reversing a decision

**Rule:** write the next free number with `Supersedes: ADR-<NNNN>`, status Accepted, dated today.
Then change exactly two things in the old one — its Status to `Superseded by ADR-<NNNN>`, and its
`Superseded by` line. Touch nothing else: not the context, not the reasoning, not a typo in the
reasoning.

**Why:** a reader of the old ADR sees the original argument plus a pointer forward; a reader of
the new one sees what it replaced; neither has to guess which is current.

**Exceptions:** —

**Enforced by:** gate check `adr-meta` (supersession reciprocity).

**Example:** —

### DEC-7 — The index

**Rule:** `docs/_decisions/README.md` carries one row per ADR — number, title, surface, status,
date — appended when the ADR is written, plus the Retired numbers table mapping every permanent
gap to where its content lives. It asserts no counts.

**Why:** the index is the per-surface and per-status view the flat folder deliberately does not
give, and a count is the fact that goes wrong first (COR-4).

**Exceptions:** —

**Enforced by:** gate check `adr-index`.

**Example:** —
