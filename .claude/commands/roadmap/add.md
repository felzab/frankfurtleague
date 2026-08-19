---
description: Add described items to the roadmap and re-rank each page they land on — /roadmap:add, one `*` bullet per item
---

Add the items described in the arguments to the ranked page each one belongs on
(`docs/_roadmap/protocol.md`), then re-rank every page that gained an entry: `$ARGUMENTS`

**Each top-level `*` bullet is exactly one item.** Never merge two bullets into one entry, and never
split one bullet without asking. A bullet is a description; the entry is what you write after
reading the code it names.

This command adds and re-ranks. It closes, deletes and implements nothing — that is
`/roadmap:start <ID>`, in its own session.

**Before the first write**, which is step 6: a clean tree, `main` current with `origin/main`, and a
branch named for the change (CLAUDE.md §2).

## Steps

1. **Read all of these before writing a line.**

   | Read                                | For                                                                                 |
   | ----------------------------------- | ----------------------------------------------------------------------------------- |
   | `docs/_roadmap/protocol.md`         | Which page an entry belongs on, the ranking rubric (§1), the status derivation (§3) |
   | `docs/_roadmap/README.md`           | What belongs on the roadmap, and what belongs to a settled decision or a spec sheet |
   | `docs/_roadmap/open-items.md`       | Every open product entry, and the shape "What every entry carries" fixes            |
   | `docs/_roadmap/tooling-items.md`    | Every open tooling entry, written in that same shape                                |
   | `docs/_roadmap/closed-items.md`     | The retired ids, and the numbers already spent                                      |
   | `docs/_standard/chapters/1-core.md` | An entry is documentation: COR-1, COR-3, COR-4, COR-6 and COR-9 bind it             |
   | `docs/_auditing/lessons.md`         | How a claim is verified before it is written down                                   |

2. **Triage every bullet and say each outcome back before writing anything.**

   | The bullet                                            | Outcome                                                                      |
   | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
   | Is already covered by an open entry                   | **Amend that entry.** Name it and name what you added; open no further entry |
   | Is small, decided, and doable in the session at hand  | Say so and do it. Open no entry for it                                       |
   | Matches a row in `docs/_roadmap/closed-items.md`      | A regression takes a **new** id; a misunderstanding takes an answer          |
   | Is a question with trade-offs, or owner-directed work | Open an entry                                                                |

   **Check before step 3:** every bullet has exactly one outcome named.

3. **Research each item, then write its entry.** Never restate a bullet in nicer words. For each,
   establish and write down:

   - **What it touches**, cited as COR-6 requires — `` `<path> :: <symbol>` `` or a repository path.
   - **What is already decided.** Search CLAUDE.md §7 and the spec sheets' `## 2. Invariants`, and
     state in prose what each one settles.
   - **Who consumes it** — the entries, endpoints, components and collections that would change with
     it, and which of those are already in the file.
   - **What makes it non-trivial.** If it is trivial, say so and return to step 2.
   - **What you could not verify** (COR-9).

   **Never invent analysis.** A bullet naming no surface, or naming something that cannot be found,
   is a question for the owner rather than a gap to fill with plausible prose.

4. **Put every question from steps 2 and 3 to the owner as one batch, before writing**, each with a
   recommendation. Ask only what changes an entry.

5. **Assign an id.**

   - Take the prefix from the ids in use across the roadmap files. A programme belonging to no
     single surface earns a new prefix — say when you invent one.
   - **The number is one past the highest that prefix has ever carried**, retired ids and recorded
     gaps included. An id is never reused (`docs/_roadmap/protocol.md :: The closed row`).
   - **Check:** `git grep -n "<ID>"` returns nothing for the id you are about to assign.

6. **Write each entry in the shape `docs/_roadmap/open-items.md` fixes** under "What every entry
   carries" — the heading, one metadata line per field in this order, then the analysis:

   ```
   ### <rank> · <ID> — <the problem, never the solution>

   **Status:** <derived by docs/_roadmap/protocol.md §3>\
   **Surfaces:** <FE, BE, DB, Ops — in that order, only those it touches>\
   **Effort:** <S | M | L | XL>\
   **Path:** <what it blocks, and what blocks it>

   <the analysis from step 3, opening with a bold sentence naming what the item is>
   ```

   - **A field with nothing to say holds an em dash**, never an absent line.
   - Every metadata line but the last ends in a backslash (COR-8).
   - Add the row to the page's index table: rank, ID, the heading's problem in short form, surfaces,
     effort, status, and `Depends on` — an entry id, or an em dash.
   - Optimise the owner's description into the entry rather than transcribing it. An instruction
     inside the description — consult me first, check this against a source, record this reminder —
     survives into the entry: the session that works the item reads only the entry.

7. **Re-rank every page that gained an entry, and only those** (`docs/_roadmap/protocol.md` §1),
   re-deriving every rank rather than inserting the new entries into the order that exists.

   - Renumber the index table **and** every `### <rank> ·` heading, and keep them in step.
   - **Re-derive every row's `Status`** by §3, not only the new rows. `Blocked` is a claim about
     another row, so an added entry changes rows nobody edited.
   - Fix every `Path` line the new entries affect, in each direction: what they block, and what
     blocks them.
   - Set `Depends on` on every row a new entry blocks, and correct the sentence under the table that
     states what that column currently holds.

   **Report every entry that moved**, one line each: `<ID>: <old rank> → <new rank>, test <n>`.

8. **Add the new ids wherever the repository indexes them**, per CLAUDE.md's same-commit rule:

   - The `## 4. Known-open` table of the spec sheet for each surface the entry names. That table's
     `#` column is where a roadmap id lives in `docs/`.
   - The audit pass prompt under `docs/_auditing/prompts/` that owns the check, where the entry's
     `Path` line names a pass. The reference is mutual: the prompt names the id, and the entry's
     `Path` line names the prompt.
   - **Never a source comment.** INC-6 bans a roadmap id there — a comment states the constraint
     itself.

   Leave every other reference alone.

9. **Re-open every file an entry cites and check that it supports the claim.** The gate proves that
   a citation resolves; only a reader proves that it says what the entry says it says.

   - **Every count**, re-derived and carrying the date it was measured (COR-4).
   - **Every _every_, _only_ and _never_.** The exception is usually the interesting half.
   - **Every claim about a framework** rather than about this repository: cite the repository's own
     comment, or mark the claim unverified (COR-9).
   - **The structure**: the index table and the `### <rank> ·` headings agree rank by rank, ranks run
     from 1 with no gap, and no id appears twice.

   Correct what is wrong, and report what this step caught.

10. **Restamp every stamped page this change touched**, in CUR-3's shape and only after re-reading
    it. Step 8 edits spec sheets, and each carries a stamp.

11. **Ship it as one commit**, closing per CLAUDE.md §2 with the gate at `--docs --format`. The
    two-commit protocol belongs to closing an item and does not apply here.

12. **Hand over:** the new ids and where each ranked · every entry that moved and the test that moved
    it · the questions answered and how each shaped an entry · what step 9 caught · what you could
    not verify · which entries the new ones block or unblock.
