# Currency

**Verified against:** `09f903d`, 2026-08-08\
**Applies to:** every stamped page, and every change that touches what a documented claim
describes.

| ID    | Rule                                 |
| ----- | ------------------------------------ |
| CUR-1 | Current-state claims are anchored    |
| CUR-2 | The same-commit rule                 |
| CUR-3 | The stamp                            |
| CUR-4 | The branch-impact restamp            |
| CUR-5 | The documentation gate               |
| CUR-6 | Accumulated staleness is the audit's |

---

### CUR-1 — Current-state claims are anchored

**Rule:** every claim about current behaviour cites something the gate can check (COR-6). A
document that cannot state anchored claims is a document in the wrong shape — narrative prose
about current behaviour moves into a spec sheet rather than being promised a re-read.

**Why:** an unanchored claim is an assertion; an anchored one is a testable statement that fails
detectably instead of going quietly, confidently wrong.

**Exceptions:** —

**Enforced by:** gate checks `citation` and `path` verify the anchors; that a claim carries one is
`/docs:audit`'s.

**Example:** —

### CUR-2 — The same-commit rule

**Rule:** a change that invalidates a documented claim updates that document in the same commit.
Not the same branch eventually, not a follow-up — a commit that changes behaviour and leaves its
documentation contradicting the code is an incomplete commit. Before any pull request, answer one
question out loud: what did this change make untrue? "Nothing" is a legitimate answer; not asking
is not.

**Why:** the moment of the change is the only moment fixing drift costs nothing — an hour later
the author has moved on, a week later nobody knows the claim was ever true.

**Exceptions:** —

**Enforced by:** gate check `branch-impact` for the stamped pages a branch's changes reach; the
close-out question covers the rest.

**Example:** —

### CUR-3 — The stamp

**Rule:** a page describing current state carries, as its line 3, exactly
``**Verified against:** `<sha>`, <yyyy-mm-dd>`` — nothing else on the line beyond COR-8's hard
break. It means someone confirmed the page against that commit; writing one without checking
falsifies a record the gate treats as true. Stamped: the overviews, the specs, the glossary, `docs/README.md`, the workflows,
roadmap and `docs/_standard/` pages, and `scripts/README.md`. Never stamped: ADRs (dated, never
re-verified — DEC-2), templates, and prompt or command files, which are instructions rather than
descriptions.

**Why:** the stamp is what makes staleness measurable — without a reference commit, "is this
still true" has no mechanical answer.

**Exceptions:** —

**Enforced by:** gate checks `stamp-format` (the exact shape) and `stamp` (the SHA is an ancestor
of `HEAD`, and a page edited on a branch moves its stamp).

**Example:** —

### CUR-4 — The branch-impact restamp

**Rule:** when a branch materially changes a file a stamped page cites — more than comments, by
the same classifier the scope check uses — that page is re-verified against the new state and
restamped on the same branch. A page edited on a branch always moves its stamp, and moving a stamp
without re-reading the page falsifies it. What no branch touched is not this rule's business
(CUR-6).

**Why:** staleness is created by a change, so the change pays for the re-verification — a ceiling
counted in commits would fail branches for files they never touched, and a check that cries wolf
gets suppressed.

**Exceptions:** a page added on the branch — there is no earlier stamp to move.

**Enforced by:** gate checks `branch-impact` and `stamp`.

**Example:** —

### CUR-5 — The documentation gate

**Rule:** the mechanical defence is `scripts/check_docs.py`, run by `./scripts/verify.sh` in its
docs scope. This table is the one place its checks are listed; the script's docstring points here.

| Check           | A failure means                                                                                | Verdict |
| --------------- | ---------------------------------------------------------------------------------------------- | ------- |
| `adr`           | An `ADR-NNNN` citation resolves to no file in `docs/_decisions/`                               | Fail    |
| `link`          | A relative markdown link points at nothing                                                     | Fail    |
| `anchor`        | An in-page `#anchor` link matches no heading in its file                                       | Fail    |
| `citation`      | A `<file> :: <anchor>` citation's file is missing or ambiguous, or the anchor is gone          | Fail    |
| `path`          | A backticked repo path names something that is not there, and git does not ignore it           | Fail    |
| `line-citation` | A citation uses a line number (COR-6)                                                          | Fail    |
| `stamp`         | A stamped SHA is no ancestor of `HEAD`, or a page changed on the branch kept its stamp         | Fail    |
| `stamp-format`  | A stamp line deviates from CUR-3's exact shape                                                 | Fail    |
| `branch-impact` | The branch materially changed a file a stamped page cites, and the page kept its stamp (CUR-4) | Fail    |
| `adr-meta`      | An ADR breaks DEC-2's anatomy, DEC-3's status set, or DEC-6's reciprocity                      | Fail    |
| `adr-index`     | An ADR has no row in the index (DEC-7)                                                         | Fail    |
| `rule-id`       | A cited rule id resolves to no rule heading in `docs/_standard/chapters/`                      | Fail    |
| `stamp`         | The stamped SHA is not in this clone — usually a shallow clone, not a defect                   | Report  |
| `history`       | A COR-3 history phrase appears in the branch diff — the hits must be read                      | Report  |

Four scanning rules keep it quiet:

- fenced blocks are stripped before anything is extracted
- placeholder text — anything with `<` `>` `{` `}` `*` `?` or the literal NNNN — is skipped
  everywhere
- a gitignored path is never a failure
- templates are skipped entirely, and source files are scanned comments-only (INC-6)

**Why:** every other defence depends on someone remembering; this one does not — and the two
report rows report because a check that cries wolf gets suppressed.

**Exceptions:** —

**Enforced by:** `./scripts/verify.sh` — the docs scope, part of every prescribed gate
combination.

**Example:** —

### CUR-6 — Accumulated staleness is the audit's

**Rule:** the gate holds a branch to what that branch touched, and nothing else. What no change
has touched — a page drifting quietly, a fact stated twice, a sentence a stranger cannot act on —
is `/docs:audit`'s job: invoked, never scheduled, a way of catching up rather than a defence.

**Why:** a gate that fails branches over pages they never touched trains people to override it,
and treating the sweep as a defence would weaken the mechanisms that hold without anyone
remembering.

**Exceptions:** —

**Enforced by:** unenforced by design.

**Example:** —
