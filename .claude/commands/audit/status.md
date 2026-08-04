---
description: Report programme state and resume interrupted audit or wave work
---

Reconstruct where the audit programme stands and resume whatever a dead session left unfinished.
This is the entry point after running out of tokens, a crash, or simply returning later.

Read-only until resuming; this command itself changes nothing.

**Steps:**

1. **Establish phase.** Check what exists:
   - `docs/audit/register.md` — does the standing register exist, and how far behind `HEAD` is its
     last-verified commit?
   - `docs/audit/programme/` — which pass reports are present. A report with a complete verdict is a
     finished pass; one without is a mid-pass casualty.
   - `docs/audit/programme/0-remediation-ledger.md` — does it exist, what does its `Wave 0 status:`
     line say, and which waves are fully closed versus carrying `[ ]` or `[~]` rows.
   - Branches: `git branch --list 'wave-*'`, plus `git log` and `git status` on the current one.

2. **Measure drift.** For each report, compare its `Audited at` SHA with `HEAD`
   (`git log --oneline <sha>..HEAD -- <surface path>`). Report the count per surface. **Drift is not
   a reason to discard a report** — it is a reason to verify its findings harder in the wave that
   acts on them, and to say so on those rows.

3. **Detect interrupted work:**
   - A report with a coverage ledger but no verdict → a pass died mid-run. Offer to resume it via the
     resume protocol in `docs/_auditing/prompts/_shared-protocol.md`: continue from the first check
     whose ledger row is unfilled, never redo completed checks.
   - A wave with `[~]` rows, unticked rows, or a branch ahead of `main` → a wave died mid-run.
     Reconcile the ledger against `git diff main...<branch>`: a `[~]` row means inspect the diff, the
     work may be partial; a ticked row must have its change in a commit. Report the reconciliation,
     then offer to continue via the wave prompt's resume check
     (`docs/_auditing/prompts/remediation-wave.md`).
   - Uncommitted changes anywhere → summarise them against the ledger before anything else. **Never
     discard or commit them blind.**

4. **Report** in one compact block: phase (passes / planning / wave N / close), per-pass and per-wave
   completion, drift per surface, exactly where interrupted work stopped, and **the single next
   action**.

5. **Resume only on the owner's confirmation** if the session is interactive. If the owner asked to
   resume in the invocation, proceed directly with the matching protocol.
