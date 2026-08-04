<!--
TEMPLATE — copy to docs/<surface>/spec.md and fill in. Delete this comment block.
Guidance: ../3-out-of-code.md, "Layer 2 — spec sheets"

A spec sheet is the REFERENCE for one surface: what the contract is, and whether it is still true.
Tables, looked up. Not read through — that is the overview's job.

THE SPINE, which every spec sheet follows so a reader can move between them:

  header            Verified against, Scope
  1..n  contract    as many numbered sections as the surface needs
  n+1   Invariants  numbered I1, I2, … and never renumbered
  n+2   Violation → remedy
  n+3   Known-open

Contract sections are free — one surface needs endpoints and error codes, another needs routing and
the verification gate. The last three are fixed, in that order, and are what make separate spec
sheets feel like one document.

TWO NON-NEGOTIABLES:
  1. Every claim carries an ANCHORED citation — `path/to/file.ts :: symbolName`, or an ADR number.
     NEVER a line number: it is wrong after any edit above it and nothing detects that (P6).
  2. Invariant numbers are permanent. A retired invariant keeps its number so a code comment citing
     it never silently points at a different rule.

Accuracy over volume. Where something cannot be verified, say so rather than writing plausible prose.
-->

# \<Surface\> — spec

**Verified against:** `<sha>`, `<date>`
**Scope:** \<the directories and files this covers\>

## 1. \<Contract section\>

What this surface exposes. Tables, not prose — endpoints, parameters, exports, configuration.

| Name | Type | Default | Notes                                          |
| ---- | ---- | ------- | ---------------------------------------------- |
|      |      |         | Cite the decision where a value is non-obvious |

\<Add as many numbered contract sections as the surface needs, then continue the numbering below.\>

## 2. Invariants

**All four columns, every row.** An invariant with no stated failure mode is a preference rather than
a constraint, and the last column is what tells a reader whether breaking it fails loudly or quietly.

| #   | Invariant | Enforced by                                              | Breaks how                  |
| --- | --------- | -------------------------------------------------------- | --------------------------- |
| I1  |           | `path/file.ts :: symbol`, or "review (a CLAUDE.md rule)" | What goes wrong, concretely |

## 3. Violation → remedy

The symptom-first index, written for the reader who has the bug and does not yet know the cause.

**Include the symptoms that turn out to be correct behaviour.** A row reading "working as intended,
see I4" saves more time than any other kind, because the reader hitting it is about to file a bug or
write a fix for something deliberate.

| Symptom | Cause | Remedy                         |
| ------- | ----- | ------------------------------ |
|         |       | Reference the invariant number |

## 4. Known-open

Accepted gaps and unresolved items, each with whatever owns it. Being explicit here is what stops a
known limitation reading like an oversight, and stops the next reader "fixing" it.

| #   | Item | State                                                    |
| --- | ---- | -------------------------------------------------------- |
|     |      | Open / Accepted, plus the roadmap id or ADR that owns it |
