# Git — templates

**Verified against:** `3ab1688`, 2026-08-10\
**Scope:** copy-paste forms for commit messages and pull request bodies

| Section                             | Answers                                                           |
| ----------------------------------- | ----------------------------------------------------------------- |
| [Commit messages](#commit-messages) | The form, the scope vocabulary, and what the message gate refuses |
| [Pull requests](#pull-requests)     | The form, and what the body gate refuses                          |

The contract these forms serve — branching, commits, pull requests, the gate — is
[`spec.md`](spec.md).

---

## Commit messages

```
<Frontend|Backend|Docs|Repo|Roadmap>: <what changed — sentence case, no trailing period, declarative>

<Area.> <What was wrong or missing and why that mattered, then what the change
does about it, described as behaviour rather than as a diff. Where an earlier
assumption turned out to be wrong — one made in a previous commit, a code
comment or an audit report — say so here. Prose, not a list, wrapped at roughly
76 characters.>

<Second area. One paragraph per area the commit touches, each led by the area it
concerns. Where a real alternative was rejected, name it and what decided it, in
the paragraph whose change it belongs to.>

<Verified. What was actually run and what it returned — the gate invocation and
its exit code, plus any manual check and its result. Never the word "passing".
Name what could not be verified, and why.>
```

Two related changes may share one subject, joined by `, and`. **Never "correct" a declarative
subject to the imperative** ([`spec.md`](spec.md) §1.3).

Three narrower scopes carry the changes those five do not describe, and a wave of an audit
programme in progress leads with its own name (`Wave 6`):

| Scope      | Used for                                  |
| ---------- | ----------------------------------------- |
| `Ops`      | deployment, images, nginx                 |
| `CI`       | `.github/workflows/`                      |
| `Database` | the data itself, or the constraints on it |

Dependabot writes to the same shape, leading with whichever prefix `.github/dependabot.yml` gives
the update entry. `scripts/check_commits.py :: KNOWN_SCOPES` is the recorded vocabulary, those
prefixes and the scopes above together.

`scripts/check_commits.py` refuses a `Co-authored-by` or a `Signed-off-by` trailer
(`scripts/check_commits.py :: BANNED`), a subject past 100 characters, and a body line past 100
characters — unless that line is one unbroken token or carries a long URL, which wrapping would
break (`scripts/check_commits.py :: UNWRAPPABLE`).

A commit Dependabot wrote — matched on an exact author identity
(`scripts/check_commits.py :: BOT_IDENTITIES`), never a substring — is released from the sign-off
refusal and from the wrapped-body rule, which its own generator gives it no way to satisfy, and
from no other refusal here.

---

## Pull requests

```
<One orientation sentence, for a multi-commit PR only: how many commits there are and what they
do, grouped by theme rather than listed one per line. Name a commit's SHA only where a reader has
to find that specific commit.>

<What the branch achieves as a whole, at a level the individual commits do not — one or two
paragraphs. For a single-commit PR, this is the whole body, and the commit's own body already
says most of it.>

**Reviewer's first look.** <Optional: the one thing in the branch that deserves attention before
the rest.>

**Verified.** <The `./scripts/verify.sh` invocation — its scopes and its exit code — and the parts
worth naming, with numbers. Plus any manual check and its result. Say plainly what could not be
verified, and why. This is the one heading never dropped.>

**Decisions taken.** <Anything where a person chose between real options, with the reasoning.
Divergences resolved during the work belong here too.>

**Left undone.** <Explicitly, with the reason — including anything that could not be verified and
why. Drop a heading rather than padding it: nothing left undone means no heading.>

**Governed by.** <Links to any ADR the change touches.>
```

`scripts/check_pr_body.py` refuses a body still carrying this form's placeholder prose, a body with
no Verified section, a summary above the first heading past 500 words, and three or more
**consecutive** list items each carrying a commit hash
([ADR-0029](../_decisions/0029-a-pull-request-body-summarises-the-branch.md)). A line of prose
breaks that run; a blank line does not (`scripts/check_pr_body.py :: longest_commit_run`). A body
Dependabot opened is skipped whole (`scripts/check_pr_body.py :: BOT_AUTHORS`) — ADR-0029 governs
human-authored bodies alone.
