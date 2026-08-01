<!--
TEMPLATE — copy to docs/<surface>/spec.md and fill in.
Guidance: ../2-out-of-code.md, "Layer 2 — spec sheets"

Two non-negotiables:
  1. Every claim cites a file/line or an ADR. A reader who doubts a row settles it in seconds.
  2. Invariants are numbered, so code comments and ADRs can reference them.

Accuracy over volume. If something cannot be verified, say so rather than writing plausible prose.
Delete this comment block.
-->

# <Surface> — spec

**Verified against:** `<commit>`, `<date>`
**Governing decisions:** ADR-NNNN, ADR-NNNN
**Scope:** <which directories this covers>

## 1. Contract

What this surface exposes. Tables, not prose — parameters, endpoints, exports, configuration.

| Name | Type | Default | Notes                                          |
| ---- | ---- | ------- | ---------------------------------------------- |
|      |      |         | Cite the decision where a value is non-obvious |

## 2. Invariants

Numbered. Each row needs all four columns — an invariant without a stated failure mode is a preference,
not a constraint.

| #   | Invariant | Enforced by                             | Breaks how                  |
| --- | --------- | --------------------------------------- | --------------------------- |
| I1  |           | `file.ts:12` or "review (CLAUDE.md §N)" | What goes wrong, concretely |

## 3. Violation → remedy

The symptom-first index. Written for the reader who has the bug and does not yet know the cause.

| Symptom | Cause | Remedy                         |
| ------- | ----- | ------------------------------ |
|         |       | Reference the invariant number |

## 4. Known-open

Accepted gaps and unresolved items, each with whatever owns it. Being explicit here is what stops a
known limitation from reading like an oversight.

| #   | Item | State                                                |
| --- | ---- | ---------------------------------------------------- |
|     |      | Open / Accepted, plus the ledger or ADR that owns it |
