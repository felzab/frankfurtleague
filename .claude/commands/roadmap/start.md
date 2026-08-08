---
description: Work one open item to a conclusion — /roadmap:start <ID>, e.g. /roadmap:start F4
---

Work the open item named by the arguments: `$ARGUMENTS` (one item ID — e.g. `F4`, `DB-1`, `LOG-1`).

**One item per session, and this command never starts a second one.** The tiers in
`docs/roadmap/open-items.md` are an ordering, not a batch: tier 1 alone is M + M + XL. A session
that opens three items builds the later fixes on decisions the earlier ones have not made yet.

## Steps

1. **Resolve the item.** The item ID is the **first token** of the arguments; anything after it is
   carried-forward context from the previous session — what this item depends on and cannot read,
   because the entry that held it has been deleted.

   **Two kinds of sentence are in there and they get different treatment. Sort them before acting on
   either, and say back which is which.**

   - **A decision is fact.** "The owner ruled that the first knockout round is always group-seeded."
     Nobody in this session can re-derive it and no file records it. Take it, restate it, build on it.
   - **A description of the tree is a claim.** "The backend is done and green", "one file is the only
     compile blocker", "closed in `abc1234`". Each was true when it was written, and the tree has
     moved since — a handover sits in someone's clipboard while other work merges. **Check the branch,
     whether it compiles, and any SHA it names before building on any of it**, and report what you
     found. A correction here costs one command; the same correction after the work is built on it
     costs the work.

   Read `docs/roadmap/open-items.md` in full and find the entry whose ID matches. If the ID does not
   exist, check `docs/roadmap/closed-items.md` before saying so — a closed id is not a typo, and the
   answer is "that was closed in `<sha>`, here is what it produced" rather than a list. Otherwise list
   the IDs from the index table and stop.

2. **Check the path.** The entry's **Path** line names what it depends on. If a blocker is still in
   the file, say so and ask whether to proceed anyway — the owner may have decided it out of band,
   in which case ask for the decision before starting, because it is input to this item.

3. **Decide the mode from the entry, and say which one you are in** before doing anything else:

   | Mode          | Looks like                                             | Ends with                                              |
   | ------------- | ------------------------------------------------------ | ------------------------------------------------------ |
   | **Verify**    | The entry states it is unverified, or gives a "check"  | A finding reported to the owner. **No fix yet.**       |
   | **Review**    | The entry asks for recommendations, not a change       | Recommendations, then the owner decides                |
   | **Consult**   | The entry says to present options or check a source    | Options presented, owner picks, **then** you implement |
   | **Implement** | The entry describes work whose shape is already agreed | Code, verified, committed, pushed                      |

   An entry can be two modes in sequence (verify → implement). Do **not** slide from one into the
   next without checking in — the checkpoint is the point.

4. **Ask for what the entry says you need.** Entries name their own dependencies on the owner —
   a resource to be provided, a convention to be checked before anything changes, options to choose
   between, a standing question to raise. Read the entry for these and put them **at the start**, not
   after the work is done.

5. **Do the work**, following the whole cycle in `docs/workflows/README.md` — branch first (a hook
   enforces it), commit with a real body, `./scripts/verify.sh` before pushing, hand over the PR
   link, title and body. Never open or merge the PR.

6. **Conclude the item, which means removing it — in TWO commits, never one.** An item that is done
   is not open, so the entry leaves `docs/roadmap/open-items.md`; git history keeps the analysis, and
   a one-line row in `docs/roadmap/closed-items.md` keeps the pointer to it. Deleting an entry is not
   optional cleanup, and leaving it is how the file stops being trustworthy.

   **The two-commit protocol is mandatory.** Full rationale:
   [Closing an entry](../../../docs/roadmap/README.md#closing-an-entry-two-commits-not-one). Both
   commits go in **one pull request**.

   **Commit 1 — the closing commit.** The work itself, plus:

   - **Write the ADR if a decision was taken**, per `docs/_standard/chapters/4-decisions.md`. A decision that
     exists only in a commit body is one nobody will find. Add its row to `docs/_decisions/README.md`.
   - **Search the whole repo for the ID**, not just `open-items.md`: the spec sheets, the glossary,
     the audit prompts and module headers all reference these IDs (`docs/backend/spec.md` cites F4 as
     invariant I1, for instance). Update every reference here — CLAUDE.md's same-commit rule requires it.
   - In `open-items.md`, set the entry's **`Status` to `Closed`** in the "path at a glance" table and
     add a short block to the entry naming what concluded it: the ADR numbers, and where each finding
     that was _not_ a decision was rehomed. **Leave the entry in place.**

   **Commit 2 — the removal commit.** Touches `open-items.md` and `closed-items.md`, nothing else:

   - **Delete the entry** and its heading.
   - **Delete its row** from the table, and **renumber** the rows below it. The ranks are positional,
     so a stale number is worse than none.
   - **Add one row to `docs/roadmap/closed-items.md`** — the next permanent `#`, the id, one past-tense
     line, surfaces, effort and what it depended on, and **commit 1's short SHA linked to GitHub** in
     the `Closed in` column. Never copy the entry's reasoning across: the row is a pointer and the
     commit body is the record. Add a bullet under _What each one produced_ only if it left an ADR or
     opened a new entry. The closed file's numbers are permanent — never renumber them.
   - **Insert any new entries** the work produced, with their own `Status`.
   - **Fix every `Path` line that named it.** An entry that said "blocked by F4" must not still say
     so once F4 is gone — replace it with the decision F4 reached, stated as a fact.
   - **Re-derive the `Status` of EVERY row in the table, not just the ones you worked on.** Statuses are interdependent: `Blocked` is a claim about another entry, so removing
     one or landing a decision silently changes rows nobody edited. Walk the whole table. The
     derivation, first match wins: concluded but still present → `Closed`; anything in its
     `Depends on` still in the file → `Blocked`; a caution or a recorded trigger → `Standing`; an ADR
     settles it and only the work remains → `Decided`; otherwise → `Open`. Read `Status` and
     `Depends on` together — a row where they disagree is the bug this catches.
   - **The commit body names commit 1's SHA**, because a commit cannot cite its own hash and commit 1
     is the one worth pointing at.

   **`Closed` must never survive past commit 2.** An entry marked finished while still ranked in the
   table is worse than either state alone.

   If the item ends **partly** done, do not close it. Rewrite the entry to describe what is left and
   what was decided, leave its status `Open` or `Decided`, make one commit, and say plainly in the
   handover that it stayed.

7. **Hand over.** State the mode you were in, what was concluded, whether the entry was deleted or
   rewritten, and which other entries' `Path` lines changed.

   Then, if this item unblocks another, **give the owner the next session's prompt as one
   copy-pasteable block, and it MUST open with the command line** — the owner pastes it whole
   into a fresh session rather than composing anything:

   ```
   /roadmap:start <next-ID>

   Carried from the <this-ID> session: <the decision, as fact — plus anything the next
   session needs and cannot read, because the entry that held it no longer exists>.
   ```

   Writing only prose here breaks the chain: the next session has no access to this one, and the
   entry it would have read has just been deleted. If nothing is unblocked, say which items are now
   at the top of the file instead.

   **Write the block against the repository as it will be after the removal commit**, not as you read
   it at the start — the entry carrying the reasoning is gone by then. Stating the decisions is the
   part every handover already gets right. Three more belong in it, and they are the ones a session
   that did good work still leaves out:

   - **What this item does NOT achieve, and which entry closes that gap.** An item finishes its own
     scope while the larger goal stays out of reach more often than not, and a block listing only what
     the next item needs reads as though the next item were the last one.
   - **Every precondition no session performs** — a production data change, a value set by hand, a
     setting in someone's dashboard. These are the only steps that can be skipped indefinitely,
     because no session's definition of done contains them and the gate cannot see them. Name each one
     and how to check whether it has happened.
   - **Which of your own sentences are descriptions rather than decisions**, flagged as such. Step 1
     asks the next session to sort them; you know which is which and it does not.

## Scope

Anything outside the named item is out of scope. If you find something else, use the roadmap's own
rule (`docs/roadmap/README.md`): small and you are there anyway — just do it; a question with real
trade-offs — add an entry; decided but not scheduled — tell the owner to open an issue.
