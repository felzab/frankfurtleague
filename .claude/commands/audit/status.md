---
description: Report programme state and resume interrupted audit or wave work
---

Reconstruct where the audit programme stands and resume whatever a dead session left unfinished —
the entry point after running out of tokens, a crash, or simply returning later.

Read-only until resuming; this command itself changes nothing.

**Steps:**

1. **Read `docs/_auditing/lessons.md` in full**, before anything else. Resuming means acting on work
   another session left behind, which is where its traps bite hardest.

2. **Read `docs/audit/programme/state.md` first.** Its last entry names the session that stopped and
   what it was doing when it did — the answer this command exists to produce, and cheaper and more
   exact than any inference from the tree. **Trust it only as far as `docs/_auditing/programme.md`
   §3 allows**: a stale or missing file is not the record for what happened after it. Say which case
   you are in, and cover what it does not answer with step 3.

3. **Establish phase from the tree**, for everything step 2 did not answer:
   - `docs/audit/programme/` — which pass reports are present. A report with a complete verdict is a
     finished pass; one without is a mid-pass casualty.
   - `docs/audit/programme/0-remediation-ledger.md` — does it exist, what does its `Wave 0 status:`
     line say, and which waves are fully closed versus carrying `[ ]` or `[~]` rows.
   - Branches: `git branch --list 'wave-*'`, plus `git log` and `git status` on the current one.

4. **Measure drift.** For each report, compare its `Audited at` SHA with `HEAD`
   (`git log --oneline <sha>..HEAD -- <surface path>`). Report the count per surface. **Drift is not
   a reason to discard a report** — it is a reason to verify its findings harder in the wave that
   acts on them, and to say so on those rows.

5. **Detect interrupted work:**
   - A report with a coverage ledger but no verdict → a pass died mid-run. Offer to resume it via the
     resume protocol in `docs/_auditing/prompts/_shared-protocol.md`: continue from the first check
     whose ledger row is unfilled, never redo completed checks.
   - A wave with `[~]` rows, unticked rows, or a branch ahead of `main` → a wave died mid-run.
     Reconcile the ledger against `git diff main...<branch>` — a `[~]` row means inspect the diff,
     and a ticked row must have its change in a commit. Report the reconciliation, then offer to
     continue via the resume check in `docs/_auditing/prompts/remediation-wave.md`.
   - Uncommitted changes anywhere → summarise them against the ledger before anything else. **Never
     discard or commit them blind.**

6. **Report** in one compact block: phase (passes / planning / wave N / close), per-pass and per-wave
   completion, drift per surface, exactly where interrupted work stopped, and **the single next
   action**. Say for each conclusion whether it came from `state.md` or from the tree, and where the
   two disagree, say that too and treat the tree as the fact.

7. **Resume only on the owner's confirmation** if the session is interactive. Where the owner asked
   to resume in the invocation, proceed directly with the matching protocol.

8. **Append what you did to `state.md`** before handing back, where the session resumed anything.
   A resume that leaves no entry is the next crash's blind spot.
