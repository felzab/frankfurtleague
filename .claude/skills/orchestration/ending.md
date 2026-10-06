# Ending the session

Run once, in this order, when what remains is the last wave plus this list.

1. Land the last wave. The audit its last landing dispatches and the fix the cycle ends on are a
   whole round the ending still holds.
2. Re-run the start's enumeration and tick every slice to a landed commit. Close every findings-ledger
   row (`ledger.py open --unclosed` prints nothing) and every expected-red row. Renumber every `I_NEW_*`
   invariant placeholder once, as one rename across the tree: agents number a new spec-sheet
   invariant `I_NEW_<agent name>_<n>` so that parallel allocations cannot collide, and code comments,
   tests and generated documents cite it too. Each takes its real number everywhere
   `git grep -n I_NEW_` lists it, a generated document regenerated rather than edited, until that
   command prints nothing and `scripts/checks/check_docs.py` exits 0.
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
