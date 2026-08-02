---
description: Work one open item to a conclusion — /roadmap:start <ID>, e.g. /roadmap:start F4
---

Work the open item named by the arguments: `$ARGUMENTS` (one item ID — e.g. `F4`, `DB-1`, `LOG-1`).

**One item per session, and this command never starts a second one.** The tiers in
`docs/roadmap/open-items.md` are an ordering, not a batch: tier 1 alone is M + M + XL. A session
that opens three items builds the later fixes on decisions the earlier ones have not made yet.

## Steps

1. **Resolve the item.** Read `docs/roadmap/open-items.md` in full and find the entry whose ID
   matches. If the ID does not exist, list the IDs from the index table and stop.

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

4. **Ask for what the entry says you need.** Several entries name a dependency on the owner: DB-1
   offers additional database resources, FB-4 requires that standard bracket conventions be checked
   and the owner consulted before anything changes, OPS-4 wants candidate output styles to choose
   from, LOG-1 carries a standing reminder to raise the `trace_id`-on-every-request question. Raise
   these at the start, not after the work is done.

5. **Do the work**, following the whole cycle in `docs/workflows/README.md` — branch first (a hook
   enforces it), commit with a real body, `./scripts/verify.sh` before pushing, hand over the PR
   link, title and body. Never open or merge the PR.

6. **Conclude the item, which means removing it.** An item that is done is not open, so **the entry
   is deleted from `docs/roadmap/open-items.md` in the same commit as the work** — git history keeps
   the analysis, per `docs/roadmap/README.md`. Deleting an entry is not optional cleanup; leaving it
   is how the file stops being trustworthy.

   Removing an entry means all of this, in one commit:

   - **Delete the entry** and its heading.
   - **Delete its row** from the "path at a glance" table, and **renumber** the rows below it. The
     ranks are positional, so a stale number is worse than none.
   - **Fix every `Path` line that named it.** Search the file for the ID — an entry that said
     "blocked by F4" must not still say so once F4 is gone. Replace it with the decision F4 reached,
     stated as a fact.
   - **Search the whole repo for the ID**, not just this file: the spec sheets, the glossary and the
     audit prompts reference these IDs (`docs/backend/spec.md` cites F4 as invariant I1, for
     instance). Update every reference in the same commit — CLAUDE.md §10 requires it.
   - **Write the ADR if a decision was taken**, per `docs/_standard/3-adr-guide.md`, and point the
     updated references at it. A decision that only exists in a commit body is one nobody will find.

   If the item ends **partly** done, do not delete it. Rewrite the entry to describe what is left
   and what was decided, and say plainly in the handover that it stayed.

7. **Hand over.** State: the mode you were in, what was concluded, whether the entry was deleted or
   rewritten, which other entries' `Path` lines changed, and — if this item unblocks another —
   **the exact prompt for the next session**, including any decision the next session must be told
   because it cannot see this one.

## Scope

Anything outside the named item is out of scope. If you find something else, use the roadmap's own
rule (`docs/roadmap/README.md`): small and you are there anyway — just do it; a question with real
trade-offs — add an entry; decided but not scheduled — tell the owner to open an issue.
