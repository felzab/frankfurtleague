---
description: Work one open item to a conclusion — /roadmap:start <ID>
---

Work the item named by the arguments to a conclusion: `$ARGUMENTS`

The **first token** is the item ID, taken from the index table of the ranked page that holds it —
`docs/_roadmap/open-items.md` or `docs/_roadmap/tooling-items.md`. Anything after it is context
carried forward by the session that unblocked this item — sort it in step 1 before acting on any of
it.

**One item per session, and this command never starts another.** A ranked page is an ordering, not a
batch: a session that opens several items builds the later fixes on decisions the earlier ones have
not taken yet.

## Preconditions

Read `docs/_roadmap/open-items.md`, `docs/_roadmap/tooling-items.md`, `docs/_roadmap/closed-items.md`
and `docs/_roadmap/protocol.md` in full, find the entry, and work down this table. **The first row
that matches decides.**

| The item                                                            | Do                                                                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Is in no roadmap file                                               | **Stop.** List the ids from both ranked pages' index tables                                                                       |
| Is a row in `docs/_roadmap/closed-items.md`                         | **Stop.** Report the row and its `Closed in` commit — that commit's body is the record. A regression opens a new id, not this one |
| Carries `Status: Closed`                                            | The closing commit already landed. Run **only** the removal commit — step 5's commit 2, then step 6                               |
| Carries `Status: Standing`                                          | **Stop.** Report the entry's own trigger and ask whether it has fired                                                             |
| Carries `Status: Blocked`, or a `Depends on` naming a present entry | **Ask before starting.** If the blocker was decided out of band, ask for that decision — it is input to this item                 |
| Has a `Path` line naming an audit pass that owns it                 | **Ask** whether this session does the work, or the pass does                                                                      |

**Before the first write:** a clean tree, `main` current with `origin/main`, and a branch named for
the change (CLAUDE.md §2).

## Steps

1. **Sort the carried-forward context, and say back which sentence is which.**

   | Kind                          | Looks like                                                                        | Treatment                                                                                                                       |
   | ----------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
   | **A decision**                | "The first knockout round is always group-seeded"                                 | Fact. Nobody here can re-derive it and no file records it — restate it and build on it                                          |
   | **A description of the tree** | "The backend is green", "one file is the only compile blocker", "closed in <sha>" | Claim. It was true when written and the tree has moved since. **Check the branch, whether it compiles, and every SHA it names** |

   A correction here costs one command; the same correction after the work is built on it costs the
   work.

2. **Decide the mode and say which one you are in before doing anything else.** Read down; the first
   row that matches the entry decides. An entry matching more than one row runs them in that order,
   and **never slides from one mode into the next without checking in** — the checkpoint is the point.

   | #   | The entry                                                                        | Mode          | Ends with                                              |
   | --- | -------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------ |
   | 1   | Names something it did not verify, or tells you to check something before acting | **Verify**    | A finding reported. **No fix.**                        |
   | 2   | Asks for recommendations rather than a change                                    | **Review**    | Recommendations; the owner decides                     |
   | 3   | Lists options, or says to present options or consult a source                    | **Consult**   | Options presented, owner picks, **then** you implement |
   | 4   | Carries `Status: Decided`, or describes work whose shape is agreed               | **Implement** | Code, verified, committed, pushed                      |

3. **Put what the entry says you need to the owner first**, before the work rather than after it — a
   resource to be provided, a convention to check before anything changes, options to choose
   between, a standing question to raise.

4. **Do the work**, closing per CLAUDE.md §2 and `docs/_git/spec.md`: the gate at the scope the
   change earns, its actual exit code reported, the draft pull request's link handed over, and the
   branch's `verify` run read to its conclusion. Read
   `docs/_auditing/lessons.md` before verifying anything at runtime and before closing out against
   the gate.

   **If the work proves larger than the entry describes, stop and say so** rather than shipping a
   reduced version of it under the entry's name.

5. **Conclude the item in two commits, never one** —
   [Closing an entry](../../../docs/_roadmap/protocol.md#2-closing-an-entry-two-commits-not-one)
   fixes what each commit holds and what the closed row carries. Both go in **one pull request**.
   What that page leaves to this one:

   - **A decision's destination is picked by how it fails**: a silent failure to a comment at the
     line it constrains (INC-9 caps it at 250 characters) or to a gate check, a loud one to a
     CLAUDE.md §7 row or the `.claude/rules/` file whose paths reach the session that could break
     it, a domain rule to the spec sheet's `## 2. Invariants`. **The argument goes in
     commit 1's body**, which `git blame` reaches from the constraint, and
     `scripts/checks/check_commits.py` refuses a commit with none.
   - **`git grep -n "<ID>"` enumerates every reference commit 1 must update**, which CLAUDE.md's
     same-commit rule requires. They live in an audit pass prompt under `docs/_auditing/prompts/`.
     A spec sheet's `## 4. Known-open` table names no roadmap id (OUT-4), and INC-6 keeps one out
     of a source comment, which carries the constraint itself.
   - **Commit 2 renumbers the index table and every `### <rank> ·` heading together**, leaving the
     page one run from 1 with no gap, and re-derives the `Status` of every row — reading each row's
     `Status` and `Depends on` together is what catches the rows nobody edited.
   - **Never copy the entry's reasoning into the closed row.** The row is a pointer; commit 1's body
     is the record.
   - **An item that ends partly done is not closed:** rewrite the entry to describe what is left and
     what was decided, leave its `Status` at `Open` or `Decided`, make one commit, and say plainly
     in the handover that the entry stayed.

6. **Verify the close before handing over.** Every one of these holds:

   | Check                                                       | How                                                                                                                                            |
   | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
   | `Closed` survives nowhere                                   | `git grep -n "Closed" -- docs/_roadmap/open-items.md docs/_roadmap/tooling-items.md` returns nothing but the status vocabulary that defines it |
   | The ID has left both ranked pages                           | `git grep -n "<ID>" -- docs/_roadmap/open-items.md docs/_roadmap/tooling-items.md` returns nothing                                             |
   | The ID has exactly one closed row                           | `git grep -n "<ID>" -- docs/_roadmap/closed-items.md`                                                                                          |
   | Ranks run from 1 with no gap, each heading matching its row | Read the index table against the `### <rank> ·` headings                                                                                       |
   | Commit 2 names commit 1                                     | `git log -2`                                                                                                                                   |
   | No reference to the ID is stale                             | `git grep -n "<ID>"` — every remaining hit is deliberate                                                                                       |

7. **Hand over.** State the mode you were in, what was concluded, whether the entry was deleted or
   rewritten, and which other entries' `Path` lines changed.

   Then, if this item unblocks another, give the next session's prompt as **one copy-pasteable block
   opening with the command line** — written against the repository as it stands **after** the
   removal commit, because the entry carrying the reasoning is gone by then:

   ```
   /roadmap:start <next-ID>

   Decisions carried from <this-ID> — facts, do not re-derive:
   - <the decision>

   Descriptions carried from <this-ID> — claims, check each before building on it:
   - <the claim>, checked by <how>

   <this-ID> does not achieve <the gap>. <entry-ID> closes it.

   Preconditions no session performs:
   - <the step>, checked by <how>
   ```

   Every block after the decisions is one a session that did good work still leaves out. A block
   listing only what the next item needs reads as though the next item were the last one. A
   precondition no session performs — a production data change, a value set by hand, a setting in a
   dashboard — sits outside every definition of done and outside the gate, so it can be skipped
   indefinitely: name each, and how to check whether it has happened. And say which of your own
   sentences are descriptions rather than decisions, because step 1 asks the next session to sort
   them and you are the one who knows.

   If nothing is unblocked, say which entries now sit at the top of that page instead.

## Scope

Anything outside the named item is out of scope. Something else found on the way: small and you are
there anyway — just do it; a question with real trade-offs — add an entry; decided but not
scheduled — tell the owner to open an issue.
