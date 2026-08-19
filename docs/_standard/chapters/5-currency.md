# Currency

**Verified against:** `889c31dd`, 2026-08-19\
**Applies to:** every stamped page, and every change that touches what a documented claim
describes.

| ID    | Rule                                 |
| ----- | ------------------------------------ |
| CUR-2 | The same-commit rule                 |
| CUR-3 | The stamp                            |
| CUR-4 | The branch-impact restamp            |
| CUR-5 | The documentation gate               |
| CUR-6 | Accumulated staleness is the audit's |

---

### CUR-2 — The same-commit rule

**Rule:** a change that invalidates a documented claim updates that document in the same commit.
Not the same branch eventually, not a follow-up — a commit that changes behaviour and leaves its
documentation contradicting the code is an incomplete commit. Before any pull request, answer one
question out loud: what did this change make untrue? "Nothing" is a legitimate answer; not asking
is not.

Two answers are routinely missed, because every check stays green either way:

- **renaming or renumbering an identifier sweeps it as free text**, not only in the citation forms
  the gate resolves. A link's label and its target are rewritten by different rules, so a label left
  holding the old identifier over a target that moved passes the link check and reads as correct
- **deleting a record some rule names as mandatory amends that rule in the same change.** Otherwise
  the rule survives pointing at nothing, and the next reader restores the record to satisfy it

**Why:** the moment of the change is the only moment fixing drift costs nothing — an hour later
the author has moved on, a week later nobody knows the claim was ever true.

**Enforced by:** gate check `branch-impact` for the stamped pages a branch's changes reach; the
close-out question covers the rest.

### CUR-3 — The stamp

**Rule:** a page describing current state carries, as its line 3, exactly
``**Verified against:** `<sha>`, <yyyy-mm-dd>`` — nothing else on the line beyond COR-8's hard
break. It means someone confirmed the page against that commit; writing one without checking
falsifies a record the gate treats as true.

What carries a stamp is decided by what the page claims, never by the folder it sits in: a page
stating what is true of this repository today carries one. A page whose own content is the table
that navigates elsewhere has no claim that can go stale, so it needs none, and one there is neither
required nor wrong. These never carry one, wherever they sit:

- a template, whose stamp line is a placeholder belonging to the copy
- an instruction file — a prompt, a command, or a page of method — which tells a reader what to do
  rather than describing what is
- a document addressed to a reader outside this repository: the root `README.md` and `SECURITY.md`,
  for whom a commit id resolves to nothing

**Why:** the stamp is what makes staleness measurable — without a reference commit, "is this
still true" has no mechanical answer.

**Enforced by:** gate checks `stamp-format` (the exact shape, and the line it sits on), `stamp`
(the SHA is an ancestor of `HEAD`, and a page edited on a branch moves its stamp) and
`stamp-missing` (a page of a kind a path decides carries one at all).

### CUR-4 — The branch-impact restamp

**Rule:** when a branch materially changes a file a stamped page cites — more than comments, by
the same classifier `scripts/check_scope.py` uses — that page is re-verified against the new state and
restamped on the same branch. A page edited on a branch always moves its stamp, and moving a stamp
without re-reading the page falsifies it. What no branch touched is not this rule's business
(CUR-6).

**Why:** staleness is created by a change, so the change pays for the re-verification — a ceiling
counted in commits would fail branches for files they never touched, and a check that cries wolf
gets suppressed.

**Exceptions:** a page added on the branch — there is no earlier stamp to move. And a cited
page whose whole delta is stamp lines — a restamp re-verifies its own page and changes nothing a
citer cites, so it re-arms nothing.

**Enforced by:** gate checks `branch-impact` and `stamp`.

### CUR-5 — The documentation gate

**Rule:** the mechanical defence is `scripts/check_docs.py`, run by `./scripts/verify.sh` in its
docs scope. This table is the one place its checks are listed; the script's docstring points here.

| Check               | A failure means                                                                                                                                                                                                                           | Verdict |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `link`              | A relative markdown link points at nothing                                                                                                                                                                                                | Fail    |
| `anchor`            | An in-page `#anchor` link matches no heading in its file                                                                                                                                                                                  | Fail    |
| `citation`          | A `<file> :: <anchor>` citation's file does not resolve, or is ambiguous, or the anchor is gone — see the scanning rules below                                                                                                            | Fail    |
| `path`              | A backticked repo path names something that is not there, and git does not ignore it                                                                                                                                                      | Fail    |
| `line-citation`     | A citation uses a line number (COR-6), backticked or bare                                                                                                                                                                                 | Fail    |
| `module-header`     | A module header in INC-2's scope breaks its shape — the cap, a ruled or shouty line, a foreign list label, the title line, or a header sitting below the imports                                                                          | Fail    |
| `comment-length`    | A comment block the branch wrote breaks one of INC-9's two bounds                                                                                                                                                                         | Fail    |
| `comment-citation`  | A comment cites an audit id or a ledger row — neither survives its programme (INC-6)                                                                                                                                                      | Fail    |
| `readme-cap`        | A README runs past OUT-3's 120 lines                                                                                                                                                                                                      | Fail    |
| `owner-voice`       | A tracked file outside `.claude/` names its author in the third person (COR-11)                                                                                                                                                           | Fail    |
| `stamp`             | A stamped SHA is no ancestor of `HEAD`, or a page changed on the branch kept its stamp                                                                                                                                                    | Fail    |
| `stamp-format`      | A stamp line deviates from CUR-3's exact shape, or from its line                                                                                                                                                                          | Fail    |
| `branch-impact`     | The branch materially changed a file a stamped page cites, and the page kept its stamp (CUR-4)                                                                                                                                            | Fail    |
| `rule-id`           | A cited rule id resolves to neither a rule heading in `docs/_standard/chapters/` nor a line in `docs/_standard/rules-index.md`, or resolves to more than one rule — including a bare `I<n>` in a comment that two spec sheets both define | Fail    |
| `metadata-break`    | A metadata line breaks COR-8's hard break — carrying one where it must not, or missing one where it must                                                                                                                                  | Fail    |
| `bare-path`         | A repository path named in a comment without backticks resolves to nothing                                                                                                                                                                | Fail    |
| `roadmap-shape`     | A ranked roadmap page disagrees with itself — an entry with no index row, a repeated rank, or a transient status — or sits on disk untracked                                                                                              | Fail    |
| `spec-spine`        | A spec sheet's four sections, or its contract's `1.<n>` numbering, departs from OUT-4                                                                                                                                                     | Fail    |
| `invariant-row`     | An invariant row repeats a number or has the wrong column count, or section 2 holds a row that is neither an invariant nor its header (OUT-4)                                                                                             | Fail    |
| `invariant-id`      | A spec sheet cites an invariant number no invariant table defines                                                                                                                                                                         | Fail    |
| `overview-spine`    | An overview does not open on "How it is organised" or close on "Read next" (OUT-5)                                                                                                                                                        | Fail    |
| `glossary-entry`    | A glossary entry's heading, or its `Is`/`In code`/`Trap`/`See` fields, departs from OUT-6                                                                                                                                                 | Fail    |
| `header-see`        | A path on a module header's `See:` list resolves to no file                                                                                                                                                                               | Fail    |
| `template-fragment` | The pull request form no longer carries a fragment `check_pr_body.py :: TEMPLATE_FRAGMENTS` quotes verbatim                                                                                                                               | Fail    |
| `enforced-by`       | A rule's `Enforced by` field names a gate check the script does not emit                                                                                                                                                                  | Fail    |
| `rule-shape`        | A rule in `docs/_standard/chapters/` breaks PRE-4's anatomy — its heading, its fields in order, or its row in the chapter's table                                                                                                         | Fail    |
| `rule-index`        | A rule has no line in `rules-index.md`, or takes more than one (PRE-4)                                                                                                                                                                    | Fail    |
| `stamp-missing`     | A spec sheet, a surface overview, the glossary or a standard chapter carries no stamp (CUR-3)                                                                                                                                             | Fail    |
| `check-registry`    | This table and `check_docs.py :: CHECKS` disagree — a missing row, an extra row, or the wrong verdict                                                                                                                                     | Fail    |
| `inputs`            | A tree or page another check reads is absent, which would leave that check passing without examining anything                                                                                                                             | Fail    |
| `unreadable`        | A tracked file cannot be decoded as UTF-8                                                                                                                                                                                                 | Fail    |
| `segment-map`       | `/docs:audit`'s segment table does not partition the tree — a tracked file belongs to no segment or to more than one, or the table itself is missing                                                                                      | Fail    |
| `line-endings`      | A tracked text file holds CRLF in the working tree where `.gitattributes` mandates LF                                                                                                                                                     | Fail    |
| `stamp`             | The stamped SHA is not in this clone — usually a shallow clone, not a defect                                                                                                                                                              | Report  |
| `history`           | A COR-3 history phrase appears in the branch diff — the hits must be read                                                                                                                                                                 | Report  |
| `sha`               | A commit named in prose resolves to nothing in this clone — the hits must be read                                                                                                                                                         | Report  |
| `counts`            | A cardinal or an ordinal appears in the branch's added prose or comments (COR-4) — the hits must be read                                                                                                                                  | Report  |
| `comment-citation`  | A comment the branch added names a roadmap id or a review round (INC-6)                                                                                                                                                                   | Report  |
| `branch-scope`      | A branch-scoped check did not run: git could not answer for an input it reads — a clone shape, not a defect                                                                                                                               | Report  |

The scanning rules that keep it quiet:

- fenced blocks are stripped before anything is extracted
- placeholder text — anything with `<` `>` `{` `}` `*` `?`, `…` or the literal NNNN — is skipped
  everywhere
- a gitignored path is never a failure
- a bare filename in a citation — one naming no directory and no file at the repository root — is
  answered from the tracked files, a template excepted, so untracked copies beside them — a build
  directory, a cache, a nested worktree — cannot make one ambiguous, and a name that set does not
  answer resolves to nothing
- a page a check reads as its subject, whether a glob selects it or a check names it, and every
  rule id, roadmap id and `I<n>` a citation resolves against, come from the tracked
  files — a page `git add` has not reached selects nothing and resolves nothing, exactly as on a
  clean checkout. A path a page names is still answered from disk
- source files are scanned comments-only (INC-6), and everything else is scanned in full
- a template is checked like any other page except for its stamp, its backticked paths and its
  relative links, all three of which resolve from where the template is copied to

**Why:** every other defence depends on someone remembering; this one does not — and the report
rows report rather than fail because a check that cries wolf gets suppressed.

**Enforced by:** `./scripts/verify.sh` — the docs scope, part of every prescribed gate
combination.

### CUR-6 — Accumulated staleness is the audit's

**Rule:** the gate holds a branch to what that branch touched, and nothing else. What no change
has touched — a page drifting quietly, a fact stated twice, a sentence a stranger cannot act on —
is `/docs:audit`'s job: invoked, never scheduled, a way of catching up rather than a defence. The
slice between the two — one branch's documentation, judged before its pull request — is
`/docs:audit-pr`'s.

**Why:** a gate that fails branches over pages they never touched trains people to override it,
and treating the sweep as a defence would weaken the mechanisms that hold without anyone
remembering.

**Enforced by:** unenforced by design.
