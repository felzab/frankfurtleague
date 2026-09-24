# Roadmap — protocol

**Purpose:** how the page is shaped, and how an entry on it is closed

**An item is authored in exactly one place**, [`items.md`](items.md). An issue may link here and an
entry may mention an issue; neither restates the other. **Open an issue when someone else reported
it — always, without exception**, because the tracker is the channel they can watch.

## 1. The shape of the page

**A flat run of entries, every one identical in shape: a heading carrying the token and the claim,
then one table of its status and what it depends on.** Nothing is ranked or grouped under a heading,
and an entry's position says only where its token sorts: the run ascends in token order
(`scripts/checks/docs_gate/checks.py :: _check_token_order`), so a reader who has reached the end of
it has read the whole page. No index restates the entries — the headings are the index, and
`grep "^### " docs/_roadmap/items.md` prints it — and a heading over a group would be a category
nothing keeps true as entries arrive and leave.

### What the page deliberately does not carry

- **No tag or label.** An entry names the paths and symbols it touches
  (`scripts/checks/docs_gate/checks.py :: _check_subjects`), and a reader after one surface or one
  slice searches for them; a hand-written label grows a vocabulary nobody maintains.
- **No relatedness link between entries.** Two entries touching one feature name the same paths, and
  a reader finds them by searching; a second mechanism for that fact is a second home, which COR-2
  refuses.
- **No check on whether a `Lands with:` line is still worth acting on.** Its tokens are validated for
  resolving to an entry and no further
  (`scripts/checks/docs_gate/checks.py :: _check_batches`).

## 2. The id

**It is fixed by [`items.md`](items.md#what-every-entry-carries)** — the token's alphabet and
generation, and the `Lands with:` line.

One distinction belongs with the status values below rather than with the form: **a `Lands with:`
line is an execution note and never a dependency.** It says the work is cheaper taken together, where
`Depends on` says one entry cannot start until another lands, and only the second reaches §4's
derivation.

## 3. Closing an entry: one commit carrying a `Closes:` trailer

**The work, the entry's deletion and every reference the change invalidates go in one commit**, whose
message carries a `Closes: <token>` trailer naming the entry that left
([`../_git/spec.md`](../_git/spec.md) §1.3). `git log --all --grep` over that trailer is the whole of
the record afterwards, so the body is where the argument goes: every decision recorded where it will
be read, what concluded the item, and where each finding outside it was rehomed.

The same commit fixes every entry the closure moved — a `Depends on` naming the token that left, and
each `Lands with:` line naming it, which
[`items.md`](items.md#what-every-entry-carries) deletes rather than edits.

**An item that ends only partly done is rewritten rather than deleted**, and its commit carries no
trailer: the entry stays, describing what is left and what was decided.

## 4. Re-derive every status, not just the one you touched

`Blocked` is a claim about _another_ entry, so an item that leaves — or a decision that lands —
changes entries nobody edited. **A closing commit walks every entry and re-derives its `Status`**,
not only the entries the session worked on. The set is closed and the first match wins:

| #   | When                                                                                                                                                                          | Status       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | An entry its `Depends on` names is still on the page and still blocking                                                                                                       | **Blocked**  |
| 2   | A caution, or a finding with a recorded trigger rather than a plan                                                                                                            | **Standing** |
| 3   | I have ruled the entry deferred — a conclusion no session reaches on its own                                                                                                  | **Skipped**  |
| 4   | The argument is settled and recorded where it will be read — a comment at the line it constrains, a CLAUDE.md §7 line or a `.claude/rules/` clause, or a spec-sheet invariant | **Decided**  |
| 5   | Otherwise                                                                                                                                                                     | **Open**     |

**`Decided` is not done**: the entry has become an instruction rather than a question, and the work
remains. **`Skipped` is not declined**: the work is still wanted, so the entry stays and nothing
re-opens it until I say so (ruled 2026-09-06). A status that contradicts the `Depends on`
beside it is the failure this rule exists to catch, so read the two columns together. **The
status is a word the table above derives, a `Depends on` names only other entries the page still
holds, and a `Blocked` names at least one** (`scripts/checks/docs_gate/checks.py :: _check_status`), which
reads that set out of the table rather than repeating it.

**Rule 4's three homes are the whole set.** An argument recorded anywhere else — a page holding it
until it reaches its own destination, a commit body, a report — leaves the entry at rule 5, because
what makes a question settled is that whoever meets the constraint next is standing where the answer
is written.
