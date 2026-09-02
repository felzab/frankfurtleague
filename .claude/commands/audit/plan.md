---
description: Build the remediation ledger from the completed audit reports
---

Build `docs/audit/programme/0-remediation-ledger.md` from the pass reports in
`docs/audit/programme/`. Run this once, after the programme's final pass, in a fresh session.

Change no source file. The ledger and the wave-reports stub are the only writes.

**Preconditions — check first, report what fails, stop where stated:**

| Check                                               | If it fails                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| The ledger does not already exist                   | **Stop.** Rebuilding it destroys recorded state. Offer `/audit:status` instead                                            |
| Every report in `programme/` has a complete verdict | **Stop.** Name the incomplete ones                                                                                        |
| The programme's intended passes have all run        | List the missing ones and **ask** whether to plan without them, rather than deciding                                      |
| The risk and crosscut reports both exist            | Warn: no hazard coverage from the risk pass, or no seam coverage. Say what will be thin                                   |
| Report `Audited at` SHAs are close to `HEAD`        | Report the drift per report. A report far behind `HEAD` needs its findings verified harder, and the wave rows must say so |

**Steps:**

1. **Read `docs/_auditing/lessons.md` in full**, before anything else.
2. Read `docs/_auditing/programme.md` and `docs/_auditing/ledger-template.md` in full.
3. Inventory the reports: read each report's **summary table and verdict or fix-priority sections
   only** — never a whole report. Build the source-reports table from them.
4. Collect Wave 0 material: every cross-surface question the reports filed, every owner decision they
   flagged, and every finding that contradicts a ratified decision (check CLAUDE.md §7 and the
   `.claude/rules/` files it indexes — such findings become "confirm or overturn the decision"
   entries, never fix rows).
5. Build the cross-report overlap map by scanning the reports' finding IDs and file references for
   the same underlying defect under different lenses. These become fix-once rows.
6. Build the **guardrail backlog** (Part 1b) by merging every report's "controls that would prevent
   recurrence" list and deduplicating it. Then take the risk report's coverage map together with
   every pass's coverage statement: a hazard no pass covered becomes a ledger row, an accepted risk
   with the reasoning recorded, or a roadmap item — never nothing.
7. Assign every finding to a wave, ordered by dependency rather than severity (the template lists the
   proven ordering constraints). **Schedule guardrails as early as their dependencies allow.** Use as
   many waves as the structure needs; split any wave whose pull request would be unreviewable. Derive
   each wave's Part 6 `{SECTIONS}` list mechanically from its rows' `§` column.
8. Write the ledger from the template, then create `docs/audit/programme/wave-reports.md` as a stub:
   the per-wave report shape (`docs/_auditing/programme.md` §4.5) plus an empty section list, one
   heading per planned wave.
9. Present the owner: the wave plan as a short table (wave | theme | row count | depends on), the
   guardrail backlog with the wave each control lands in, and the full Wave 0 question batch (each
   with evidence and a recommendation). Then stop. **Wave 0's answers must be recorded in the ledger
   before any `/audit:wave` runs.**
