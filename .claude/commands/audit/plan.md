---
description: Build the remediation ledger from the completed audit reports
---

Build `docs/audit/0-remediation-ledger.md` from the pass reports in `docs/audit/`. Run this once,
after the programme's final pass, in a fresh session.

**Steps:**

1. Read `docs/_auditing/README.md` (the lifecycle and the artifacts), `docs/_auditing/ledger-template.md`
   in full, and `docs/_auditing/lessons.md` §7–8 (ledger failure modes, and wave-ordering
   constraints).
2. Inventory the reports: read each report's **summary table and verdict/fix-priority sections
   only** — never a whole report. Build the source-reports table from them.
3. Collect Wave 0 material: every cross-surface question the reports filed, every owner decision
   they flagged, and every finding that contradicts a ratified decision (check
   `docs/_decisions/README.md` — such findings become "confirm or supersede the ADR" entries, never
   fix rows).
4. Build the cross-report overlap map by scanning the reports' finding IDs and file references for
   the same underlying defect under different lenses. These become fix-once rows.
5. Build the **guardrail backlog** (Part 1b) by merging every report's "controls that would prevent
   recurrence" list and deduplicating it, and the **failure-mode register carry-over** (Part 1c) from
   the risk pass's register plus every pass's risk-register coverage statement. Every `NOT COVERED`
   hazard becomes a ledger row, an accepted risk with the owner's reasoning, or a roadmap item —
   never nothing.
6. Assign every finding to a wave. Order by dependency, not severity (the template lists the proven
   ordering constraints). **Schedule guardrails as early as their dependencies allow** — a control
   in Wave 1 catches mistakes made in every later wave, the same control last catches nothing. Use
   as many waves as the structure needs; split any wave whose PR would be unreviewable. Derive each
   wave's Part 6 `{SECTIONS}` list mechanically from its rows' `§` column.
7. Write the ledger from the template, then create `docs/audit/wave-reports.md` as a stub: the
   per-wave report template (derived from the ledger template's Part 4.5 requirements) plus an empty
   section list, one heading per planned wave.
8. Present the owner: the wave plan as a short table (wave | theme | row count | depends on), the
   guardrail backlog with the wave each control lands in, and the full Wave 0 question batch (each
   with evidence and a recommendation). Then stop. **Wave 0's answers must be recorded in the ledger
   before any `/audit:wave` runs.**

Do not change any source files. The ledger and wave-reports stub are the only writes.
