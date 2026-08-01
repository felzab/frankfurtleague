# Message templates

**Verified against:** `7e5ea28`, 2026-08-01
**Scope:** copy-paste forms for commit messages, pull requests and issues

Cross-cutting, like the glossary — this belongs to no single surface.

**This page is the form; [`workflows.md`](workflows.md) is the reasoning.** That page documents the
conventions as they are actually practised and argues why they are right for this repo (no
Conventional Commits, no branch prefixes, merge commits rather than squash). Nothing is restated
here — if you want to know _why_ a commit subject looks like this, read that page.

---

## Commit messages

The single most valuable artifact in this repository's history is its commit bodies. They are the
documentation, which is why merges are never squashed.

### Template

```
Scope: what changed

Area. What was wrong or missing, and why that mattered. What the change does
about it, described as behaviour rather than as a diff. Wrapped at roughly 76
characters.

Second area. One paragraph per area the commit touches, each led by the area
it concerns.

Verified against the running stack: what was actually run or checked, and the
result. Name what could not be verified and why.
```

### The subject

`Scope: what changed` — sentence case after the scope, ideally under ~72 characters so
`git log --oneline` does not wrap.

The **scope** is a real area of the codebase or of the programme in progress. Real examples from
this history:

| Scope           | Used for                                          |
| --------------- | ------------------------------------------------- |
| `Backend`       | a change confined to `fl_backend`                 |
| `Repo`          | repository-level files — licence, config, tooling |
| `Docs`          | `docs/` content                                   |
| `Brand`         | the brand mark and everything generated from it   |
| `Wave 8c`       | one phase of a remediation programme              |
| `Wave 7 review` | the review round that followed a merged wave      |

A **two-clause subject joined by ", and"** is idiomatic here when one commit makes two related
changes, and is better than splitting a coherent change in two:

```
Wave 8b: named component exports, and one folder rule for all of them
Repo: switch to the Elastic License 2.0, and add a NOTICE and SECURITY policy
```

### The body

Four things earn their place, because a diff cannot show them:

1. **Why**, not what. The diff already says what.
2. **What was verified, and how** — especially anything the type checker cannot see: RSC
   boundaries, cache invalidation, rendered output, container contents. Include the result, not the
   intent.
3. **Where an earlier assumption turned out to be wrong**, including one made in an audit report,
   a code comment or a previous commit.
4. **The rejected alternative**, when there was one, and what decided it.

And four things stay out: restating the diff, issue-closing keywords, emoji, and trailers — with
one exception, below.

**Wrap at roughly 76 characters.** Nothing enforces it; it is what makes `git log` readable in a
terminal.

**The same-commit currency rule (CLAUDE.md §10):** a change that invalidates a documented claim
updates that documentation in the same commit. It is the only mechanism that actually prevents
drift.

**The one sanctioned trailer.** Assistant-authored commits carry
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` as the last line. That is the only trailer
in use; `workflows.md`'s "no trailers" describes the human-authored convention and this is the
stated exception to it.

### Worked example

A real commit from this history, showing all four body elements in three paragraphs:

```
Docs: audit working files go local-only, and the ledger retires into docs/roadmap

docs/audit/ is now gitignored. The repository is about to go public, and
committing pass reports or a remediation ledger would publish unfixed
findings -- including security findings -- while they are being remediated.
The methodology adjusts to match: the ledger lives on disk with snapshot
copies instead of git history, and every wave's PR body must stand alone
because reviewers can no longer see the wave report.

docs/0-documentation-ledger.md is retired. Its phases were complete; what
was still alive -- the open findings and the undecided items, each with its
full analysis -- moves to the new docs/roadmap/open-items.md. All nine
referencing documents are repointed; zero references to the ledger remain.
```

### Optional: wire the template into git

A `.gitmessage` file plus one config line pre-fills the editor for every commit:

```bash
# dev (Windows, Git Bash) — repo-local, so it does not affect other projects
git config commit.template .gitmessage
```

Not currently set up; mentioned because it costs one file and one command if the shape is ever hard
to remember.

---

## Pull requests

Every change reaches `main` through a PR, merged with a merge commit.

**A PR body must stand alone.** `docs/audit/` is gitignored, so a reviewer on GitHub can see neither
the remediation ledger nor the wave reports — never point at them from a PR body, and never assume
the reader has the working documents.

### Title

The same shape as a commit subject: `Scope: what changed`. For a single-commit PR, use that
commit's subject verbatim.

### Template

```
What the branch achieves as a whole, at a level the individual commits do not — one or two
paragraphs. For a single-commit PR, the commit body already says it and a pointer is enough.

**Verified.** `./scripts/verify.sh` exit 0 — <the parts worth naming, with numbers>. Plus any
manual check and its result.

**Decisions taken.** Anything where a person chose between real options, with the reasoning.
Divergences resolved during the work belong here too.

**Left undone.** Explicitly, with the reason — including anything that could not be verified and
why.

**Governed by.** Links to any ADR the change touches.
```

Drop a heading rather than padding it: a PR with nothing left undone should not carry an empty
"Left undone".

### Reviewer's first look

If one thing in the branch deserves attention before the rest, say so in the first line. That is the
one piece of routing a diff cannot provide.

---

## Issues

New ground: this repository ran for its whole history without issues, because it had one maintainer
working through PRs. They matter now that the repository is public.

Two boundaries decide whether something is an issue at all:

- **A suspected vulnerability is never a public issue.** It goes through
  [`SECURITY.md`](../SECURITY.md) — the contact form or a private security advisory.
- **An idea that needs analysis before a decision is not an issue either.** It belongs in
  [`docs/roadmap/open-items.md`](roadmap/open-items.md), where entries keep their full reasoning
  until they are decided. Issues are for reports and for actionable work; the roadmap is for
  undecided questions.

### Bug report

**Title:** `Area: symptom in one line` — for example
`Spielplan: switching Spieltag leaves an empty grid on mobile`.

```
**What happened.** One or two sentences.

**What I expected instead.**

**How to reproduce.** Numbered steps from a known starting point, including the URL or route.

**Where.** Public page, dashboard or admin; and the season if it matters.

**Evidence.** Screenshot, console error, or — if an error page was shown — its digest. The digest
is written to the server log by instrumentation, so it is the fastest way to find the real error.

**Environment.** Browser and version, desktop or mobile, and the theme if the problem is visual.
```

The **digest** line is the highest-value field on this form: an error page shows a digest, the
server log holds the matching entry, and quoting it turns "something broke" into an exact
stack trace.

### Feature or change request

**Title:** `Area: what should be possible`.

```
**The problem.** What you are trying to do and what makes it hard today. Describe the problem
rather than a solution — the solution is the maintainer's call, and the problem often has a
cheaper answer than the one that prompted the request.

**Who it affects.** Yourself, all admins, everyone visiting the site, or one team.

**What you do instead today**, if there is a workaround.

**How much it matters.** Blocking, annoying, or nice to have.
```

### Task

For the maintainer's own tracked work.

**Title:** `Area: what to do`.

```
**Why now.** What makes it worth doing at this point rather than later.

**Done when.** The observable condition that closes it — not a list of steps.

**Constraints.** Any ADR, invariant or forward constraint that governs the change, linked.
```

---

## Making these appear automatically

Everything above is a reference you copy from. GitHub can serve the PR and issue forms directly —
`.github/PULL_REQUEST_TEMPLATE.md` pre-fills the PR body, and `.github/ISSUE_TEMPLATE/*.yml` turns
the issue forms above into structured fields with a link to `SECURITY.md` in the chooser.

**Not currently wired up.** It is worth doing for issues specifically, because their audience is
people who have never read this page; the PR template matters less while there is one maintainer
who writes bodies from habit.
