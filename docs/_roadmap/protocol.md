# Roadmap — protocol

**Purpose:** how an entry is ranked, where it is authored, and how it is closed

**An item is authored in exactly one place.** An issue may link here and an entry may mention an
issue; neither restates the other.

**Two pages carry ranked entries, and what the work touches decides which.** The product goes in
[`open-items.md`](open-items.md), under the `FB`, `FE`, `BE`, `DB` and `LOG` prefixes; the toolchain,
the gate and the documentation corpus go in [`tooling-items.md`](tooling-items.md), under `OPS` and
`DOC`. A prefix coined later belongs to whichever of the two its work touches, never to a third page.
**Each page is ranked only against itself.** The two draw on different attention and neither waits on
the other, so an order interleaving them ranks pairs nobody ever chooses between.

**Open an issue when someone else reported it — always, without exception**, because the tracker is
the channel they can watch.

## 1. How a page is ranked

**Rank by what it costs to leave the item undone, never by what it costs to do it.** An entry's own
effort is a tie-break, and it breaks ties toward the cheaper item.

The tests are applied in order, and **the first one that separates two entries decides**; the rest
are not consulted.

| #   | Test               | Ask                                                                                                                                              |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Leverage**       | Does landing it make the work after it cheaper, safer, or possible at all? A convention, a model decision, a page nothing else can be built on   |
| 2   | **A clock**        | Is there a date, or an unwatched event, after which it is wrong or more expensive? A rollover, a field collecting free text, a growing migration |
| 3   | **Cost of delay**  | Does work done before it have to be redone after it? A doubled edit across hand-mirrored schemas is the shape to look for                        |
| 4   | **Value per cost** | Among what is left, which removes the most doubt for the least work?                                                                             |
| 5   | **Dependency**     | A blocked entry ranks no higher than its blocker, and never drags its blocker up to meet it                                                      |

**What must never decide a rank:**

- **Size, in either direction.** Size enters only at test 4, and only between entries the tests
  above it could not separate. The drift to watch for: a large item reads as important and rises,
  while the cheap entry that would have made other items easier sits at the bottom being cheap.
- **Surface or theme.** An entry's surface is a column, not a position.
- **Batching.** Items batched to share one schema pass are _executed_ together, which belongs in a
  `Path` line. It never promotes the least important member of the batch to the rank of the most.
- **Age.** How long an entry has sat here says nothing about what it costs to leave it sitting.

**Adding or removing an entry re-ranks the page it sits on.** The other page is untouched — it was
never ranked against this one. Where the rubric and the current order disagree, **the order is
wrong**: the rubric is the rule and the numbers are its output.

**One ranked run per page, top to bottom, and no bands.** A `Status` of `Standing` is what says an
entry has no scheduled action, so a band saying the same thing splits one page into sections that
have to be kept describing themselves.

## 2. Closing an entry: two commits, not one

A single commit would delete the entry without the file ever having said it was finished. Both
commits go in **one pull request**, and `/roadmap:start <ID>` performs both.

| #     | Commit                 | Contains                                                                                                                                                                                                                                                                                                                                  |
| ----- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **The closing commit** | The work itself, every decision recorded where it will be read, and every reference updated across the repository. On the entry's own ranked page: its `Status` becomes **Closed**, and it gains a short block naming what concluded it — where each decision went, and where each non-decision finding was rehomed. **The entry stays.** |
| **2** | **The removal commit** | The entry's ranked page and `closed-items.md` only: delete the entry and its index row, renumber the rows below, insert any new entries, fix every `Path` line that named the ID, and **add the closed row**. **The body names commit 1's SHA.**                                                                                          |

The SHA lives in commit 2 because **a commit cannot cite its own hash**, and commit 1 — the one that
closed the item — is what both the body and the `Closed in` column point at.

**The `Closed` status exists for exactly one commit.** If it survives into a third, the removal was
forgotten and the page is ranking an item it calls finished.

An item that ends only partly done is rewritten rather than deleted, and gets no row.

### The closed row

One row per removal, in [`closed-items.md`](closed-items.md):

| Column          | Holds                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------- |
| **ID**          | The item's id, retired with it. **Never reused** — a regression gets a new id, not the old one    |
| **Item**        | One line, past tense, describing what it was. Not what was done about it                          |
| **Surfaces**    | Copied from the open row                                                                          |
| **Effort**      | Copied from the open row — the estimate as it stood, not what it actually took                    |
| **Depended on** | What the open row's `Depends on` named, so a chain stays readable after both ends are gone        |
| **Closed in**   | Commit 1's short SHA, linked to GitHub. **This is the record**; the row is only the pointer to it |

## 3. Re-derive every status, not just the one you touched

### The values

A closed set, governing every ranked page:

| Status       | Means                                                                                                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open**     | Nothing decided, nothing blocking. Pick it up whenever                                                                                                                                                                  |
| **Decided**  | The argument is settled and recorded where it will be read — a comment at the line it constrains, a CLAUDE.md §7 line, or a spec-sheet invariant. The work is not done: the entry is now an instruction, not a question |
| **Blocked**  | Waiting on another entry on the same page. The `Depends on` column names which — a dependency marked _soft_ there is an ordering preference, not a block                                                                |
| **Standing** | No scheduled action — a caution, or a finding with a recorded trigger rather than a plan                                                                                                                                |
| **Closed**   | Concluded, awaiting removal. **This status exists for exactly one commit**: §2's removal commit deletes the entry, cites the closing one, and adds the row to `closed-items.md`                                         |

### The derivation

`Blocked` is a claim about _another_ entry, so an item that leaves — or a decision that lands —
changes rows nobody edited.

**Commit 2 walks the entire table and re-derives every row's `Status` from the page's actual
state**, not only the rows the session worked on. The first match wins:

| #   | When                                                                    | Status       |
| --- | ----------------------------------------------------------------------- | ------------ |
| 1   | Concluded this session, entry still present                             | **Closed**   |
| 2   | An entry its `Depends on` names is still on the page and still blocking | **Blocked**  |
| 3   | A caution or a finding with a recorded trigger rather than a plan       | **Standing** |
| 4   | The argument is settled and recorded, and the work remains              | **Decided**  |
| 5   | Otherwise                                                               | **Open**     |

A status that contradicts the `Depends on` beside it is the failure this rule exists to catch, so
read the two columns together.
