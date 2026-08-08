---
description: Audit and fix the branch's documentation slice before its pull request — /docs:audit-pr
---

Audit the documentation this branch touches — and only that — against `docs/_standard/`, and fix
what fails **on the branch itself**. Arguments: `$ARGUMENTS` — this command takes none; the branch
in the working tree is the scope.

This is the pre-merge slice, and it inverts `/docs:audit`'s split on purpose: the sweep reads the
whole corpus and only reports, because its findings are a record to preserve — the slice repairs
in place, because nothing here is merged yet and the only artifact worth producing is a branch
whose pull request is right. On `main`, or with nothing changed since the fork point, say there is
no slice and stop.

## Steps

1. **Derive the scope from the branch, never from memory.** The changed set is the tracked diff
   from `git merge-base origin/main HEAD` to the working tree, **plus untracked files** — an
   unpushed edit and a file git has never seen are both about to be in the pull request.

2. **Build the documentation subset.** Three parts, and nothing else:

   - every changed `.md`, read in full;
   - the comments, module headers and docstrings of every changed source file — shell, YAML,
     Dockerfiles and workflows included;
   - every stamped page whose citations name a changed file. That is exactly the set the gate's
     `branch-impact` check holds the branch to, so take it from the check rather than re-deriving
     it: `python scripts/check_docs.py` names each such page for as long as its restamp is
     missing.

3. **Load the standard**: `docs/_standard/rules-index.md`, then the chapter for each shape in the
   subset — `docs/_standard/chapters/2-in-code.md` for source comments,
   `docs/_standard/chapters/3-corpus.md` for `/docs` pages,
   `docs/_standard/chapters/4-decisions.md` for ADRs, and
   `docs/_standard/chapters/5-currency.md` wherever anything is stamped.

4. **Audit the subset with the check classes C1–C9** from the audit-mode table in
   [`audit.md`](audit.md) — that table has one home, so apply it from there rather than from a
   copy. The slice adds the one question a whole-corpus sweep cannot ask: does any document in the
   subset still describe what the code did **before** this branch changed it (CUR-2)? A changed
   behaviour whose page reads as if the branch never happened is the finding this command exists
   to catch.

5. **Fix in place, on this branch.** Findings are repaired directly — edit the text to state the
   final position, delete a claim that cannot be verified, and keep each fix no longer than what
   it replaces. Restamp every page verified in the process, in CUR-3's exact shape, and restamp
   the pages `branch-impact` names after re-verifying them against the branch's state (CUR-4) —
   never blind.

6. **Close with the gate**, reporting its actual exit code:

   ```bash
   ./scripts/verify.sh --docs
   ```

   plus `pnpm format` from `fl_frontend/` if any markdown or source comment changed — commit what
   it rewrites. `--docs` is the floor for the slice; if the branch touched more than documentation
   the gate refuses that scope and names the one it needs (ADR-0037) — rerun at that scope. The
   fixes then ride the branch's normal close per `docs/workflows/README.md`; this command opens no
   pull request of its own.
