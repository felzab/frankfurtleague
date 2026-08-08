# `roadmap` — open items and future ideas

**Verified against:** `857a20a`, 2026-08-08

What this folder holds, and the boundary that keeps it honest:

- [`open-items.md`](open-items.md) — **known open items**: findings and undecided questions that
  have real analysis behind them but no decision yet. Each entry keeps its full reasoning, so the
  decision is taken with the analysis in hand rather than re-derived. **The file is ranked:** reading
  top to bottom gives the suggested working order, by the rubric in
  [How the file is ranked](#how-the-file-is-ranked), and each entry that participates in a dependency
  carries a **Path** line. Some entries are issue-shaped feature work parked there at the owner's
  direction, so the ordering lives in one place — the issue boundary below still applies to
  everything else.
- [`closed-items.md`](closed-items.md) — **the log of everything that has left the open file.** One
  row per item, no prose: id, what it was in a line, and the commit that closed it. Added by the
  owner, 2026-08-02, because deletion alone made a closed item unfindable unless you already knew it
  had existed.
- Ideas and feature plans — one file per substantial idea as this folder grows.

What does **not** belong here: decided things (an ADR, `docs/_decisions/`), defects under active
remediation (the running audit programme's ledger, local-only in `docs/audit/`), and anything the
spec sheets already track as a contract.

When an item here gets decided, it leaves: the decision becomes an ADR (or just gets built), the
entry is deleted from `open-items.md` — git history keeps the analysis — and **a one-line row is added
to [`closed-items.md`](closed-items.md) naming the commit that closed it.** The entry's reasoning is
not copied there and never should be: the row is a pointer, and `git show <sha>` is how you follow it.
**`/roadmap:start <ID>` performs all of that**, including the index row, the renumbering, the `Path`
lines in other entries that named it, and the references elsewhere in the repo — the spec sheets, the
glossary and the audit prompts all cite these IDs. An item that ends only partly done is rewritten
rather than deleted, and gets no row.

## How the file is ranked

**Rank by what it costs to leave the item undone, never by what it costs to do it.** Those are
different questions, and only the first is a priority. An entry's own effort is a tie-break, and it
breaks ties toward the cheaper item.

Five tests, applied in order. **The first one that separates two entries decides**; the rest are not
consulted.

| #   | Test               | Ask                                                                                                                                              |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Leverage**       | Does landing it make the work after it cheaper, safer, or possible at all? A convention, a model decision, a page nothing else can be built on   |
| 2   | **A clock**        | Is there a date, or an unwatched event, after which it is wrong or more expensive? A rollover, a field collecting free text, a growing migration |
| 3   | **Cost of delay**  | Does work done before it have to be redone after it? A doubled edit across two hand-mirrored schemas is the shape to look for                    |
| 4   | **Value per cost** | Among what is left, which removes the most doubt for the least work?                                                                             |
| 5   | **Dependency**     | A blocked entry ranks no higher than its blocker, and never drags its blocker up to meet it                                                      |

**Test 4 is the one this file gets wrong.** An afternoon that settles a question outranks a work
package that adds a feature, and it keeps outranking it however large the feature is. The failure
mode is real and has a direction: big items look important, so they drift up, and the cheap item that
would have made three of them easier sits near the bottom being cheap.

**Four things that must never decide a rank:**

- **Size, in either direction.** A large item is not important because it is large, and a small one
  is not unimportant because it is small. Size enters only at test 4, and only between items the
  first three tests could not separate.
- **Surface or theme.** Putting the frontend entries together reads well and ranks nothing. An
  entry's surface is a column, not a position.
- **Batching.** Items batched to share one schema pass are _executed_ together — that belongs in a
  `Path` line. It never promotes the least important member of the batch to the rank of the most.
- **Age.** How long an entry has sat here says nothing about what it costs to leave it sitting.

### The tiers

Tiers are bands the tests produce, not categories an entry is filed into. An entry moves tier the
moment the tests say so.

| Tier                        | Holds                                                                        | Ordered within by                           |
| --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| **1 — leverage and clocks** | Whatever passes test 1 or test 2: enablers, and anything with a date on it   | Leverage first, then the cheaper item first |
| **2 — the work they carry** | Items that a tier-1 decision, page or convention makes cheap — or possible   | Dependency order                            |
| **3 — independent**         | Blocks nothing, blocked by nothing, no clock                                 | Value per cost                              |
| **4 — standing**            | No scheduled action: a caution, or a finding whose trigger is recorded in it | Grouped, not ranked                         |

**Re-rank the whole file whenever an entry is added or removed, and rewrite each tier's opening
paragraph to describe the entries actually in it.** Ranks are positional: a stale one is worse than
no number at all, and a tier whose prose describes entries that have moved out of it is worse still.
Where the rubric and the current order disagree, **the order is wrong** — the rubric is the rule and
the numbers are its output.

---

## Closing an entry: two commits, not one

**Set by the owner, 2026-08-02, and it is not optional.** Deletion in a single commit leaves the
closure legible only in that commit's body — so `git log -p docs/roadmap/open-items.md` shows an
entry that simply vanishes, and nothing in the file ever said it was finished. Splitting it in two
fixes that, and gives the removal a commit to point at.

Both commits go in **one pull request**. The owner still sees a single merge.

| #     | Commit                 | Contains                                                                                                                                                                                                                                                                                                         |
| ----- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **The closing commit** | The work itself, the ADR(s), and every reference updated across the repo. In `open-items.md`: the entry's `Status` becomes **Closed**, and the entry gains a short block naming what concluded it — the ADRs, and where each non-decision finding was rehomed. **The entry stays.**                              |
| **2** | **The removal commit** | `open-items.md` and `closed-items.md` only: delete the entry and its index row, renumber the rows below, insert any new entries, fix every `Path` line that named the ID, and **add the closed row**. **The body names commit 1's SHA** — "DB-1 was closed in `abc1234`; this removes the entry it left behind." |

Why the SHA lives in commit 2 rather than commit 1: **a commit cannot cite its own hash.** Commit 1
is what closed the item, so it is the thing worth pointing at — in the commit body and in the
`Closed in` column, which is the same SHA — and only commit 2 exists late enough to write it down.

**The `Closed` status exists for exactly one commit.** If it survives into a third, the removal was
forgotten — the file is then claiming an item is finished while still ranking it, which is worse
than either state alone.

### The closed row

Seven columns, and the last is the one that matters:

| Column          | Holds                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **#**           | Assigned in **closing order** and never renumbered. Unlike the open file's ranks, this number is permanent and identifies a row |
| **ID**          | The item's id, retired with it. **Never reused** — a regression gets a new id, not the old one                                  |
| **Item**        | One line, past tense, describing what it was. Not what was done about it                                                        |
| **Surfaces**    | Copied from the open row                                                                                                        |
| **Effort**      | Copied from the open row — the estimate as it stood, not what it actually took                                                  |
| **Depended on** | What the open row's `Depends on` named, so a chain stays readable after both ends are gone                                      |
| **Closed in**   | Commit 1's short SHA, linked to GitHub. **This is the record**; the row is only the pointer to it                               |

Add a bullet under _What each one produced_ **only** when the item left something that outlives its
commit — an ADR it produced, or an entry it opened. An item that was simply fixed gets no bullet.

### Re-derive every status, not just the one you touched

**Set by the owner, 2026-08-02.** Statuses are not independent. `Blocked` is a statement about
_another_ entry, so an item that leaves — or a decision that lands — changes rows nobody edited. An
entry blocked only by the item just closed is now `Open`, and nothing in the file will notice on its
own.

So **commit 2 walks the entire table and re-derives every row's `Status` from the file's actual
state**, not only the rows the session worked on. It is twenty-odd rows; it takes a minute, and it is
the only thing that keeps the column worth reading.

The derivation, in order — the first that applies wins:

1. Concluded this session, entry still present → **Closed**.
2. Every entry named in its `Depends on` column has left the file, or was never blocking → continue.
   Otherwise → **Blocked**.
3. A caution or a finding with a recorded trigger rather than a plan → **Standing**.
4. An ADR settles the argument and the work remains → **Decided**.
5. Otherwise → **Open**.

A status that contradicts the `Depends on` beside it is the failure this rule exists to catch, so
read the two columns together.

---

## This folder or a GitHub issue?

Most things belong in neither. If it is small and you are working anyway, **just do it** — the
commit body is the record, and a ticket for a five-minute fix is ceremony when one person would
ever read it.

For the rest, one test separates the two: **is the reasoning the deliverable, or is the work the
deliverable?**

|               | Here                                             | An issue                                       |
| ------------- | ------------------------------------------------ | ---------------------------------------------- |
| You have      | A question with real trade-offs                  | A task with a known fix                        |
| The value is  | That the analysis survives until someone decides | That the work is visible until someone does it |
| It reads like | Evidence, options, costs                         | A definition of done                           |

A sharper version, borrowed from the ADR test in [`../_standard/3-out-of-code.md`](../_standard/3-out-of-code.md):
_would someone reasonably propose the opposite, and would you have to re-derive the argument to
refuse?_ If yes, it belongs here. If the honest answer is "yes, do that, when I get to it", open an
issue.

**Open an issue when any one of these is true:** someone else reported it — always, without
exception, since the tracker is the channel they can watch; the work is decided but not scheduled,
and you want something that notifies you rather than a file that never will; you want it visible to
people who might help; or it needs a conversation, which a file is a poor medium for.

**An item is authored in exactly one place.** An issue may link here, and an entry here may mention
an issue, but neither restates the other — that is the duplication [`../_standard/`](../_standard/)
exists to prevent. When an item graduates, the issue carries the task and this file keeps the why;
when the work merges, the issue closes and the entry is deleted in the same pull request.

## Linking, in three directions

**An issue pointing at code: always use a commit-pinned permalink.** On any file view on GitHub,
press <kbd>y</kbd> — the URL rewrites from a branch path to one pinned to a commit:

```
https://github.com/felzab/frankfurtleague/blob/<full-sha>/fl_backend/app/shared/schemas/custom.py#L36-L49
```

A `blob/main/…#L36-L49` link drifts silently: three commits later it points at whatever now occupies
those lines, which is worse than a dead link because it still looks right.

**An issue pointing here:** name the file and the section in prose — `docs/roadmap/open-items.md`,
§BE-6 — rather than a heading anchor. GitHub generates anchors from headings, but these headings
carry em-dashes, backticks and the occasional emoji, so the anchors are both ugly and broken by any
rewording.

**Code pointing at an issue: never.** Deleting and recreating this repository on 2026-08-01
destroyed every issue that existed; a `see #12` in a source comment would now be a permanent
reference to something that exists nowhere. This is the rule CLAUDE.md's documentation section already applies to audit
sections — cite ADR numbers, never something expected to disappear — and an issue number is more
fragile than either. State the reason inline, and if you need a pointer, point at an ADR or an entry
here, both of which are versioned alongside the code they describe.

**A pull request pointing at an issue:** mention it in the body as prose and close the issue by
hand. [`../workflows/`](../workflows/) bans issue-closing keywords, and that holds — the automation
saves one click and costs a commit body written for a machine.
