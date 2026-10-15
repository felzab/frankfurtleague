# Ending the session

Run once, in this order, when what remains is the last wave plus this list.

1. Land the last wave. The audit its last landing dispatches and the fix the cycle ends on are a
   whole round the ending still holds.
2. Re-run the start's enumeration and tick every slice to a landed commit. Close every findings-ledger
   row (`ledger.py open --unclosed` exits 0; a refusal prints no row either) and every
   expected-red row. Close the gaps unused reserved invariant ids left, listing the unused ones from
   the register's "Invariant ids reserved" column with `git grep -nw` on each.
   `scripts/checks/check_docs.py` takes a branch's new rows as one run from one past the highest id
   at the fork, so each id above a gap moves down into it, everywhere `git grep -nw` lists it, code
   comments, tests and a generated document included, the last regenerated rather than edited,
   until `check_docs.py` exits 0. An id of the same width re-pads no table.
3. Run `./scripts/gate/verify.sh`, every scope, over a tree that has stopped moving. The branch is
   stable only once the last fix is committed, the gate is green, no live agent can still return a
   finding, and every worktree row is closed.
4. Replace the draft pull request's body once (`.claude/CLAUDE.md` §2), naming every document a
   merge regenerated, which a merge commit's own message does not say. Start the handoff in the same
   action: the checks run while the handoff is written, audited and fixed.
5. List the owner's deploy steps for this branch as one walkthrough, in the order they are run.
6. Write the handoff ([handoff-template.md](handoff-template.md)) and the next session's starter,
   `START-<session>.md`, once each, from the register. The pull request's link and its checks'
   conclusions are the only facts filled in as they land. Before recording that the owner's process
   lacks a step, check whether the step exists and the session skipped it.
7. Have the handoff audited by an agent that saw none of the work, then fix what it finds.
