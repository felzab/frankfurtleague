---
description: Close a programme — write the final report, then clear the programme folder with the owner
---

Close the audit programme: produce the one artifact that outlives it, then retire the working
documents.

**Preconditions — check first, and stop with a report if any fails:**

| Check                                                                                              | Why it blocks the close                                                          |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Every ledger wave is closed — every row `[x]`, `[-]` or `[!]` with its reason, none `[ ]` or `[~]` | An open row deleted with the folder is a finding nobody ever sees again          |
| Every wave has its section in `wave-reports.md`                                                    | The final report is written from them                                            |
| The last wave's pull request is merged                                                             | Closing before the work lands writes an account of something that did not happen |
| Every Part 1c register hazard has a recorded outcome                                               | An uncovered hazard with no destination is lost at the delete                    |
| Every Part 1b guardrail is built, or has a row saying why not                                      | An unbuilt control is the work that makes the next programme smaller             |

**Steps:**

1. Read `docs/_auditing/final-report-template.md` in full, and the completed programme's ledger and
   wave reports (this is the one context where reading them whole is the job). Also read the most
   recent earlier report for this surface in `docs/_auditing/reports/`, if one exists — section 2
   compares against it.
2. Write `docs/_auditing/reports/<yyyy-mm>-<surface>.md` following the template. The completeness
   bar is the owner's: every major change fully described; every minor change in at least one
   bullet. The report must be self-contained (DS12) — no claim may depend on `docs/audit/programme/`
   surviving; cite code, ADRs and git history.
3. Harvest before deletion. Every still-open item — undecided questions, accepted deviations, `[!]`
   rows, guardrails not yet built, register hazards still uncovered — moves somewhere that survives,
   **with its analysis intact**, and the destination depends on whether publishing it is safe:
   - **Safe to publish** → `docs/roadmap/open-items.md` (tracked) or the report's "Left open".
   - **Actionable by an attacker if published** → `docs/audit/register.md`, which is gitignored and
     survives the close. The report names the area and points at the register, nothing more.

   Extract any newly ratified decision into `docs/_decisions/` first. An item whose reasoning lives
   only in `docs/audit/programme/` is lost the moment that folder goes.

4. Update `docs/_auditing/lessons.md` with this programme's new lessons — missteps, false
   positives, environment traps — each verified before it is written, and merged into the existing
   sections rather than appended as a new dump. Lessons are stated so that a reader who has never
   seen this programme understands them: no programme names, no wave numbers, no finding IDs.
5. Present the final report to the owner and ask for explicit confirmation before deleting anything.
   Only after a clear yes: delete **`docs/audit/programme/` and nothing else**. It is gitignored and
   untracked, so this is a plain filesystem delete with no commit involved and **nothing in it is
   recoverable afterwards** — which is why steps 2 to 4 must be genuinely complete first.

   **`docs/audit/register.md` stays.** It is the standing failure-mode register, it carries hazards
   that are still open, and the next programme on any surface refreshes it rather than rebuilding
   it. Deleting it throws away the owner-confirmed severities, which are the most expensive thing
   the programme produced.

6. Run the gate, commit the final report and any doc updates, push, and print the PR title and body
   for the owner. `--quick` is sufficient here **only because this step changes documentation
   only** — that is the single sanctioned exception to the full-gate rule. If anything under
   `fl_frontend/`, `fl_backend/`, `scripts/`, `nginx/` or `.github/` changed, run the full
   `./scripts/verify.sh`.
