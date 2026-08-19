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
| Every hazard the risk pass reported as uncovered has a recorded outcome                            | An uncovered hazard with no destination is lost at the delete                    |
| Every Part 1b guardrail is built, or has a row saying why not                                      | An unbuilt control is the work that makes the next programme smaller             |

**Steps:**

1. **Read `docs/_auditing/lessons.md` in full**, before anything else. Step 5 merges this programme's
   lessons into it, and a merge written without reading the existing sections becomes the per-run
   dump that file exists to prevent.
2. Read `docs/_auditing/final-report-template.md` in full, and the completed programme's ledger and
   wave reports (this is the one context where reading them whole is the job). Also read the most
   recent earlier report for this surface in `docs/_auditing/reports/`, if one exists — section 2
   compares against it.
3. Write `docs/_auditing/reports/<yyyy-mm>-<surface>.md` following the template. The completeness bar
   is the owner's: every major change fully described; every minor change in at least one bullet. The
   report must be self-contained (COR-1) — no claim may depend on `docs/audit/programme/` surviving;
   cite code and git history. Report net lines changed across the programme, separating what
   was relocated from what was removed: a reshaping that moves content between files is not a
   reduction, and a diffstat that excludes new untracked files overstates one.
4. Harvest before deletion. Every still-open item — undecided questions, accepted deviations, `[!]`
   rows, guardrails not yet built, hazards still uncovered — moves somewhere that survives, **with
   its analysis intact**, and the destination depends on whether publishing it is safe:
   - **Safe to publish** → the tracked roadmap: `docs/_roadmap/open-items.md` or
     `docs/_roadmap/tooling-items.md`, whichever `docs/_roadmap/protocol.md` names — or the report's
     "Left open".
   - **Actionable by an attacker if published** → a private security advisory on this repository,
     the channel `SECURITY.md` names. The report gives the area and says it is tracked there,
     nothing more.

   Record any newly ratified decision first, in the place it will be read — the destination picked
   by how it fails: a comment at the line it constrains, a CLAUDE.md §7 row, or the spec sheet's
   `## 2. Invariants` — with the argument in the closing commit's body. An item whose reasoning
   lives only in `docs/audit/programme/` is lost the moment that folder goes.

5. Update `docs/_auditing/lessons.md` with this programme's new lessons — missteps, false positives,
   environment traps — each verified before it is written, and merged into the existing sections
   rather than appended as a new dump. Lessons are stated so that a reader who has never seen this
   programme understands them: no programme names, no wave numbers, no finding IDs.
6. Present the final report to the owner and ask for explicit confirmation before anything is deleted.
   **The delete is the owner's**, on a clear yes: `rm -rf docs/audit/programme` from the repository
   root, that folder and nothing else. It is gitignored and untracked, so this is a plain filesystem
   delete with no commit involved and **nothing in it is recoverable afterwards**, which is why steps
   3 to 5 must be genuinely complete first and why the close's one irreversible act belongs to the
   person who confirmed it. `.claude/hooks/guard-branch-bash.sh` draws the same line from its own
   side: on `main`, where a resumed close sits once the last wave has merged, a session may write
   into a gitignored path and may not remove one. Confirm the folder is gone before step 7. Anything
   else under `docs/audit/` belongs to no programme's lifecycle and stays.

7. Run the gate at the scope CLAUDE.md's gate section names for what changed, commit the final report
   and any doc updates, push, open the draft pull request and print its link. A documentation-only
   close takes `--docs` plus `pnpm format` from `fl_frontend/`.
