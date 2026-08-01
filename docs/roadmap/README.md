# `roadmap` — open items and future ideas

What this folder holds, and the boundary that keeps it honest:

- [`open-items.md`](open-items.md) — **known open items**: findings and undecided questions that
  have real analysis behind them but no decision yet. Each entry keeps its full reasoning, so the
  decision is taken with the analysis in hand rather than re-derived.
- Ideas and feature plans — one file per substantial idea as this folder grows.

What does **not** belong here: decided things (an ADR, `docs/_decisions/`), defects under active
remediation (the running audit programme's ledger, local-only in `docs/audit/`), and anything the
spec sheets already track as a contract.

When an item here gets decided, it leaves: the decision becomes an ADR (or just gets built), and
the entry is deleted — git history keeps the analysis.

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

A sharper version, borrowed from the ADR test in [`../_standard/2-out-of-code.md`](../_standard/2-out-of-code.md):
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
reference to something that exists nowhere. This is the rule CLAUDE.md §10 already applies to audit
sections — cite ADR numbers, never something expected to disappear — and an issue number is more
fragile than either. State the reason inline, and if you need a pointer, point at an ADR or an entry
here, both of which are versioned alongside the code they describe.

**A pull request pointing at an issue:** mention it in the body as prose and close the issue by
hand. [`../workflows/`](../workflows/) bans issue-closing keywords, and that holds — the automation
saves one click and costs a commit body written for a machine.
