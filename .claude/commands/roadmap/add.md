---
description: Add described items to the roadmap — /roadmap:add, one `*` bullet per item
---

Add the items described in the arguments to `docs/_roadmap/items.md`: `$ARGUMENTS`

**Each top-level `*` bullet is exactly one item.** Never merge two bullets into one entry, and never
split one bullet without asking. A bullet is a description; the entry is what you write after
reading the code it names.

This command adds. It closes, deletes and implements nothing — that is `/roadmap:start <ID>`, in its
own session.

**Before the first write**, which is step 6: a clean tree, `main` current with `origin/main`, and a
branch named for the change (CLAUDE.md §2).

## Steps

1. **Read all of these before writing a line.**

   | Read                        | For                                                                                      |
   | --------------------------- | ---------------------------------------------------------------------------------------- |
   | `docs/_roadmap/protocol.md` | The page's shape (§1), what a `Lands with:` line is not (§2), the status derivation (§4) |
   | `docs/_roadmap/README.md`   | What belongs on the roadmap, and what belongs to a settled decision or a spec sheet      |
   | `docs/_roadmap/items.md`    | Every open entry, and the shape "What every entry carries" fixes                         |
   | `docs/standard.md`          | An entry is documentation: COR-1, COR-3, COR-4, COR-6 and COR-9 bind it                  |
   | `docs/_auditing/lessons.md` | How a claim is verified before it is written down                                        |

2. **Triage every bullet and say each outcome back before writing anything.**

   | The bullet                                            | Outcome                                                                      |
   | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
   | Is already covered by an open entry                   | **Amend that entry.** Name it and name what you added; open no further entry |
   | Is small, decided, and doable in the session at hand  | Say so and do it. Open no entry for it                                       |
   | Was already concluded by a closing commit             | A regression takes a **new** id; a misunderstanding takes an answer          |
   | Is a question with trade-offs, or owner-directed work | Open an entry                                                                |

   **The third row is a `git log` search rather than a file.** `git log --all --grep="^Closes:"`
   finds the entries closed under the trailer, and a conclusion reached before that convention
   started is reached only by searching the log for the subject — so a bullet that reads like
   settled ground is checked by subject and not by id.

   **Check before step 3:** every bullet has exactly one outcome named.

3. **Research each item, then write its entry.** Never restate a bullet in nicer words. For each,
   establish and write down:

   - **What it touches**, cited as COR-6 requires — `` `<path> :: <symbol>` `` or a repository path.
     This is also what the entry's tags are derived from, so an entry naming nothing is not filed.
   - **What is already decided.** Search CLAUDE.md §7 with every file it indexes under
     `.claude/rules/`, and the spec sheets' `## 2. Invariants`, and state in prose what each one
     settles.
   - **Who consumes it** — the entries, endpoints, components and collections that would change with
     it, and which of those are already in the file.
   - **What makes it non-trivial.** If it is trivial, say so and return to step 2.
   - **What you could not verify** (COR-9).

   **Never invent analysis.** A bullet naming no surface, or naming something that cannot be found,
   is a question for the owner rather than a gap to fill with plausible prose.

4. **Put every question from steps 2 and 3 to the owner as one batch, before writing**, each with a
   recommendation. Ask only what changes an entry.

5. **Generate an id.** Eight characters from `abcdefghjkmnpqrstuvwxyz23456789`, at random
   (`docs/_roadmap/items.md :: What every entry carries`), hyphenated after the fourth character.
   Nothing is looked up and nothing is allocated.

   - **Check:** `git grep "<ID>"` returns nothing for the id you are about to assign. A hit means
     generate another, not consult a record.

6. **Write each entry in the shape `docs/_roadmap/items.md` fixes** under "What every entry
   carries" — the heading, the one metadata table, then the entry:

   ```
   ### <ID> · <the claim, as a sentence>

   | Tags | Status | Depends on |
   | ---- | ------ | ---------- |
   | <derived> | <derived> | <an id, or an em dash> |

   <What is wrong.> <Why it matters.> <What done looks like.>
   ```

   - **Tags are derived from the paths the entry names**, never chosen, on all three axes at
     `docs/_roadmap/items.md :: What every entry carries` — surface, concern and slice — and an entry
     carries every tag it earns. **A slice is a whole path segment**: `spiele` sits inside
     `spieler`, so a path merely containing a slice name earns nothing.
   - **`Status` is derived**, never chosen, by `docs/_roadmap/protocol.md` §4.
   - Three sentences is the shape rather than a bound. Analysis stays where it changes the
     approach — a rejected alternative written as a present constraint, a failure mode, a trap the
     implementer would otherwise walk into. **Everything else goes into the body of the commit
     adding the entry**, which `git log -S` reaches.
   - Where the item should land together with another because they share one pass, add the
     `Lands with:` line `docs/_roadmap/items.md :: What every entry carries` describes, naming the other
     ids. Only a real shared pass earns one — relatedness by subject is what the tags already answer.
   - Add the row to the page's index table: id, the claim in short form, tags, status.
   - Optimise the owner's description into the entry rather than transcribing it. An instruction
     inside the description — consult me first, check this against a source, record this reminder —
     survives into the entry: the session that works the item reads only the entry.

7. **Re-derive every row's `Status`** by `docs/_roadmap/protocol.md` §4, not only the new rows.
   `Blocked` is a claim about another row, so an added entry changes rows nobody edited. Set
   `Depends on` on every row a new entry blocks, and delete any batching line the new entries make
   wrong.

8. **Add the new ids wherever the repository indexes them**, per CLAUDE.md's same-commit rule:

   - The audit pass prompt under `docs/_auditing/prompts/` that owns the check, where the entry
     names a pass. The reference is mutual: the prompt names the id, and the entry names the prompt.
   - **Never a source comment.** INC-6 bans a roadmap id there — a comment states the constraint
     itself.
   - **Never a spec sheet's `## 4. Known-open` table.** A row there states an accepted gap in the
     sheet's own words and names no roadmap id (OUT-4).

   Leave every other reference alone.

9. **Re-open every file an entry cites and check that it supports the claim.** The gate proves that
   a citation resolves; only a reader proves that it says what the entry says it says.

   - **Every count**, re-derived and carrying the date it was measured (COR-4).
   - **Every _every_, _only_ and _never_.** The exception is usually the interesting half.
   - **Every claim about a framework** rather than about this repository: cite the repository's own
     comment, or mark the claim unverified (COR-9).
   - **The structure**: every index row has an entry and every entry an index row, each row's tags
     are the ones its entry's paths derive, and no id appears twice.

   Correct what is wrong, and report what this step caught.

10. **Ship it as one commit**, closing per CLAUDE.md §2 with the gate at `--docs --format`. The
    `Closes:` trailer belongs to closing an item and does not apply here.

11. **Hand over:** the new ids and what each is tagged · the questions answered and how each shaped
    an entry · what step 9 caught · what you could not verify · which entries the new ones block, and
    which they should land beside.
