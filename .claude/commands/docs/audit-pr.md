---
description: Audit and fix the branch's documentation slice before its pull request — /docs:audit-pr
---

Audit the documentation this branch touches — and only that — against `docs/standard.md`, and fix what
fails **on the branch itself**. It takes no arguments (`$ARGUMENTS`): the branch in the working tree
is the scope.

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
     Dockerfiles and workflows included.

4. **Load the standard**: read `docs/standard.md` in full — it is one file, and every shape in the
   subset is governed from there.

5. **Audit the subset with the check classes** from [`audit.md`](audit.md#the-check-classes), applied
   from there rather than from a copy. The slice adds the one question a whole-corpus sweep cannot
   ask: does any document in the subset still describe what the code did **before** this branch
   changed it (CUR-2)? A changed behaviour whose page reads as if the branch never happened is the
   finding this command exists to catch.

6. **Fix in place, on this branch**, under [`audit.md`](audit.md#fix-mode) and the ground rules it
   carries for resolving a duplicate. Each fix is no longer than what it replaces. The slice adds:

   - **A defect that predates this branch and sits outside the subset goes to `/roadmap:add`**, not
     into the slice.

7. **Close with the gate**, reporting its actual exit code:

   ```bash
   ./scripts/gate/verify.sh --docs --format
   ```

   **One run, at the end.** `--docs --format` is the slice's floor, the formatter being what holds
   the prose and the comments this command rewrites; where the branch touched more than
   documentation the gate refuses that scope, names the one it needs, and the run is repeated there.

   Report **net lines, separating relocated from removed** ([`audit.md`](audit.md#fix-mode)). The
   fixes then ride the branch's normal close per `docs/_git/spec.md`; this command opens no pull
   request of its own.
