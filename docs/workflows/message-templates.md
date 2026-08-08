# Message templates

**Verified against:** `eefc968`, 2026-08-08
**Scope:** copy-paste forms for commit messages, pull requests and issues

**This page is the form; [`README.md`](README.md) — the workflows page beside it — is the reasoning.** That page documents the
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
about it, described as behaviour rather than as a diff. Where an earlier
assumption turned out to be wrong -- one made in a previous commit, a code
comment or an audit report -- say so here. Wrapped at roughly 76 characters.

Second area. One paragraph per area the commit touches, each led by the area
it concerns. Where a real alternative was rejected, name it and what decided
it, in the paragraph whose change it belongs to.

Verified. What was actually run and what it returned -- the gate invocation
and its exit code, plus any manual check and its result. Name what could not
be verified, and why.
```

**All four of the elements below appear in that shape**, which is the point of it: the two that are
easiest to forget — a wrong earlier assumption, and the rejected alternative — are prompted for
inside the paragraph they belong to rather than given headings of their own. A body is prose, not a
form.

### The subject

`Scope: what changed` — sentence case after the scope, and **no trailing period**. Aim under 72
characters, which is where GitHub truncates a title in a list view and where `git log --oneline`
wraps an 80-column terminal.

**72 is a target here and not a limit**, and the gate treats it that way: it reports a subject past
72 and fails one past 100. Measured over the last eighty non-merge commits, thirty-seven run past
72, because the two-clause subject below is idiomatic and worth its length. Past 100 a subject is
unreadable everywhere rather than truncated in one view, which is a different problem.

The **scope** is a real area of the codebase or of the programme in progress:

| Scope           | Used for                                                  |
| --------------- | --------------------------------------------------------- |
| `Frontend`      | a change confined to `fl_frontend`                        |
| `Backend`       | a change confined to `fl_backend`                         |
| `Database`      | a change to the data itself, or to the constraints on it  |
| `Ops`           | deployment, images, nginx                                 |
| `CI`            | `.github/workflows/`                                      |
| `Repo`          | repository-level files — licence, config, tooling         |
| `Docs`          | `docs/` content                                           |
| `Roadmap`       | `docs/roadmap/` — opening, closing or re-ranking an entry |
| `Auditing`      | `docs/_auditing/` — the audit method itself               |
| `Brand`         | the brand mark and everything generated from it           |
| `Frontend deps` | Dependabot's frontend updates                             |
| `Backend deps`  | Dependabot's backend updates                              |

A scope outside that set is **reported, never refused** — a genuinely new area is a reason to add a
row here, not a reason for the gate to reject the commit that needed it.

**Subjects are declarative, not imperative**, and that is a deliberate departure from the convention
most projects follow. "Fix the parser" completes the sentence "if applied, this commit will …";
`Backend: the league table counts the Gruppenphase` instead states what is true once it lands. The
whole convention-era history reads that way, and consistency across a log is worth more than
matching a convention it never followed. Do not "correct" it.

A **two-clause subject joined by ", and"** is idiomatic here when one commit makes two related
changes, and is better than splitting a coherent change in two:

```
Frontend: named component exports, and one folder rule for all of them
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

And four things stay out: restating the diff, issue-closing keywords, emoji, and trailers. There is
no sanctioned trailer: work is never signed as AI-generated — no `Co-Authored-By`, no "generated
with" line — and that rule (CLAUDE.md, §2) overrides any tool default that would add one.

**Wrap at roughly 76 characters** — it is what makes `git log` readable in a terminal, where git
indents a body by four. The gate fails a line past 100, which is not a wrap that ran a little wide
but a paragraph nobody wrapped at all.

### What the gate enforces, and what it only reports

`scripts/check_commits.py` runs inside the `--docs` scope and again in CI on every pull request. It
reads **only the commits on your branch** — never history, which predates this convention and reads
"WIP" and "Fixed bug". Merge and revert subjects are git's, so it skips them.

| Refused                                                    | Reported                            |
| ---------------------------------------------------------- | ----------------------------------- |
| A subject that is not `Scope: what changed`                | A subject past 72 characters        |
| A subject ending in a period, or past 100 characters       | A scope outside the table above     |
| A non-blank second line — git then reads it all as subject | A body that records no verification |
| No body at all                                             |                                     |
| Any line past 100 characters, URLs excepted                |                                     |
| A trailer, an issue-closing keyword, an emoji              |                                     |

**The split is deliberate.** Everything on the left is true or false without reading the change;
everything on the right needs judgment, and a check that cries wolf gets suppressed
([`../_standard/5-currency.md`](../_standard/5-currency.md)). Advisories do not appear in a green
run — the gate captures a passing step's output — so read them with
`./scripts/verify.sh --docs --verbose`, or by running the checker directly.

**The same-commit currency rule (CLAUDE.md, documentation):** a change that invalidates a documented claim
updates that documentation in the same commit. It is the only mechanism that actually prevents
drift.

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

### Wire the check into git, once per clone

`.githooks/commit-msg` refuses a message that breaks any of the rules on the left above, at the one
moment fixing it is free. Git does not version the hooks directory it actually uses, so one config
line per clone points it at the one this repository does version:

```bash
# dev (Windows, Git Bash) — repo-local, so it does not affect other projects
git config core.hooksPath .githooks
```

**The hook is convenience; the gate is the enforcement.** A fresh clone has no hook until someone
runs that line, which is exactly why the same checker runs in `./scripts/verify.sh --docs` and in
CI on every pull request. Anything the hook catches, the gate catches too — later, and after a
rebase costs something. A refused message is not lost: git keeps it, and the hook prints the
`git commit -F` line that reuses it.

---

## Pull requests

Every change reaches `main` through a PR, merged with a merge commit.

**A PR body must stand alone.** `docs/audit/` is gitignored, so a reviewer on GitHub sees none of it —
never point at anything under it from a PR body, and never assume the reader has the working
documents. Open items live in [`../roadmap/open-items.md`](../roadmap/open-items.md).

**A PR body summarises the branch; it never indexes the branch's commits**
([ADR-0036](../_decisions/0036-a-pull-request-body-summarises-the-branch.md)). GitHub's Commits tab
is already that index, with every commit body one click away and no hand-written copy to go stale.

**Dependabot's pull requests are out of scope.** The bot writes its own bodies; leave them alone.

### Title

The same shape as a commit subject: `Scope: what changed`. For a single-commit PR, use that
commit's subject verbatim.

### Template

```
One orientation sentence, for a multi-commit PR only: how many commits there are and what they do,
grouped by theme rather than listed one per line. Name a commit's SHA only where a reader has to
find that specific commit.

What the branch achieves as a whole, at a level the individual commits do not — one or two
paragraphs. For a single-commit PR, this is the whole body, and the commit's own body already
says most of it.

**Verified.** The `./scripts/verify.sh` invocation — its scopes and its exit code — and the parts
worth naming, with numbers. Plus any manual check and its result. Say plainly what could not be
verified, and why.

**Decisions taken.** Anything where a person chose between real options, with the reasoning.
Divergences resolved during the work belong here too.

**Left undone.** Explicitly, with the reason — including anything that could not be verified and
why.

**Governed by.** Links to any ADR the change touches.
```

Drop a heading rather than padding it: a PR with nothing left undone should not carry an empty
"Left undone".

### The orientation sentence

**A multi-commit PR opens with one sentence saying how many commits there are and what they do.**
Group them by theme; a fifteen-commit branch gets four themes, not fifteen lines. It is the one
sentence that tells a reviewer how big the thing in front of them is before they decide where to
start.

The standing case for naming SHAs is a **roadmap closure**, where which commit did what is the
fact the record depends on — the closing commit is what `Closed in` points at in
[`../roadmap/closed-items.md`](../roadmap/closed-items.md), and the removal commit is what shows
the two-commit protocol was followed:

```
Two commits, one item. 1acfc49 closes DB-3 -- the live saison_teams documents no longer carry the
statistik field that ADR-0026's derivation orphaned -- and 41b158e removes the entry, per the
two-commit protocol in docs/roadmap/README.md.
```

Everywhere else, name a SHA only when a reader has to find that commit and the Commits tab would
not lead them to it quickly.

### What the body gate enforces, and what it only reports

`scripts/check_pr_body.py` runs in CI on every pull request — `.github/workflows/pr-body.yml`, which
listens for `edited` as well as `opened`, so a body corrected after review turns the check green
without an unrelated push. It cannot run in `./scripts/verify.sh`: the body is not in the
repository, and does not exist yet when the gate runs.

| Refused                                                             | Reported                 |
| ------------------------------------------------------------------- | ------------------------ |
| An empty body, or the template submitted with its placeholder prose | A summary over 200 words |
| No Verified paragraph — bold optional, the section is what counts   |                          |
| Three or more list items each carrying a commit hash                |                          |
| A summary over 500 words above the first heading                    |                          |

**Three, not two, is the commit-index threshold** — a roadmap closure names both its SHAs and is
correct to (see the orientation sentence above). **`Verified` is the one section never legitimately
dropped**, because every pull request here runs the gate; the other three are unchecked precisely so
the rule to drop a heading rather than pad it stays true. Dependabot is skipped entirely.

**The sections are matched by name, never by their bolding.** The template bolds them and most of
the merged corpus does not, and two asterisks are not something a reader loses — a check that
insisted on them refused 27 of 44 merged bodies, several of them among the best written.

Check an open one by hand:

```bash
gh pr view 48 --json body -q .body | python scripts/check_pr_body.py -
```

### Reviewer's first look

If one thing in the branch deserves attention before the rest, say so in the first line. That is the
one piece of routing a diff cannot provide.

---

## Issues

Issues exist for an audience that has never read this page: the repository is public, and the
tracker is the one channel an outside reporter can watch.

Two boundaries decide whether something is an issue at all:

- **A suspected vulnerability is never a public issue.** It goes through
  [`SECURITY.md`](../../SECURITY.md) — the contact form or a private security advisory.
- **An idea that needs analysis before a decision is not an issue either.** It belongs in
  [`docs/roadmap/open-items.md`](../roadmap/open-items.md), where entries keep their full reasoning
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

**Evidence.** Screenshot, console error, or — if an error page was shown — its digest **plus the
time it happened**. A digest names an error class, not a single incident (every network failure
shares one), so the digest narrows the search and the time and route pin the exact log entry,
whose correlation id then opens every surface's lines for that request (`docs/logging.md`).

**Environment.** Browser and version, desktop or mobile, and the theme if the problem is visual.
```

The **Evidence** line is the highest-value field on this form: digest plus time plus route is what
turns "something broke" into one specific set of log lines with a stack trace on them.

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

## The GitHub-served copies

GitHub serves these forms directly: `.github/PULL_REQUEST_TEMPLATE.md` pre-fills every PR body with
the template above, and `.github/ISSUE_TEMPLATE/` turns the issue forms into structured fields,
with the security-advisory and roadmap boundaries repeated in the chooser
(`.github/ISSUE_TEMPLATE/config.yml`).

**This page is the source; the served copies follow it.** A change here updates them in the same
commit (CLAUDE.md, documentation) — the two drifting apart is exactly the failure the same-commit
rule exists to prevent, and the forms bind the maintainer the same as any outside contributor.
