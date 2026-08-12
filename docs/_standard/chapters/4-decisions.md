# Decisions

**Verified against:** `bbb5182`, 2026-08-12\
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
opposite, and the argument would have to be re-derived to refuse them. These fail the test:

- how-to content
- anything with no rejected alternative
- anything readable off the code in ten seconds
- a bug fix — it restores behaviour that was already decided, and the decision it restores is
  either written down already or was never one
- filling a gap nobody argues for — the first way of doing something that was absent beat no
  alternative anyone would press, so there is no refusal for a future reader to re-derive

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

**Rule:** an ADR's reasoning becomes immutable when it reaches `main`, not when its Status line
reads `Accepted`. On the branch that writes it the reasoning may still be repaired, and the commit
body making the repair states what changed. Once merged the reasoning is never edited — a wrong
rationale is a new ADR that supersedes it — and two editing classes survive that boundary. The
first is mechanical: a typo, or a reference repair the gate demands because a path or identifier
the text names stopped resolving. The second is a rewrite that is certainly warranted and has been
explicitly approved, and it is allowed only once the approval and its date stand in the Exceptions
field below. Context is the one section written in the past tense (COR-3 lists the full exemption
set); Decision and Consequences are present tense, aimed at the reader about to break the rule.

**Why:** the log is trustworthy precisely because what it records cannot quietly change under its
readers, so every route to a rewrite leaves its own record — in the commit body before the merge,
on this rule after it. What the boundary is not is a private drafting window: a draft pull request
has reviewers, and a reviewer arguing from an ADR's text is reading a page that would otherwise be
free to move underneath them. A stated repair is not the quiet change this rule refuses.

**Exceptions:** the mechanical class above; the two-line edit of DEC-6; the concision rewrite of
every ADR (approved 2026-08-09); the compaction of the numbering to a contiguous `0001`–`0059`
(approved 2026-08-09); ADR-0012's Consequences pointer, rewritten because dissolving
`docs/ops/runbooks.md`'s duplicated half collapsed the claim it made (approved 2026-08-10); and
ADR-0009's Consequences cost figure, rewritten because the figure was measured wrong — the cost
falls per call site, not per page load (approved 2026-08-11).

**Enforced by:** unenforced — review judgment.

**Example:** —

### DEC-5 — Numbering

**Rule:** sequential, zero-padded, never reused: `docs/_decisions/<NNNN>-<short-slug>.md`. The
number is the permanent identity code cites; the slug is for humans and may be adjusted. A retired
number is a permanent gap, recorded in a Retired numbers table in `docs/_decisions/README.md` —
never filled, never renumbered around, except under DEC-4's approval clause, on the same terms:
certainly warranted, explicitly approved, and recorded with its date in the Exceptions field below
before the renumbering starts.

**Why:** comments cite the number, so identity has to survive every reorganisation; a reused
number makes an old citation silently point at a different decision.

**Exceptions:** the compaction of the numbering to a contiguous `0001`–`0059` (approved
2026-08-09).

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
date — appended when the ADR is written. A retired number adds a Retired numbers table mapping
the gap to where its content lives. It asserts no counts.

**Why:** the index is the per-surface and per-status view the flat folder deliberately does not
give, and a count is the fact that goes wrong first (COR-4).

**Exceptions:** —

**Enforced by:** gate check `adr-index`.

**Example:** —
