---
description: Close a programme — write the final report, then clear docs/audit/ with the owner
---

Close the audit programme: produce the one artifact that outlives it, then retire the working
documents.

**Preconditions — verify, and stop with a report if any fails:** every ledger wave is closed (every
row `[x]`, `[-]` or `[!]` with reasons; no `[ ]`/`[~]`), every wave has its section in
`wave-reports.md`, and the last wave's PR is merged.

**Steps:**

1. Read `docs/_auditing/final-report-template.md` in full, and the completed programme's ledger and
   wave reports (this is the one context where reading them whole is the job).
2. Write `docs/_auditing/reports/<yyyy-mm>-<surface>.md` following the template. The completeness
   bar is the owner's: every major change fully described; every minor change in at least one
   bullet. The report must be self-contained (DS12) — no claim may depend on `docs/audit/`
   surviving; cite code, ADRs and git history.
3. Harvest before deletion: move any still-open item (undecided questions, accepted deviations,
   `[!]` rows) into `docs/roadmap/open-items.md` or the report's "Left open" section **with its
   analysis intact** — an open item whose reasoning lives only in `docs/audit/` is lost when it is
   deleted. Extract any newly ratified decision into `docs/_decisions/` first.
4. Update `docs/_auditing/lessons.md` with this programme's new lessons — missteps, false
   positives, environment traps — each verified before it is written, and merged into the existing
   sections rather than appended as a new dump. Lessons are stated so that a reader who has never
   seen this programme understands them: no programme names, no wave numbers, no finding IDs.
5. Present the final report to the owner and ask for explicit confirmation before deleting
   anything. Only after a clear yes: delete the local `docs/audit/` directory — it is gitignored
   and untracked, so this is a plain filesystem delete with no commit involved, and **nothing in it
   is recoverable afterwards**; that is why steps 2–4 must be genuinely complete first.
6. Run `./scripts/verify.sh --quick` (formatting drift in the committed docs would fail the gate),
   commit the final report and any doc updates, push, and print the PR title and body for the
   owner.
