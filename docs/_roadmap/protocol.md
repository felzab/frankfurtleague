# Roadmap — protocol

**Purpose:** how the page is shaped, and how an entry on it is closed

**An item is authored in exactly one place**, [`items.md`](items.md). An issue may link here and an
entry may mention an issue; neither restates the other. **Open an issue when someone else reported
it — always, without exception**, because the tracker is the channel they can watch.

## 1. The shape of the page

**One index table at the top — token, the claim, tags, status — then a flat run of entries, every one
identical in shape.** Nothing is ranked or grouped under a heading, and where an
entry sits on the page carries nothing. A heading over a group is a category that has to be kept
describing itself as entries arrive and leave, where a tag says the same thing with no section to
maintain: an entry is found by its tags or by its token.

### What the page deliberately does not carry

- **No free-form feature or epic label.** The slice tag answers that question derivably, and a
  hand-written label grows a vocabulary nobody maintains and nothing can check.
- **No relatedness link between entries.** Two entries touching one feature already share tags and a
  reader finds them by filtering; a second mechanism for a fact the tags already carry is a second
  home, which COR-2 refuses.
- **No check on whether a `Lands with:` line is still worth acting on.** Its tokens are validated for
  resolving to an entry and no further: whether a batch still earns one pass is a judgement nothing
  mechanical can hold, and a check that cannot fail honestly should not exist.

## 2. The id and the tags

**Both are fixed by [`items.md`](items.md#what-every-entry-carries)** — the token's alphabet and
generation, the three tag axes and what each is derived from, and the `Lands with:` line — and they
are stated there rather than here because that is the page a reader filtering on a tag is already
standing on.

One distinction belongs with the status values below rather than with the form: **a `Lands with:`
line is an execution note and never a dependency.** It says the work is cheaper taken together, where
`Depends on` says one entry cannot start until another lands, and only the second reaches §4's
derivation.

## 3. Closing an entry: one commit carrying a `Closes:` trailer

**The work, the entry's deletion and every reference the change invalidates go in one commit**, whose
message carries a `Closes: <token>` trailer naming the entry that left. `git log --all --grep` over
that trailer is the whole of the record afterwards, so the body is where the argument goes: every
decision recorded where it will be read, what concluded the item, and where each finding outside it
was rehomed.

The same commit fixes every entry the closure moved — a `Depends on` naming the token that left, and
each `Lands with:` line naming it, which §1 deletes rather than edits. §4's derivation is then re-run
over the whole page rather than over the rows the session happened to edit.

**An item that ends only partly done is rewritten rather than deleted**, and its commit carries no
trailer: the entry stays, describing what is left and what was decided.

## 4. Re-derive every status, not just the one you touched

### The values

A closed set:

| Status       | Means                                                                                                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open**     | Nothing decided, nothing blocking. Pick it up whenever                                                                                                                                                                                               |
| **Decided**  | The argument is settled and recorded where it will be read — a comment at the line it constrains, a CLAUDE.md §7 line or a `.claude/rules/` clause, or a spec-sheet invariant. The work is not done: the entry is now an instruction, not a question |
| **Blocked**  | Waiting on another entry. The `Depends on` column names which — a dependency marked _soft_ there is an ordering preference, not a block                                                                                                              |
| **Standing** | No scheduled action — a caution, or a finding with a recorded trigger rather than a plan                                                                                                                                                             |

### The derivation

`Blocked` is a claim about _another_ entry, so an item that leaves — or a decision that lands —
changes rows nobody edited.

**A closing commit walks the entire table and re-derives every row's `Status` from the page's actual
state**, not only the rows the session worked on. The first match wins:

| #   | When                                                                    | Status       |
| --- | ----------------------------------------------------------------------- | ------------ |
| 1   | An entry its `Depends on` names is still on the page and still blocking | **Blocked**  |
| 2   | A caution or a finding with a recorded trigger rather than a plan       | **Standing** |
| 3   | The argument is settled and recorded, and the work remains              | **Decided**  |
| 4   | Otherwise                                                               | **Open**     |

A status that contradicts the `Depends on` beside it is the failure this rule exists to catch, so
read the two columns together.
