---
description: Report programme state and resume interrupted audit or wave work
---

Reconstruct where the audit programme stands and resume whatever a dead session left unfinished.
This is the entry point after running out of tokens, a crash, or simply returning later.

**Steps:**

1. **Establish phase.** Check what exists: `docs/audit/` reports (which passes are done — a report
   with a verdict is complete, one without is a mid-pass casualty), the remediation ledger (does it
   exist; which waves are fully `[x]`, which have `[ ]`/`[~]` rows), and open branches
   (`git branch --list 'wave-*'` plus `git log`/`git status` on the current one).
2. **Detect interrupted work:**
   - A report file with a coverage ledger but no verdict → a pass died mid-run. Offer to resume it
     via the resume protocol in `docs/_auditing/prompts/_shared-protocol.md` (continue from the
     first check whose ledger row is unfilled; never redo completed checks).
   - A wave with `[~]` rows, unticked rows, or a branch ahead of `main` → a wave died mid-run.
     Reconcile the ledger against `git diff main...<branch>`: a `[~]` row means inspect the diff
     (work may be partial); a ticked row must have its change in a commit. Report the
     reconciliation, then offer to continue via the wave prompt's resume check
     (`docs/_auditing/prompts/remediation-wave.md`).
   - Uncommitted changes anywhere → summarise them against the ledger before anything else; never
     discard or commit them blind.
3. **Report** in one compact block: phase (passes / planning / wave N / close), per-pass and
   per-wave completion, exactly where interrupted work stopped, and the single next action.
4. **Resume only on the owner's confirmation** if the session is interactive; if the owner asked to
   resume in the invocation, proceed directly with the matching protocol.

Read-only until resuming; this command itself changes nothing.
