---
description: Close a programme — write the final report, then clear the programme folder with the owner
---

Close the audit programme: produce the one artifact that outlives it, then retire the working
documents.

**Stop and report if any of these is not true:**

- Every ledger row is `[x]`, `[-]` or `[!]` with its reason — an open row deleted with the folder is
  a finding nobody sees again.
- Every wave has its section in `wave-reports.md`; the final report is written from them.
- The last wave's pull request is merged.
- Every hazard the risk pass reported as uncovered has a recorded outcome.
- Every Part 1b guardrail is built, or has a row saying why not.

**Steps:**

1. **Read `docs/_auditing/lessons.md` in full**, before anything else. Step 5 merges into it.
2. Read `docs/_auditing/final-report-template.md`, the completed ledger and the wave reports in full
   — this is the one context where reading them whole is the job — plus the most recent earlier
   report for this surface in `docs/audit/`, which section 2 compares against.
3. Write `docs/audit/<yyyy-mm>-<surface>.md` following the template. Every major change fully
   described, every minor change in at least one bullet. The report must be self-contained (COR-1):
   cite code and git history, never something `docs/audit/programme/` has to survive for. Report net
   lines changed across the programme, separating relocated from removed.
4. Harvest before deletion (`docs/_auditing/programme.md` §1.5). Each still-open item — an undecided
   question, an accepted deviation, an `[!]` row, an unbuilt guardrail, an uncovered hazard — moves
   somewhere that survives **with its analysis intact**, and the destination depends on whether
   publishing it is safe:
   - **Safe to publish** → the ranked page `docs/_roadmap/protocol.md` names, or the report's
     "Left open".
   - **Actionable by an attacker if published** → a private security advisory on this repository,
     the channel `SECURITY.md` names. The report gives the area and says it is tracked there,
     nothing more.

   Record any newly ratified decision first, in the place it will be read — a comment at the line it
   constrains, a CLAUDE.md §7 row, or the spec sheet's `## 2. Invariants` — with the argument in the
   closing commit's body.

5. Merge this programme's new lessons into the existing sections of `docs/_auditing/lessons.md`,
   each verified before it is written, and each stated for a reader who has never seen this
   programme: no programme names, no wave numbers, no finding IDs.
6. Present the final report to the owner and ask for explicit confirmation before anything is
   deleted. **The delete is the owner's**, on a clear yes: `rm -rf docs/audit/programme` from the
   repository root, that folder and nothing else. Nothing in it is recoverable
   (`docs/_auditing/programme.md` §2), which is why steps 3 to 5 must be genuinely complete first;
   `.claude/hooks/guard-branch-bash.sh` refuses that removal from an assistant session on `main`,
   which is where a resumed close sits once the last wave has merged — another reason the delete is
   run by hand. Confirm the folder is gone before step 7. Anything else
   under `docs/audit/` belongs to no programme's lifecycle and stays.
7. Run the gate at the scope CLAUDE.md's gate section names for what changed, commit the final
   report and any doc updates, push, open the draft pull request, print its link, and name the
   conclusion of the branch's `verify` run.
