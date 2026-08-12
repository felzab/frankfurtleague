---
description: Audit and fix the branch's documentation slice before its pull request — /docs:audit-pr
---

Audit the documentation this branch touches — and only that — against `docs/_standard/`, and fix what
fails **on the branch itself**. Arguments: `$ARGUMENTS` — this command takes none; the branch in the
working tree is the scope.

This is the pre-merge slice, and it inverts `/docs:audit`'s split: the sweep reports and this command
repairs in place. On `main`, or with nothing changed since the fork point, say there is no slice and
stop.

**Every rule binding `/docs:audit`'s modes binds this one**:
[`audit.md`](audit.md#rules-for-either-mode).

## Steps

1. **Read `docs/_auditing/lessons.md` in full.** Its rule that a finding is a claim, and its rule
   that a report states what it did not read, bind this command directly.

2. **Derive the scope from the branch, never from memory.** The changed set is the tracked diff from
   `git merge-base origin/main HEAD` to the working tree, **plus untracked files** — an unpushed edit
   and a file git has never seen alike land in the pull request.

3. **Build the documentation subset** from exactly these, and nothing else:

   - every changed `.md`, read in full;
   - the comments, module headers and docstrings of every changed source file — shell, YAML,
     Dockerfiles and workflows included;
   - every stamped page whose citations name a changed file. `python scripts/check_docs.py` names
     each such page for as long as its restamp is missing, so take the set from the check. A
     branch-scoped check is the right source here **because the scope is the branch**; it is never a
     worklist for anything older.

4. **Load the standard**: `docs/_standard/rules-index.md`, then the chapter for each shape in the
   subset — `docs/_standard/chapters/2-in-code.md` for source comments,
   `docs/_standard/chapters/3-corpus.md` for `/docs` pages,
   `docs/_standard/chapters/4-decisions.md` for ADRs, and
   `docs/_standard/chapters/5-currency.md` wherever anything is stamped.

5. **Audit the subset with the check classes** from [`audit.md`](audit.md#the-check-classes), applied from there rather
   than from a copy. The slice adds the one question a whole-corpus sweep cannot ask: does any
   document in the subset still describe what the code did **before** this branch changed it
   (CUR-2)? A changed behaviour whose page reads as if the branch never happened is the finding this
   command exists to catch.

6. **Fix in place, on this branch**, under [`audit.md`](audit.md#fix-mode) and the ground rules it
   carries for resolving a duplicate. Each fix is no longer than what it replaces. The slice adds:

   - **Restamp only after the page's claims are true.** Fix what is false first, never restamp to
     clear a gate finding, and re-verify a page named by the branch-impact check against the
     branch's state before moving its stamp (CUR-3, CUR-4).
   - **A defect that predates this branch and sits outside the subset goes to `/roadmap:add`**, not
     into the slice.

7. **Close with the gate**, reporting its actual exit code:

   ```bash
   ./scripts/verify.sh --docs --format
   ```

   **One run, at the end.** `--docs --format` is the floor for the slice, the formatter being what
   holds the prose and the comments this command rewrites; where the branch touched more than
   documentation the gate refuses that scope and names the one it needs (ADR-0030), and the run is
   repeated at that scope.

   Report **net lines, separating relocated from removed** — a reshaping that moves content between
   files is not a reduction, and a diffstat that excludes new untracked files overstates one. The
   fixes then ride the branch's normal close per `docs/_git/spec.md`; this command opens no pull
   request of its own.
