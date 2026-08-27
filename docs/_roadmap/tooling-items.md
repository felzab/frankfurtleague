# Tooling items

**Verified against:** `1c70c28a`, 2026-08-27\
**Purpose:** what is open on the toolchain, the gate and the documentation corpus, ranked — each entry carrying the analysis its decision needs

| Section                                               | Answers                                                  |
| ----------------------------------------------------- | -------------------------------------------------------- |
| [How this page is ordered](#how-this-page-is-ordered) | What produced the order, and what belongs here at all    |
| [What every entry carries](#what-every-entry-carries) | Which fields an entry states, and what each one may hold |
| [The path at a glance](#the-path-at-a-glance)         | Which items are open, and where each ranks               |
| [The items in rank order](#the-items-in-rank-order)   | Each entry in full, in the working order                 |

**Product work is on [`open-items.md`](open-items.md)**, and which of the two pages an entry belongs
on is [`protocol.md`](protocol.md)'s. **Look in [`closed-items.md`](closed-items.md) before
concluding that an id never existed.**

## How this page is ordered

**Reading top to bottom is the working order** — one ranked run, with nothing banded inside it. The
tests that produce that order, and what must never decide a rank, are in
[`protocol.md`](protocol.md#1-how-a-page-is-ranked): rank by what it costs to leave an item undone,
and let effort break ties toward the cheaper item.

Each entry keeps its full reasoning so the eventual decision is taken with the analysis in hand. Some
entries are seeded into an audit pass under `docs/_auditing/prompts/` as one of its starting checks;
where that holds, the entry's own `Path` line names the pass.

## What every entry carries

An entry is a `### <rank> · <ID> — <the problem, not the solution>` heading, then one metadata line
per field in the order below, then the analysis. **A field with nothing to say is an em dash, never
an absent line**, so an entry can be read down the same way every time.

| Field        | Holds                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**   | One value from the closed set derived below                                                                                                          |
| **Surfaces** | Which of FE, BE, DB, Ops and Docs the work would touch, in that order                                                                                |
| **Effort**   | **S** an afternoon · **M** a day or two · **L** a work package across several sessions · **XL** a programme touching data, schemas and UI end to end |
| **Path**     | What the entry blocks, and what blocks it                                                                                                            |

**A status is derived, never chosen**, by the first matching row of
[`protocol.md`](protocol.md#3-re-derive-every-status-not-just-the-one-you-touched) — which is also
where each value's meaning is fixed. A closure re-derives every entry's, not only its own, because
`Blocked` is a claim about another row.

## The path at a glance

| #   | ID     | Item                                                        | Surfaces      | Effort | Status   | Depends on |
| --- | ------ | ----------------------------------------------------------- | ------------- | ------ | -------- | ---------- |
| 1   | OPS-60 | The gate saturates the machine, then idles through its tail | Ops           | M      | Open     | —          |
| 2   | OPS-80 | One stamp move clears a branch's every later edit           | Ops, Docs     | S      | Open     | —          |
| 3   | OPS-82 | A citation written as a link arms no re-verification        | Ops, Docs     | S      | Open     | —          |
| 4   | OPS-75 | The comment reader drops the blocks it exists to measure    | Ops, Docs     | S      | Open     | —          |
| 5   | OPS-64 | The whole API is on the internet, behind static keys        | Ops, Docs     | S      | Open     | —          |
| 6   | OPS-84 | The linter runs a version past its end of life              | FE, Ops, Docs | M      | Open     | —          |
| 7   | OPS-67 | The runner cannot load a component, so none is tested       | FE, Ops, Docs | M      | Open     | —          |
| 8   | OPS-76 | Most of the database tier runs unconstrained                | BE, Ops       | M      | Open     | —          |
| 9   | OPS-56 | The git stepper reads one `git`, on one line                | Ops           | S      | Open     | —          |
| 10  | OPS-71 | A citation resolves to a string, not to what it names       | Ops, Docs     | S      | Open     | —          |
| 11  | DOC-12 | A Known-open table has no membership test                   | Docs          | S      | Open     | —          |
| 12  | DOC-11 | Audit programmes stay open, and their rows go unranked      | Docs          | M      | Open     | —          |
| 13  | OPS-78 | The local edge claims to mirror production, unchecked       | Ops, Docs     | S      | Open     | —          |
| 14  | OPS-70 | Two db-tier runs at once fail in a way that names nothing   | Ops           | M      | Open     | —          |
| 15  | OPS-73 | A copy test pins what its own author wrote                  | FE, Ops, Docs | M      | Open     | —          |
| 16  | OPS-61 | The commit hook's scratch is a path git cannot open         | Ops           | S      | Open     | —          |
| 17  | OPS-79 | A projection's coupling is guarded in one direction only    | BE, Ops       | M      | Open     | —          |
| 18  | OPS-62 | A pin bump arms every page citing the workflow              | Ops, Docs     | S      | Open     | —          |
| 19  | OPS-77 | A test fixture asserts the type nothing else checks         | FE, Ops       | M      | Open     | —          |
| 20  | OPS-72 | The unique-index test pairs by ordinal position             | BE, Ops       | S      | Open     | —          |
| 21  | OPS-85 | The gate never reads a stylesheet's comments                | Ops, Docs     | S      | Open     | —          |
| 22  | OPS-29 | The docs gate is blind inside an embedded one-liner         | Ops, Docs     | S      | Open     | —          |
| 23  | OPS-11 | The compose guard cannot tell an invocation from a name     | Ops           | S      | Open     | —          |
| 24  | OPS-74 | One field list is drift-guarded on one side only            | FE, Ops       | S      | Open     | —          |
| 25  | OPS-68 | Two routes on one path and method collapse to one           | BE, Ops       | S      | Open     | —          |
| 26  | OPS-83 | An in-transaction read's session argument is untested       | BE, Ops       | M      | Open     | —          |
| 27  | OPS-63 | A comment claims two files hold one pattern, unchecked      | FE, BE, Ops   | S      | Open     | —          |
| 28  | OPS-69 | A declared-permitted state's reason is checked by nothing   | BE, Ops       | S      | Open     | —          |
| 29  | OPS-65 | An unused parameter is reported by no checker here          | FE, Ops       | S      | Open     | —          |
| 30  | OPS-66 | The CSP's style directive is wider than it needs to be      | Ops, Docs     | S      | Open     | —          |
| 31  | OPS-12 | Nothing checks a generated file against its generator       | FE, Ops       | S      | Open     | —          |
| 32  | DOC-9  | Pairs of audit checks hunt the same ground                  | Docs          | S      | Open     | —          |
| 33  | DOC-2  | An enforcement claim is resolved in one direction only      | Docs          | M      | Open     | —          |
| 34  | OPS-19 | Both repository-wide linters re-read every file             | FE, Ops       | S      | Open     | —          |
| 35  | OPS-10 | The comment-only classifier costs a process per file        | Ops           | S      | Open     | —          |
| 36  | OPS-2  | Nothing validates the contents of a restored `.env`         | Ops           | —      | Standing | —          |
| 37  | OPS-3  | Crawler policy split between robots.txt and Cloudflare      | Ops           | —      | Standing | —          |
| 38  | DOC-3  | A rule pattern reaches less than the rule it enforces       | Docs          | —      | Standing | —          |
| 39  | DOC-4  | A stamp is required by a path and owed by a claim           | Docs          | —      | Standing | —          |
| 40  | DOC-10 | One unchanged line exempts a rewritten comment block        | Ops, Docs     | S      | Standing | —          |
| 41  | OPS-81 | One commit imports a module the commit after it adds        | FE, Ops       | —      | Standing | —          |

**No entry on this page blocks another**, which is why every `Depends on` cell is an em dash. What
each entry waits on that is _not_ an entry — a page, a decision, a scheduled audit pass — is on its
own `Path` line.

---

## The items in rank order

### 1 · OPS-60 — The gate saturates the machine, then spends its whole tail unable to use it

**Status:** Open\
**Surfaces:** Ops\
**Effort:** M\
**Path:** Independent — it blocks nothing and nothing blocks it. It answers what **OPS-19** and
**OPS-10** defer to: each proposes removing work from inside one scope, and the profile below names
which section binds the run, so neither moves the gate's wall clock here while `db` is the tail. It
shares a prerequisite with **OPS-70**, whose candidate repair — a database name carrying the run's own
identity — is exactly what the first lever needs; taking the two together is an ordering note, not a
dependency. Its own branch: it reaches the pool manifest, which carries the exit contract.

**The gate's floor is its longest section plus whatever waits behind it.** `scripts/verify.sh` writes one unit
per scope in the form `scope:after,after`, `scripts/gate_pool.py :: parse_unit` reads it, and
`:: ordered` holds a unit back until every scope its `after` names has finished. Nothing passes
`--width`, so the pool opens one slot per unit and every unconstrained scope starts at once. `ops` is
the exception and the run's tail: it follows three scopes, and in the run tabulated below it starts at
91 seconds of 94 to do 2.4 seconds of work. The constraint and what it protects are
`scripts/verify.sh :: scope_shares` and [`docs/ops/spec.md`](../ops/spec.md) §1.6.

**Two scopes writing one `__pycache__` is not a coupling, and a second chain must not be added on
that reasoning.** `docs` and `scripts` have shared two of those directories unconstrained since the
pool was written: CPython writes a bytecode file to a temporary name and renames it, nothing in this
repository reads pytest's `nodeids`, and `lastfailed` is written only when its value changes and
steers only `--lf`, which the gate never passes. The argument in full is `d828ee1c`'s, and it is worth
reading before any scope here is made to wait on another.

**How the chain is read off a run, rather than inferred.** Sample `ps` while a full-form run is going
and record when each worker's process first appears: the unconstrained scopes appear together within
seconds, and any scope appearing later is one the pool held. That separates a scope that is slow from
a scope that started late, which a per-scope duration cannot — a section reported at two seconds is
two seconds of work at the end of a wait the closing table never names.

**The machine is not short of resources, and the trace says something sharper than that.** Measured
2026-08-26 on the development machine: 8 physical cores, 16 logical, 31 GB of memory, with the Docker
daemon reporting 16 CPUs and 15.1 GiB. `~/.wslconfig` sets neither a processor nor a memory key, so
the daemon already holds every logical processor and WSL2's default half of host memory — **there is
no configured ceiling here to raise.** Machine-wide CPU, sampled across one full-form run at
1.4-second intervals by a single counter process, averages 49%, peaks at 100%, and sits under 40% for
28 of its 53 samples. **That average is two halves with opposite problems.** Through roughly the first
thirty seconds the machine is pinned at 100% with seven sections competing, which is where the `db`
section inflates to the 86 seconds below from the smaller figure the tier costs alone
([`docs/backend/spec.md`](../backend/spec.md)). Then everything else finishes and the last forty-odd
seconds are `db` by itself, at six to twenty per cent of the machine: single-threaded, waiting on
replica-set round trips, its write paths running through `session.with_transaction` against the
single-node replica set `fl_backend/tests/conftest.py :: mongo_replica_set_url` starts. **Adding cores
or memory buys nothing** — the tail already cannot use the ones there are, and that idle capacity is
precisely what concurrency inside the tier would consume.

**The levers, and what stands in front of each.**

**1 · Distribute the database tier — the only one of the three that moves this run's wall clock.** It
is aimed at the tail the trace shows, and latency-bound work overlaps rather than divides: two workers
waiting on two commits wait once. `pytest-xdist` is absent — `fl_backend/pyproject.toml`'s dev group
names pytest, ruff, fastapi-cli, httpx, pyright and testcontainers, and no distribution plugin — and
installing it is not the work. **Two things land first.** `fl_backend/tests/database.py :: _BUILT`
holds the built-schema registry in a module global whose comment states the assumption under it, that
the whole tier runs in one process; each suite names its database in a module-level `DATABASE_NAME`,
and the pymongo-seeded suites share `fl_backend/tests/config.py :: build_test_config`'s `db_base_name`.
Two workers would therefore hold one name, and `:: a_clean_database` drops or empties the database it
is handed — so each would clear the other's seeds mid-test, against a registry describing a database
the other has since rebuilt. Per-worker naming comes first. Second,
`fl_backend/tests/conftest.py :: mongo_container` and `:: mongo_replica_set_url` are session-scoped and
a worker is its own session, so distributing the tier multiplies both containers and the replica-set
election by the worker count. **Whether the overlap pays for that is a measurement rather than an
assumption**, and it is why this is a work package and not a flag.

**2 · Distribute the fixture net — a lever on one scope, not yet on the gate.**
`scripts/tests/test_check_docs.py :: _load` copies `scripts/` into a throwaway repository, commits a
planted corpus into it and imports the gate from the copy; `:: _STATE` memoises the result, so the
build is paid once per process. It is what binds its own scope, at 46 seconds against `selfcheck`'s
35 — but that scope closes forty seconds inside `db`, so nothing it gives back reaches the wall clock
until lever 1 has landed. A worker is a process, so it also carries the miniature of lever 1's second
problem, as many fixture builds as workers against one today, and it wants the same absent plugin.

**3 · Distribute the default tier — last, and probably never.** It is the cheapest to prove isolated,
having no database and no container, and it is the one the profile argues away twice over:
[`docs/backend/spec.md`](../backend/spec.md) records what that tier costs on its own, a figure small
enough that per-worker interpreter startup is a real fraction of it, and the section running it closes
well inside `db`. It is recorded here so that it is rejected against the profile rather than reached
for as the obvious first move.

**The widths already in the tree are literals, and nothing derives one from the machine.**
`scripts/selfcheck.sh :: par_run` fans its queued units out over `PAR_WIDTH`, fixed at 16, and the
guard probes are queued through it — so the probe table is already off the serial path, one hook
process per row and sixteen rows at a time. Those sixteen are asked for inside the exact window the
trace shows pinned at 100%, beside six other sections and beside the two workers
`fl_frontend/package.json`'s `lint` script asks eslint for. Whether sixteen is right for a scope
sharing sixteen logical processors with the rest of a saturated gate is worth a measurement of its
own, and `--verbose` is the oracle for any answer it gives: it drops `PAR_WIDTH` to 1, and selfcheck's
output is byte-identical across the two widths by construction.

**What a change to any of this owes.** `scripts/selfcheck.sh` owns the four-code exit contract's
classifier, so anything reaching that file re-opens the contract's measured rank, finding and exit
combinations; anything reaching how the probes execute owes a before-baseline, a verdict-set diff and
a required zero, because a probe that has stopped firing looks exactly like a probe that passes. A
db-tier change owes the harder version of the same: those verdicts are what a branch rests on, and a
worker that silently cleared a neighbour's seeds fails somewhere else entirely.

**The profile: one full-form run with images, `d828ee1c`, 2026-08-26.** Taken on an idle machine — a
contended measurement measures the contention ([`docs/ops/spec.md`](../ops/spec.md) §3), and for the
database tier the difference between a figure and OPS-70 is exactly that. Starts-at is `ps` sampling,
seconds from the run's start. What a tier costs on its own belongs to
[`docs/backend/spec.md`](../backend/spec.md); what this table holds is the gate's own sections, which
include the waiting.

| Section    | Starts at | Costs |
| ---------- | --------- | ----- |
| `scope`    | 0         | 2.9s  |
| `scripts`  | 5         | 46s   |
| `docs`     | 5         | 10s   |
| `backend`  | 5         | 38s   |
| `format`   | 5         | 33s   |
| `frontend` | 5         | 61s   |
| `ops`      | 91        | 2.4s  |
| `db`       | 5         | 86s   |
| `images`   | 5         | 8.0s  |

**The run above totals 94 seconds, and that is not the figure to quote.** Seven consecutive full-form
runs at this commit gave 88, 94, 95, 90, 92, 90 and 94 seconds — **mean 91.9, spread 88 to 95** —
every one exit 0 with nine sections green, against a 109-second baseline. A total that moves by seven
seconds between identical runs is a distribution, and a lever worth taking has to beat the spread
rather than one sample inside it.

Inside the `scripts` scope, whose checks start together and are collected one step at a time:

| Step                      | Costs |
| ------------------------- | ----- |
| `selfcheck`               | 35s   |
| `pytest`, the fixture net | 46s   |
| `pyright`                 | 4.2s  |
| `ruff`                    | 0.4s  |

**Done when** lever 1 has been taken or rejected against a re-taken profile of the same shape, levers
2 and 3 are re-ranked against whatever binds the run once the tail moves, and any figure quoted for
the result carries its spread and its run count the way the ones above do.

### 2 · OPS-80 — One stamp move clears a branch, however many edits follow it

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent of every entry here. Landing it changes what `branch-impact` arms on, which is
the trigger **DOC-4** records; **OPS-82** is the other reason that check stays silent, and how the two
compound is stated there; it edits `scripts/docs_gate/branch.py :: check_branch_impact`, whose
materiality classifier is **OPS-62**'s subject; and it should not ride on a branch that is then
verified with it, for the reason recorded at **OPS-75**.

**`scripts/docs_gate/branch.py :: check_stamp_freshness` compares a page's `Verified against` line at
the branch's fork point against the same line in the working tree, and fails only where the two are
byte-identical.** So the first stamp move anywhere on a branch clears that page for the rest of it:
every later edit, by any hand, passes with the stamp still naming the commit it named before those
edits.

**What the comparison reads, and what it never reads.** The candidate set is every markdown file
`git diff --name-only` reports against the fork, so uncommitted work is included — the comment at that
call records why the right-hand side is the working tree rather than `HEAD`. A page drops out where it
carries no stamp, where it sits under a `scripts/docs_gate/kernel.py :: SKIP_DIRS` entry, or where the
fork holds no such file, that last being CUR-4's exception for a page added on the branch. What
survives is one string comparison, over the whole line
`scripts/docs_gate/kernel.py :: STAMP_LINE_RE` matches — SHA and date together. **No commit between
the fork and the working tree is opened.**

**Comparing the line as text concedes more than the obvious case.** A date bumped with the SHA left
alone satisfies the check, and so does a stamp naming a commit that every edit on the branch
postdates. Neither is what CUR-3 means by a stamp, which is that a person read the page against the
named commit; and `stamp`, the other check on that line, asks only that the named commit be an
ancestor of `HEAD`, which an old commit is forever.

**It re-arms on one condition: the fork moving.** `scripts/checker_kernel.py :: resolve_base` takes
the base to `git merge-base`, which stands still for the life of a branch, so only a rebase onto a
newer base — or the branch merging and a successor forking from the result — restores the check.
Returning the stamp line to its exact fork text re-arms it too, which nobody does deliberately.

**A stamp gone stale is worse than one never written.** CUR-3's `Why` is that the stamp is what makes
staleness measurable: the page carries a positive claim that somebody re-read it, and the gate then
certifies that claim. A reader who trusts stamps cannot tell a page read this morning from one read
before the edits that changed what it says, and the whole currency mechanism — CUR-3, CUR-4, and every
`Known-open` row and invariant a stamped sheet carries — rests on the line meaning what it says.

**Measured on 2026-08-26 against `docs/backend/spec.md`:** its stamp line moved once part-way along a
branch and then stood unchanged while further commits edited the page, one of them revising the page's
own citations, with `scripts/check_docs.py` reporting no stamp finding on any run in between.
`docs/_roadmap/open-items.md` on the same branch took an edit that moved its stamp not at all, cleared
by the same comparison because an earlier commit had already moved it.

**It bites hardest on the branch that needs it most** — a long one, carrying many documentation edits,
by more than one hand. The unverified debt grows with every edit after the first restamp while the
check's grip does not, so the branches where re-verification matters are the branches it protects
least.

**`:: check_branch_impact` decides its question the same way, so the same hole runs through both arms
of CUR-4.** A stamped page whose cited files materially changed must restamp, and that requirement
ends in the identical fork-versus-working-tree comparison of the stamp line. One restamp early on a
branch therefore also discharges every material change afterwards to every file that page cites. **A
repair touching only the freshness check leaves the citation arm open.**

**Why the fixture net cannot see it.** `scripts/tests/test_check_docs.py :: _build` commits the corpus
and every plant is a working-tree edit on top, with the fixture repository's base ref and `HEAD` the
same commit — so a branch whose fork sits behind several commits, which is the one shape that breaks
the check, cannot be planted in that harness at all. And `:: _restamp` moves the date and leaves the
SHA, so the suite's own idea of a restamped page is the weakest thing that satisfies the rule. **The
fix lands with a harness that can hold a branch**, and that is the larger half of the work.

**The candidate shapes, and what each costs.**

- **Compare the page against its content at the commit the stamp names.** This is what a stamp
  literally claims, and it cannot be built: the branch's own uncommitted edit sits in the working tree
  by construction, so the page never equals its stamped commit and the check would fail on every run.
  That is why the rule is a movement rule rather than an equality one, and any proposal has to stay
  one.
- **Walk the commits**, comparing the stamp at each commit that touched the page against the same line
  at its parent. It closes the hole exactly, and its remedy is a rebase: a commit already made without
  moving its stamp cannot be repaired from the working tree, so the check would ask for history to be
  rewritten before it cleared. CUR-4's own `Why` names where that ends — a check that cries wolf gets
  suppressed. The process cost is the smaller objection and it is still real, a blob read per commit
  per page on a check that runs at every gate invocation. The closed `OPS-38` records a neighbouring
  gap as reachable only from an intermediate checkout; that limit does not carry here, a stamp line
  being one blob rather than a whole tree.
- **Require the stamp not to predate the page's newest committed edit on the branch.** The remedy
  stays in the working tree — restamp, and it clears — and the cost is one `git rev-list` and one
  ancestry test per changed stamped page, scaling with pages rather than with commits against pages.
  What it cannot reach is the edit sitting uncommitted when the gate runs, a stamp being unable to
  name the commit it rides in. Its guarantee is therefore that **the stamp is never older than the
  page's last committed edit**, with one commit's worth structurally out of reach. Stating that
  residual where the rule is written is part of the work.

**What the standard owes afterwards.** CUR-4's `Exceptions` block names a page added on the branch and
a stamp-only delta; whichever shape lands adds a clause beside them, and CUR-3's `Enforced by` — which
claims `stamp` covers a page edited on a branch moving its stamp — has to say what that now means.
CUR-5's table states the same comparison in its `stamp` and `branch-impact` rows, and
`check-registry` holds a row's name and its verdict but never its wording, so both rows are
rewritten by hand in that same commit.

**Not verified:** the process cost of walking the commits is reasoned from the call shape rather than
timed, and no reading of the gate's wall clock was taken for any of the shapes above.

**Why it ranks where it does.** Test 1 separates it from everything below it, **OPS-75** included. Both are
instruments, and OPS-75's own analysis records that the gate's verdict is right and only a caller
reproducing the helper by hand is misled — so nothing wrong reaches `main` through it. This one is the
verdict: the gate reports a page verified that nobody re-verified, and that record merges. The
population is every stamped page on every branch rather than one rule's hand measurements, and a
currency check that can be trusted is what the rest of the corpus's claims stand on. **OPS-82** is the
same failure in the same check reached by another route, and test 1 separates the two at its entry.

### 3 · OPS-82 — A citation written as a link arms no re-verification when what it names changes

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent — it blocks nothing and nothing blocks it. It changes what `branch-impact` arms
on, which is the trigger **DOC-4** records; it lands in `scripts/docs_gate/references.py` beside
**OPS-71**, the other entry there about what resolution proves; and **OPS-62** decides whether a change
to a file this would newly arm is material, the two halves being independent of one another.

**`scripts/docs_gate/branch.py :: check_branch_impact` builds a stamped page's watch list from
`scripts/docs_gate/references.py :: cited_paths`, and that function reads no markdown link.** It has
exactly two inputs: the file half of each `` `<file> :: <symbol>` `` citation, and every backticked
token, each handed to `scripts/docs_gate/kernel.py :: repo_path`.
`scripts/docs_gate/references.py :: LINK_RE`, the pattern that recognises a link, is read only by the
dead-link and dead-anchor arms of `:: check_file`. **So a page pointing at another file by linking to
it is armed by that pointer never** — not for a bare sibling, not for a subdirectory path, not for a
`../` one. A page is armed only where some backticked token on it independently spells a resolvable
repository path, which a link's own text does only when it is written out in full.

**What `repo_path` does with the tokens that do reach it.** One beginning with an entry of
`scripts/docs_gate/kernel.py :: REPO_PREFIXES` and present on disk resolves as written, and one holding
a `/` that exists under `fl_frontend/` or `fl_backend/` resolves against that root. Three shapes are
refused before any existence test — a leading `/`, a leading `./`, and any token containing `..` — and
a token with no `/` at all returns nothing, so `` `tooling-items.md` `` arms nothing even backticked.
Those refusals are right for a token in prose, where a repository path should be written as one. They
are also why handing a link target to the same function is the wrong repair: from `docs/_git/spec.md`,
`../ops/spec.md` is the only correct spelling there is.

**The demonstration sits in `docs/_roadmap/closed-items.md`.** That page points at this one as
``[`tooling-items.md`](tooling-items.md)``, and it names `docs/ops/spec.md` once, inside the
past-tense description of the retired `OPS-48` row. Only the second is a backticked repository path, so
on a branch changing both files it is a retired row's prose that asks the page to be re-verified, and
the live pointer to the ranked page it indexes that asks for nothing.

**Measured over the tracked markdown corpus on 2026-08-26** — every link target resolved from its own
page's directory, kept where it lands on a tracked file, with `scripts/docs_gate/kernel.py :: SKIP_DIRS`
applied and the template pages left out, `link` being one of the checks
`scripts/docs_gate/kernel.py :: TEMPLATE_EXEMPT_CHECKS` already holds them out of: 28 pages carry a
stamp, and those hold 113 distinct page-and-target pairs. **75 of the 113, across 23 of the 28 pages, name a file that page's own `cited_paths` set does not hold**, so a branch
changing that file leaves that page unarmed. Under `docs/_standard/` every such pair is one of them;
under `docs/_roadmap/`, twelve of twenty-six. The 38 that do arm are armed by a backticked repository
path elsewhere on the page happening to name the same file, which is incidental rather than the link
working.

**How this and OPS-80 compound.** They are the two ways `branch-impact` stays silent about a stamped
page whose cited file moved, and they hold different populations: what this drops is never armed, on
any branch, while what **OPS-80** clears is armed once and then never again for the rest of that
branch. Repairing either leaves the other's population exactly where it was. **DOC-4** sits outside
both — a page outside `STAMP_REQUIRED_GLOBS` carries no stamp, so this check never reaches it to be
silent about.

**The repair, and the one thing it must not loosen.** `:: check_file`'s link arm already resolves a
target as a reader would and already proves it exists, so the resolution needed is in the same module
and already reaches the spellings `repo_path` refuses. What `cited_paths` needs on top is the
repository-relative posix spelling — `check_branch_impact` intersects its result with a set of git
listings — and a refusal for a target resolving outside `REPO_ROOT`. **`repo_path`'s own refusals stay
exactly as they are for the backtick route**, because loosening them for both would let a `../` written
in prose resolve, which is what they exist to stop. A target naming a directory or resolving to nothing
adds nothing: the dead-link arm already owns the second, and one defect must yield one finding.

**What it costs, stated rather than discovered afterwards.** Arming those 75 pairs is the point and is
also more pages asked to restamp per branch, which is **OPS-62**'s objection over a larger population.
The fixture net needs a page armed through a link of each of the three shapes the corpus uses, and one
whose link target sits outside the repository.

**Why it ranks where it does.** Test 1 puts it above everything below it for the reason **OPS-75**'s entry
gives when it puts **OPS-80** above itself: this is the gate's own verdict rather than a hand
reproduction of one, so what it misses merges. The same test puts **OPS-80** above this one — that
disarms both arms of CUR-4, the arm watching a page's own edits included, which this leaves working,
and on a branch that has already restamped a page, repairing `cited_paths` buys that page nothing until
OPS-80 lands. Neither waits on the other, and OPS-75's `Path` line records why they should not ride on
one branch.

### 4 · OPS-75 — The gate's comment reader deletes the blocks it most often measures

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent of every entry here, and it should land **before** anything else on this page is
measured or verified. The unclosed programmes DOC-11 is about carry verification claims made with the
narrow call, so landing this first makes them cheaper to re-verify — an ordering preference, and not
something DOC-11 waits on. **OPS-80** and **OPS-82** rank above it and are the same kind of change;
none waits on another, and landing two of them on one branch would leave each verified by the other's
untested state.

**`scripts/docs_gate/structure.py :: comment_runs` takes a keyword-only `symbol_docs` with no default,
and passing it false does not filter symbol docs out of a result — it drops them before the result
exists.** The block arm sets its `keeping` flag from `symbol_docs` or the absence of a `/**` opener, so
for a `/**` opener under the narrow call nothing is appended to the run and the closing flush never
fires. **The block yields no run at all.** A plain `/*` block survives the same call, a `//` run
survives, and a Python docstring is dropped the same way its JSDoc counterpart is. So the one call that
reads like "measure the ordinary comments" returns a list with an entire comment shape missing and no
signal that anything was dropped.

**The gate itself is correct, and that is what hides it.** `:: check_comment_length` calls the helper
twice: once narrow, purely to learn which runs are inline — that result is reduced to a set of
identities and never measured — and once wide, which is the pass that measures. Both bounds are applied
to the wide list. So the check has never been wrong; only a caller reproducing it by hand has.

**The blocks it hides are the ones most likely to need the work.** `/** */` is where an author writes
at length — a module's exported functions, a component's props, a rule's reasoning — so the dropped
shape and the shape that breaks a bound are the same shape. A measurement over the narrow list is
therefore not merely incomplete; it is systematically blind in the one direction that matters.
Sweeping `fl_frontend/src` with both calls on 2026-08-25 found blocks over INC-9's character bound that
the narrow call does not return at all.

**The cost is a class of verification claim, not a defect in the product.** Sessions have reported
INC-9 clean, measured with this helper, while the gate held violations open. The repository carries its
own instances of the pattern: the unclosed audit programmes under `docs/audit/` cite the narrow call
inside a verdict and record INC-9 as "measured with the gate's own `comment_runs`" without saying which
call.

**Two things make it a tooling entry rather than a code one.** The docstring — "Markers come off, being
what the bounds do not measure. The header is skipped either way" — describes the marker handling and
says nothing about the drop. And the parameter reads as a filter: false parses as "without symbol
docs", which is what a caller wants when measuring inline comments, and is not what it does.

**The fix has to make the drop unrepresentable, and most of the obvious candidates do not.** A default
of true moves the trap without removing it, because the narrow call stays callable and stays silent. A
rename and a docstring warning are documentation over a machine-readable hazard, and this failure
survived a docstring once already. **The shape that closes it is to return every run tagged with its
kind** — inline or symbol doc — and let the caller filter. The drop then cannot be requested,
`check_comment_length` loses its second call, and it also loses the identity set it currently uses to
re-derive a classification the helper already knew. `:: _misplaced_header`, the other caller, asks for
the wide list and simply ignores the tag.

**The test that would have caught it is one line of fixture.**
`scripts/tests/test_check_docs.py :: _plant_comment_bounds` plants a Python docstring, a hash block and
a JSX `{/* … */}` block for the comment bounds, and **no `/** … */` block at all** — so the single
shape the drop affects is the single shape the gate's own suite does not exercise, and no such block
appears anywhere else in that file. The fix lands with that fixture.

**Deliberately not fixed on the branch that found it**, and the reasoning belongs in the entry: this
gate is the instrument that branch is about to be verified with, and changing a measuring instrument
immediately before measuring with it puts the change and the measurement in the same unverified commit.
Landing it on its own branch, with the fixture, is what lets the next measurement be trusted.

**Why it ranks where it does.** Test 1 puts it above everything below it: nothing there makes later work
cheaper, safer and possible at all in the way a correct measuring instrument does, and every INC-9
claim made against the corpus until it lands is a claim nobody can rely on. The same test puts
**OPS-80** and **OPS-82** above it, those being the gate's own verdict rather than a hand reproduction
of it, so their failures reach `main` while these do not. Below all three sits **OPS-64**, whose cost of leaving it
undone is a live security exposure — a stronger fact, but not a leverage one, and OPS-64's own `Path`
line records that it is not startable by a session. So a reader working top to bottom cannot pick
OPS-64 up anyway, and putting startable instrument fixes above it costs OPS-64 nothing.

### 5 · OPS-64 — The whole API is on the internet, and the invariant one file away says it is not

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent of every entry here, and **not startable by a session**: two values in `.env`
decide whether the candidate below is safe or fatal, and `.claude/CLAUDE.md` §1 puts that file beyond
reading. I confirm both first. Its own branch, and a watched deploy — the last paragraph says why.
OPS-66 edits the same file and could ride that deploy.

**`nginx/prod.conf` carries `location /api { proxy_pass http://backend:8000; }`, and nothing narrows
it.** No `allow`, no `deny` and no `internal` appears anywhere in that file. `docker-compose.yml`
publishes ports on nginx alone — neither application service carries a `ports:` entry, and that
file's own header states the invariant in terms: only nginx publishes ports, the applications are
reachable solely from inside `frankfurtleague-net`, and "anything nginx does not route simply does
not exist for the internet". Both halves are true at once, and they do not agree. **The block is the
one thing standing between the intended architecture and the deployed one.**

**What it reaches is the whole versioned API, not the read half of it.** `fl_backend/app/main.py`
mounts `READ_ROUTERS` and `WRITE_ROUTERS` under the same `/api/v{API_VERSION}/` prefix, so a prefix
match on `/api` takes both. The reads guard at router level with
`fl_backend/app/core/security.py :: verify_access_base`; every mutation router guards with
`:: verify_access_admin`, `fl_backend/app/api/schiedsrichter/admin_router.py` being the shape they
share; `:: verify_access_system` covers `/system/is_ready` and `/system/info`. Each is one static
shared bearer compared with `secrets.compare_digest`, and all three sit on the public side of this
block. So the exposed surface is every endpoint the service has, **the ones that write included**,
and what separates the internet from them is a shared secret rather than a route that does not exist.

**Nothing the site does needs the block.** `API_URL` is declared in the `server` half of
`fl_frontend/src/core/config.ts :: frontend_config`, whose `client` object is empty, and
`fl_frontend/src/core/api.ts` opens with `import "server-only"` — so no browser is given the URL and
no bundle is given a key. `docker-compose.local.yml` sets `API_URL=http://backend:8000`, the Docker
network name, which is a call that never leaves the network. The three more specific blocks above it
— `= /api/client-error`, `/api/admin/` and `/api/auth` — proxy to Next rather than to FastAPI and are
public by design ([`docs/logging/spec.md`](../logging/spec.md)); a prefix match keeps them ahead of
this one, and none of them is what this entry is about.

**The sharpest consequence is that one key covers data of two different kinds.**
`fl_backend/app/api/schiedsrichter/schemas.py` carries `kontakt: FLKontakt` — an email address and a
telephone number — on a referee, and no public page renders it. It sits behind `verify_access_base`,
the same key as the fixtures and the league table every visitor is already shown. **The base key is
over-scoped**, and this block is what makes that matter: a key that protects nothing across most of
its surface is a key nobody handles as though it protects anything.

**The candidate fix is deleting that one block**, after which the backend has no route from the
internet and the keys become defence in depth rather than the only control. It stays a candidate
rather than a plan for the two reasons that follow, and the first of them is the larger.

**What stops it being a one-line deletion is that a documented remedy uses the block.**
[`docs/ops/spec.md`](../ops/spec.md) §3 answers the symptom "Uptime monitor shows green during a
backend outage" with "Monitor `GET /api/v0/system/is_live` through the edge instead" — and _through
the edge_ is this block. That path is deliberately unguarded:
`fl_backend/app/api/system/router.py` mounts at `/api/v{API_VERSION}/system` and `:: check_is_live`
declares no dependency, because the container healthcheck in `docker-compose.yml` calls it and a
liveness probe must not fail for a reason a restart cannot fix. **So the deletion removes an
operational recommendation, and CUR-2 makes settling that part of the same commit.** Two answers,
neither obviously right:

- **Drop the remedy** from `docs/ops/spec.md` §3. Then the only monitor available watches the edge's
  own status, which returns 200 while the backend is down — the exact failure that section exists to
  explain, restored by the change that closes the exposure.
- **Keep it, with an exact `location = /api/v0/system/is_live` block** ahead of the deletion. Then
  one endpoint stays public, chosen because it answers without a key and touches no database — and
  the version is pinned into `nginx/prod.conf` by hand, a third place after
  `fl_backend/app/core/config.py :: API_VERSION` and the healthcheck in `docker-compose.yml`, where
  §4 of that spec already records the hardcoded `/api/v0/` as open.

**This is the decision the entry is asking for**, and it is the larger half of the work: what the
site is willing to answer from the internet without a key, and what watches the backend once the
route it is watched through is gone.

**Two values decide whether the deletion is safe, and no session may read either.** Both live in
`.env`, which `.claude/CLAUDE.md` §1 puts off-limits to reading, summarising and every indirect route
alike — so this cannot be discharged from inside a session at any point, and **I confirm both before
the work starts**:

- **`API_URL`**, read by `fl_frontend/src/core/config.ts :: frontend_config`. The candidate holds
  only if production sets it to the internal `http://backend:8000`, the way
  `docker-compose.local.yml` does. If it is the public hostname instead, then every server-side read
  leaves the network and comes back through nginx, and deleting the block takes the site down.
- **`api_trusted_hosts`**, read by `fl_backend/app/core/config.py :: BackendConfig` and handed to
  `TrustedHostMiddleware` in `fl_backend/app/main.py`. nginx forwards `Host: $http_host`, so a
  request arriving through this block carries the public hostname while the frontend's own calls
  carry `backend:8000`. Whether that list holds the public hostname decides whether the exposed route
  answers at all today — the difference between an open hole and one already shut by a setting
  nothing records as the control.

**How it has to be worked, whichever way the design question goes.** It is an ops change, so the gate
is the full form with the images built ([`docs/ops/spec.md`](../ops/spec.md) §1.6). And an nginx
fault is not the class that fails a test: the config is mounted read-only, nginx waits on both
upstreams being healthy before it serves anything, and a bad block takes the site down rather than
turning something red. Its own branch, and `./scripts/deploy.sh --status` either side of a deploy
somebody is watching.

### 6 · OPS-84 — The linter runs a version past its end of life, and the documentation for it describes another

**Status:** Open\
**Surfaces:** FE, Ops, Docs\
**Effort:** M\
**Path:** Independent — it blocks nothing and nothing blocks it. It moves the tool **OPS-19** measures
and **OPS-65** asks a question of, so each of those is answered against whatever ships here rather than
ahead of it.

**eslint 9.x reached end of life on 2026-08-06, and `fl_frontend/package.json` declares `^9.39.5`.**
Confirmed on 2026-08-26 against eslint's own version-support page: v9 is listed as end of life rather
than in maintenance, v10 has been the current major since 2026-02-06, and 9.39.5 — published
2026-07-10 — is the newest 9.x release in eslint's release notes. **The caret range therefore spans a
line that will publish nothing further**, so `pnpm update` cannot move it and reports nothing that
would say it is frozen.

**The linter takes no further fix of any kind, security or otherwise.** What bounds that is where it
runs — the gate's frontend scope and a developer's machine, never the production image — so this is a
toolchain exposure rather than a product one. It is still the only check in the toolchain that can
catch some things at all: `fl_frontend/eslint.config.mjs`'s own comment beside
`better-tailwindcss/no-unknown-classes` records that tsc, the Prettier plugin and the browser each
accept an unresolvable class in silence. A defect in a frozen linter fails in the direction of passing.

**The consequence found in passing is the sharper one for anyone reading.** `eslint.org/docs/latest`
serves v10. `.claude/CLAUDE.md` §4 holds a reference authoritative only while it is official **and**
current, with the installed version in it as a documented release — and the current documentation does
not document 9.39.5. **So the repository's own reflex, reading the project's own docs, answers about a
major version this repository does not run**, with nothing in the reading to mark the gap. Until the
move lands, an eslint API claim here has to come from a version-pinned page or from the installed
package under `fl_frontend/node_modules`, and has to say which.

**What the move touches.** Flat configuration is already in use, which is the larger half of a v9-to-v10
migration already done: `fl_frontend/eslint.config.mjs` builds through `defineConfig` and
`globalIgnores`. What has to be checked one at a time is the plugin set's peer range against v10 —
`eslint-config-next`, `typescript-eslint` with its `@typescript-eslint` pair,
`eslint-plugin-better-tailwindcss` and `eslint-plugin-jsx-a11y` — because a plugin that has not moved
holds the whole upgrade, and one that has moved may carry a changed rule default under it.
[`docs/frontend/spec.md`](../frontend/spec.md) states what several of those rules are relied on for,
and is where a moved default lands.

**Not verified:** which v10 changes bite here. The migration guide was not read for this entry, so the
effort above is a shape rather than a measurement, and any rule whose name or default moved is
unenumerated.

**Why it ranks where it does.** Test 2 separates it from everything below it: the date has passed, and the
distance from the supported line widens on its own with nothing here watching it — the growing
migration that test names. It sits under **OPS-64** because test 2 asks which item gets worse with
time, and that one cannot: the exposure it records is already being paid at full rate. It sits under
the three above it on test 1, none of which this makes cheaper, safer or possible.

### 7 · OPS-67 — No component can be loaded by the frontend test runner, so no component test can be written

**Status:** Open\
**Surfaces:** FE, Ops, Docs\
**Effort:** M\
**Path:** Independent. Closing it invalidates [`docs/frontend/spec.md`](../frontend/spec.md) §1.9,
which states that there are no component tests, so that section moves in the same commit (CUR-2).

**[`docs/frontend/spec.md`](../frontend/spec.md) §1.9 states that there are no component tests, and a
stranger reads that as a gap in discipline. It is a gap in the toolchain.** The runner is Node's own,
driven through `pnpm test`, and nothing in that invocation transforms JSX — so a `.test.tsx` file
fails before its first assertion, and a `.test.ts` file fails the moment an import reaches an
application component, every one of those living in a `.tsx`.

**Measured on 2026-08-21 rather than inferred**, by driving the repository's own test invocation from
`fl_frontend/` over probe files written outside the tree, against the installed Node 26.3.0. Both
shapes die the same way:

```
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".tsx"
```

For the `.test.ts` probe the path that error names is the component's —
`fl_frontend/src/shared/components/ui/FLLogo.tsx` — rather than the test file's, which is what says
the wall is the extension of the module being loaded and not the shape of the test.

**`fl_frontend/tsconfig-alias-hook.mjs` cannot close it, and is not where the repair goes.** It registers a
`resolve` hook alone, so it answers where a specifier points and never how the file behind it is
read. A `load` hook is the half that is absent, and a transform to put behind it is absent from
`fl_frontend/package.json`, along with any DOM environment and any testing library. **So what closes
this is a devDependency and a hook rather than a test**, which is why no amount of discipline reaches
it and why the effort is a day or two rather than an afternoon.

**One test already renders the component library, and it imports no application code.**
`fl_frontend/src/shared/components/ui/requiredMarking.test.ts` puts real HeroUI through
`renderToStaticMarkup`, over a tree it composes itself from library primitives. It proves what the
library emits for a shape; it proves nothing about a component written here.

**No component is rendered by any test, and that is worth naming plainly rather than softening.** The
sweeps §1.9 describes read `.tsx` files as text or through the TypeScript checker, which is how a
rule no linter can express is held and says nothing about what a component renders — so no form the
write path puts on screen is exercised by running it. The logic inside those forms sits in `.ts` siblings
that each carry a test:
`fl_frontend/src/features/teams/components/forms/AdminTeamEditForm/fanOutNotes.ts` and
`fl_frontend/src/features/teams/components/forms/AdminTeamEditForm/banners.ts` are the pair to look
at, each with a `.test.ts` beside it while the `.tsx` consuming them has none. **That the split falls
exactly where the runner stops is the reading this entry takes**, and it is a reading rather than a
measurement: no comment in either file states it.

### 8 · OPS-76 — Most of the database tier runs against collections production would not accept

**Status:** Open\
**Surfaces:** BE, Ops\
**Effort:** M\
**Path:** Independent — it blocks nothing and nothing blocks it. It is one pass over the same fixtures
OPS-72 touches and the two are cheaper executed together, which is an ordering note and not a
dependency: the suite holding OPS-72's case is one of the few that already installs the constraints.

**Every shared database fixture yields a bare database, so unconstrained is the default rather than a
decision.** `fl_backend/tests/database.py :: a_clean_database` defaults `constraints` to `False` and
`fl_backend/tests/conftest.py :: mongo_database` applies nothing at all, so
`fl_backend/app/core/constraints.py :: apply_constraints` is opt-in per suite — and **most of the db
tier declines it.** Which suites take it is answered by grepping `fl_backend/tests/` for
`constraints=True`; the rest insert into collections that in production carry a `$jsonSchema`
validator and, for some, a unique index — so a document MongoDB would refuse on the server passes in
the tier meant to prove the server's behaviour.

**Some of those suites hold seeds the shipped validators would refuse outright**, found by comparing
literal seed dictionaries against the `required` tuples in
`fl_backend/app/core/constraints.py :: COLLECTION_VALIDATORS` rather than by running them:
`fl_backend/tests/api/test_spieler_write_execution.py` seeds a `saison_teams` row and a
`saison_spieler` row each missing required keys, and
`fl_backend/tests/api/test_spieltage_write_execution.py` seeds a `spiele` document missing more. **That
is a floor rather than a total** — the comparison sees only dictionary literals passed straight to an
insert, and most suites seed through factory helpers it cannot follow.

**Unconstrained is sometimes right, and the fix is not "constrain everything".**
`fl_backend/tests/core/test_constraints_execution.py :: on_a_database` already models the shape the
answer wants: constrained by default, with an explicit argument at each call that wants the
unconstrained database and a stated reason for it. So the answer is to make constrained the default the
shared fixture gives, and the exception an argument somebody has to write down. **The flip itself is
one line** — `a_clean_database`'s `constraints` default — which is why the work below is the seeds it
exposes rather than the plumbing.

**The cost is the reason this is ranked rather than fixed in passing.** Turning one suite constrained
costs more lines than it removes, because a seed written against no validator omits fields the shipped
one requires; a tier of that is a work package, and every seed it corrects is a seed that was quietly
describing a document the product cannot hold. **What it buys is that the database tier stops being
able to prove behaviour over impossible data** — which is the one thing that tier exists for.

### 9 · OPS-56 — The git subcommand stepper reads one `git`, on one line

**Status:** Open\
**Surfaces:** Ops\
**Effort:** S\
**Path:** Independent. One expression carries both halves below, so they are one repair and one
re-measurement of `scripts/selfcheck.sh` step 13.

**The stepper the two bash guards share opens on `${padded#*[ /]git?(.exe) }`, and that one
expression is short on two axes at once.** It strips to the **earliest** occurrence of the program
and reads the word after it, so a second `git` later in the same command is never looked at. And its
delimiter class holds a space and a slash but **no newline**, so a `git` beginning a second line is
not the `git` the strip looks for at all: `tr -s ' \t' ' '` collapses runs of spaces and tabs ahead
of it and leaves every other whitespace byte alone. Either way no subcommand is read, and no other
arm of the shared block has anything to match. That block is byte-identical in
`.claude/hooks/guard-branch-bash.sh` and `.claude/hooks/guard-standard-bash.sh`, so both
guards lose the same thing.

**Measured 2026-08-12 by driving both hooks against a throwaway repository whose HEAD is `main`, and
reproduced independently the same day.** On each axis, all thirteen shapes the stepper's own table
names — its twelve subcommands, plus `checkout` with a pathspec — are released in both the plain and
the `.exe` spelling, twenty-six probes of twenty-six each time. The rows worth reading are the
ordinary ones:

```
allowed   git add -A && git commit -m x
allowed   git status && git reset --hard
allowed   git fetch && git rebase main
allowed   cd fl_backend\ngit commit -am wip
allowed   set -e\ngit reset --hard
allowed   echo one\necho two\ngit commit -am wip
denied    git reset --hard
denied    git commit -am wip && git status
denied    ls && git commit -am wip
denied    git commit -am wip\necho done
```

**The four denials are the controls, and each closes a different explanation.** The write refuses
alone. It refuses when it is the first `git` rather than the second, so what the occurrence axis
moves is which `git` is read. **Only a `git` shadows a `git`** — `ls && git commit -am wip` and
`cat notes.md && git commit -am wip` are both denied, because the strip lands on the real one — so
the leading command has to be git itself carrying a subcommand off the write table, which makes
`git status &&`, `git log &&`, `git diff &&` and `git fetch &&` the reachable prefixes rather than
any chain at all. And with the write on the first line the stepper finds it, so what the delimiter
axis moves is position rather than content.

**What this releases is not an exotic spelling.** `git add -A && git commit -m x` is the most
ordinary two-command shape there is, and `git status && git reset --hard` runs the one command
`.claude/CLAUDE.md` §2 names as never to be run. The branch ruleset is not the control behind it
either: that blocks the _push_, while what escapes here is local destruction of the working tree —
`git reset --hard`, `git clean -fd`, `git stash`, `git checkout -- <path>` — which no ruleset covers.

**A tab does not do this, and the difference says where the delimiter boundary is.** `echo start`, a
tab, and `git commit -am wip` is denied, because `tr` has already turned that tab into a space; a
carriage return is squeezed by nothing and behaves as the newline does. The class is short by
exactly the whitespace `tr` does not reach.

**On the standard guard both shapes hide a write into `docs/_standard/`, and that guard already
disagrees with itself about the newline.** Its interpreter arm is spelled with `[[:space:]]`, which a
newline satisfies, and the stepper above it is not:

```
asked     echo start\npython restamp.py docs/_standard/rules-index.md
allowed   echo start\ngit checkout -- docs/_standard/rules-index.md
allowed   git status && git checkout -- docs/_standard/rules-index.md
```

That guard runs on **every** branch, so neither half of this finding is bounded by `main`.

**Why it is filed rather than already fixed, and why as one entry.** The delimiter half is a
character-class edit, `[ /]` to `[[:space:]/]`, and it makes the standard guard's two arms agree. The
occurrence half is a walk over every occurrence in place of one strip — more code in a block that has
to stay byte-identical across two guards. Both sit inside the sentinel block `scripts/selfcheck.sh`
step 9 byte-compares, so each lands in both guards or in neither, and both move verdicts, so step
13's matrix is a re-measurement afterwards rather than a re-run. **Repairing them apart would measure
that matrix twice for one line of code**, which is why they are one entry.

**A sibling of OPS-29** — each a control reading one spelling of a thing that has several. The
distinction to hold on to is that the subcommand table here is complete and the stepper never
reaches it, which is the opposite of a guard whose vocabulary is genuinely short of a shape.

### 10 · OPS-71 — A citation is proved by a substring, so one that resolves to the wrong thing passes

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent of DOC-2 and DOC-3, which are about what the standard claims and what a discovery
pattern reaches; this is about what resolution proves.

**`scripts/docs_gate/references.py :: _check_citation` ends by testing whether the anchor appears
anywhere in the cited file.** That proves the anchor's characters are somewhere in the file it names,
and nothing more. For a `<file> :: <symbol>` citation over source that is usually enough, because a
symbol name is long and distinctive. **For an invariant it is not**: an invariant id resolves against a
sheet that mentions it anywhere at all — in another invariant's prose, in a §1.1 table cell, in §3's
remedy table — whether or not the sheet defines an invariant by that number, and whether or not that
invariant means what the citing page says it means. **The live demonstration is already in the corpus:**
`docs/frontend/spec.md` defines no invariant in the forties and mentions backend invariants from that
range in its prose, so a citation naming that sheet and one of those ids
resolves cleanly against a definition it does not hold.

**Two failure modes, and the second is the dangerous one.** The first is containment: a shorter id is a
substring of a longer one, so a citation to an invariant a sheet does not define passes as long as one
starting with the same digits does. The second is collision: a new invariant given a number the sheet
already uses resolves perfectly, from both directions, while the sheet now defines one number twice.
**Nothing detects the duplicate either.** `scripts/docs_gate/perkind.py :: invariant_ids` walks
`:: INVARIANT_ROW_RE` over every sheet and appends a sheet to an id's home list only where the sheet is
not already in it, so a sheet defining one id in two rows is indistinguishable from a sheet defining it
once.

**The machinery to close both already exists and is already passed in.** `scripts/docs_gate/run.py`
computes the invariant homes and hands them to the per-file check, which uses them for
`scripts/docs_gate/references.py :: check_invariant_citations` — the comments-only check for an id two
sheets define. **What is missing is the same resolution for the citation form**: where a citation's
anchor is exactly an invariant id, require the cited sheet to be among that id's homes rather than
testing for a substring, and report a duplicate row within one sheet as a finding of its own. Both are
small changes in files that already hold the data.

**One thing to get right.** The general substring test has to stay for symbols, because a source file
has no index the gate could resolve a function name against. So this narrows the check for one anchor
shape rather than replacing it, and `scripts/docs_gate/references.py :: INVARIANT_CITE_RE` is the
pattern that already recognises that shape.

### 11 · DOC-12 — A spec sheet's Known-open table has no membership test, so nothing can be missing from it

**Status:** Open\
**Surfaces:** Docs\
**Effort:** S\
**Path:** Independent. It decides what `.claude/commands/roadmap/add.md`'s indexing step is asking
for, so every filing after it is checkable and none before it is. **DOC-11** is the neighbouring
question of where a finding lives at all; this is the question of what points at one once it is filed.

**`.claude/commands/roadmap/add.md` and `.claude/commands/roadmap/start.md` both require a new or
closing entry's id to be carried in the `## 4. Known-open` table of the spec sheet for each surface it
names.** Neither states which entries such a table holds, so the requirement has no test: a row absent
from one is an omission or a deliberate exclusion, and nothing in the corpus lets a reader tell those
apart.

**Measured on 2026-08-26 over both ranked pages.** Their 85 open entries yield 108 pairs of entry and
surface where the surface owns a spec sheet. **Thirteen of the 108 are carried in the matching table
and 95 are not** — 33 absent from `docs/backend/spec.md`, 32 from `docs/ops/spec.md`, 30 from
`docs/frontend/spec.md`. At that spread the requirement cannot be read as a list of omissions: taken
literally it is unmet almost everywhere at once, and discharging it would take each of those three
tables to several times its size and make it a second copy of the ranked page.

**Six entries have no target for the requirement at all.** `DOC-2`, `DOC-3`, `DOC-4`, `DOC-9`,
`DOC-11` and `FB-20` name only `Docs`, which owns no spec sheet — and so does this entry, which is
the same gap showing through the thing that records it.

**One written source does speak, and it asks something narrower than the requirement does.**
[`docs/_standard/templates/spec-sheet.md`](../_standard/templates/spec-sheet.md) describes the section
as accepted gaps, each with what owns it, set down there so a known limitation never reads as an
oversight and gets "fixed". **That is a purpose addressed to a reader rather than a membership test**:
it asks whether somebody standing at this sheet would mistake this gap for a defect, which is a
judgement a session makes rather than a rule it applies. It is also the only such statement there is.
OUT-4 fixes the four sections and constrains the contents of section 2 alone, and **no sheet carries a
sentence under its own `## 4.` heading** — each goes straight from the heading to the table, so the
template's guidance is copied from rather than read beside the rows.

**The two sources also disagree about the column, and the corpus does three things.** The template's
`#` holds an ordinal and puts the roadmap id in `State`, while both commands place the id in `#`.
`docs/logging/spec.md` numbers its rows and names no roadmap id; `docs/_git/spec.md` carries no `#`
column; the other three mix an em dash, for a gap no entry owns, against an id where one exists.
PRE-1's ladder settles this half — the standard outranks a command file — and it settles nothing about
membership, the template offering a purpose where the requirement needs a test.

**What the work is, and what it is not.** Decide what the table is for, write it where both a sheet's
reader and a filing session meet it, and make the requirement say the same thing. **A sweep comes only
after that**, and it is separable: adding rows before the criterion exists is guesswork. The em-dash
rows already there — a handler body with no direct test, a manual registry prune — are the evidence
that the table has held things the ranked pages never did.

**Not verified:** whether a check could read the criterion once it is written. The gate resolves a
roadmap id and a table's shape; whether it can decide membership depends on what the criterion turns
out to be, which is downstream of the decision rather than an input to it.

**Why it ranks where it does.** Tests 1 to 3 leave it among the entries around it: nothing ships wrong, no date
has passed, and what accumulates is one unanswerable pair per filing rather than work to redo. **Test 4
places it** — one decision retires a requirement that is unverifiable at 95 places today, and that
decision is the whole of the S, the sweep it authorises being separate work. It sits above **DOC-11**,
which costs an M and a programme closed with me to reach a gain of the same kind.

### 12 · DOC-11 — Audit programmes are left open, and their findings sit outside the ranked pages

**Status:** Open\
**Surfaces:** Docs\
**Effort:** M\
**Path:** Independent. `/audit:finish` is the command that performs it, and it closes a programme with
me rather than alone.

**`docs/_roadmap/README.md` divides the world in two — a defect under active remediation is a ledger row
under `docs/audit/`, and everything else is a ranked entry here — and an unclosed programme is a third
place, holding rows that are neither.** Read on 2026-08-26, that folder holds several programme
artefacts and none has been closed; one carries a state page naming a branch that has long since
merged, and one deferred-findings ledger still marks rows open that are ranked nowhere. `/audit:status`
reports the state and `/audit:finish` is what ends it.

**The programme does re-verify a finding when somebody picks it up, and that is the evidence for the
entry rather than against it.** One deferred row records that its finding moved, that the hand-copies
it named are now different ones, and that the fix as written does not apply to the code as it stands.
So the
mechanism works — it only runs when somebody looks, and nothing makes anybody look.

**The reports age against the code in ways no check can catch.** One inventory attributes a German
sentence to a component whose name has since changed and whose sentence has since been replaced,
because it was a false absolute. **Nothing in the gate reaches either half**: a bare component name in a
table cell matches no repository prefix, so the path check never sees it, and a quoted German sentence
is uncheckable by any mechanism the repository has or could have. That is not an argument for a new
check; it is the argument for closing a programme rather than leaving its reports standing.

**What closing costs, and why it is ranked here.** `/audit:finish` writes the final report and clears
the folder with me. The work before that is the part with judgement in it: every row still open is
either rehomed as a ranked entry, folded into an existing one, or recorded as answered — and some will
turn out to be settled already by a `.claude/CLAUDE.md` §7 line written after the row. **The cost of
delay is what ranks it** — each week the reports describe the code less accurately, and each finding
rehomed late is one somebody re-derives from a stale citation first.

**What this entry deliberately does not do** (COR-9): name a row, a file or an id inside `docs/audit/`.
Git ignores that folder and `/audit:finish` clears it, so an identifier from inside it resolves for
nobody else and would be a pointer to a file deleted by design (COR-1). The observation above is dated
and the folder is where the work happens; the entry is written so it survives the folder.

### 13 · OPS-78 — The local edge claims to mirror production, and nothing reads either half of the claim

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent of every entry here. FB-17 on [`open-items.md`](open-items.md) is what makes it
timely rather than what blocks it: that entry owns the question of what rate limit its public write
should carry, and both public writes that exist take theirs through an exact-match `location` of
their own — so the edit lands in both files or in neither, and nothing would say which. An ordering
preference across pages, and a dependency in neither direction.

**`nginx/local.conf` opens by claiming the same routing, rate limits and security headers as
`nginx/prod.conf`, and its `/api/admin/` block says it must stay identical to production's or the
local stack cannot catch a routing mistake — and nothing checks either sentence.** `scripts/verify.sh`
runs `nginx -t` in its ops scope against `nginx/prod.conf` alone, so the local config is not merely
uncompared: it is never parsed. A typo in it passes the gate and surfaces when somebody runs
`./scripts/local.sh`. `scripts/check_compose_mirror.py` compares `docker-compose.yml` against
`docker-compose.local.yml` and stops there; the two nginx files appear in it only as the mount paths
`:: DECLARED_DELTAS` names as an allowed difference. The checker knows both files exist, knows they
deliberately differ, and reads neither.

**The argument for the check that exists is the argument for the missing one.** The step in
`scripts/verify.sh` that runs the compose comparison reasons at the line that both files parse
whatever they say, so nothing else holds the local stack to production's shape and a setting
production gains and local does not is a difference local can never catch. That sentence is true of
the nginx pair word for word, and the pair it was written for is the one that got a checker.

**What the gap costs is the value of every local verification.** `.claude/CLAUDE.md` §5 requires a
browser check against the local stack rather than a dev server, on the grounds that `next dev`
exercises neither the standalone build nor nginx. That holds only while the nginx the local stack
mounts is the nginx production runs. A `location` block, a `limit_req` zone, a header or a
`proxy_pass` target added on one side alone makes the local stack a rehearsal of a configuration
nobody deploys — and the two directions fail differently. A block present in production and missing
locally shows up at the desk as a route that works on the server; a block present locally and missing
in production shows up in production.

**The two files agree today**, which is what makes this a guard rather than a repair. Both declare
the same two rate-limit zones at the same rates, apply the same burst to the same two exact-match
locations, and carry the same `location` set beneath the TLS and host-redirect blocks production
needs and local has no use for.

**Where the answer is not the compose checker's.** A byte comparison is wrong: the deliberate
differences are real and `nginx/local.conf`'s own header names them — no TLS, no `www` redirect, a
421 catch-all where production rejects the handshake. What `scripts/check_compose_mirror.py` does
instead is parse both files, compare at a declared grain and carry the allowed differences as a list
with a reason on each. nginx has no parser in this toolchain, so the equivalent is a directive-level
reader for the subset the two files actually use — `location` paths, `limit_req_zone` names and
rates, `proxy_pass` targets, the `add_header` set — built against the same kernel the other checkers
share. **A second `nginx -t` over `local.conf` is a different question and a much cheaper one**: it
proves the file parses and proves nothing about the pair. Both are worth having, and that one is the
half that could ship on its own.

### 14 · OPS-70 — Two db-tier runs at once fail in a way that names nothing

**Status:** Open\
**Surfaces:** Ops\
**Effort:** M — the diagnosis below is the work, and the repair is small once the mechanism is known\
**Path:** Independent. `fl_backend/tests/conftest.py` holds the fixtures an answer lands in, and `scripts/verify.sh`'s db step is what a refusal would sit in front of.

**Starting `./scripts/verify.sh --db` while a `pytest -m db` is already running produces a wall of
unrelated failures, and nothing in the output says why.** Observed on 2026-08-22: one run reported 147
failed and 71 errors, while two immediately subsequent runs of the identical command, with nothing
else changed, reported 411 passed. The failures land on validators and unique indexes, which
`fl_backend/tests/core/test_constraints_execution.py` applies to the database it is given — so the
first reading available to whoever hits it is that their own change broke the schema.

**What it costs is a wrong conclusion rather than a wait.** The gate is the evidence a branch rests
on, and a db-tier result anything running beside it can corrupt is a result nobody can quote —
including a green one, which is the half that does not announce itself. A loud but misleading failure
is the expensive direction, the same asymmetry OPS-11 argues from.

**What is established about the harness, and what is not.** Almost every db-marked suite names its own
database — `fl_backend/tests/core/test_constraints_execution.py :: DATABASE_NAME` is
`fl_constraints_test`, and nearly every sibling suite carries a distinct one — so the suites do not
collide with one another. **The exception is worth eliminating first**: the suites seeding through
pymongo rather than Motor take their name from `fl_backend/tests/config.py :: build_test_config`'s
`db_base_name`, so they share one database within a run and would share it across two. `fl_test`,
which `fl_backend/tests/conftest.py :: mongo_database` hands out, is a second such name, and the
partition its sharers keep to is recorded at `fl_backend/tests/api/conftest.py :: league`.
`fl_backend/tests/conftest.py :: mongo_container` and `:: mongo_replica_set_url` are
session-scoped and each starts its own `mongo:8` through testcontainers, with no reuse flag set
anywhere in the tree, so two runs are not obviously sharing a database either. **The mechanism is
therefore unestablished, and finding it is the first half of this entry**, ahead of choosing a repair.
What to eliminate, in order: testcontainers' Ryuk reaper, which is one container per Docker host and
removes on a reconnection timeout; contention on the Docker daemon while two runs each pull an image,
start a container and elect a single-node replica set; and any fixture reaching a fixed address rather
than a container's mapped port.

**What the answers look like once it is known.** A database name carrying the run's own identity, a
lock that makes the second run wait, or a check that refuses to start while another run holds whatever
the collision is over. Only the last keeps a single result trustworthy without changing what the
suites do, and it is also the only one that says out loud what happened.

**One observation the diagnosis may want, carrying its own denominator.** Across 25 db-tier rounds on
2026-08-26 — twelve run beside the rest of the gate, seven alone, the remainder under a full-form
run — one round failed two tests on `pymongo.errors.AutoReconnect: connection pool paused`, a failed
connect to the container's published port. **It is not attributed and it is not evidence of a flaky
tier**, which one occurrence in 25 does not support; the controls point away from load, the tier alone
having been green six times and the full gate seven under heavier contention. It sits here because a
failed connect to a mapped port is a data point against two of the candidates listed above, and
because an unrepeated symptom is worth having written down when the mechanism is finally chased.

**Not measured:** whether the collision can reach CI at all. `.github/workflows/verify.yml` runs one
`verify.sh` scope per job and each job takes its own runner, so two db-tier runs would have to land on
one host — which a hosted runner is not.

### 15 · OPS-73 — A copy test compares source text against a literal its own author typed

**Status:** Open\
**Surfaces:** FE, Ops, Docs\
**Effort:** M\
**Path:** Independent of **OPS-67**, and the distinction matters: OPS-67 is that no component can be
loaded, so no component test can be written. This is that the tests written instead assert against no
authority, which a DOM runner would not change.

**Some of the frontend's test files read source with `readFileSync`, and they fall into two kinds that
the spec describes as one.** `docs/frontend/spec.md` §1.9 calls them "tests that sweep the source tree
rather than exercise a function" and says that is how a rule no linter can express is held. **For some
of them that is exactly right.** `fl_frontend/src/core/apiContract.test.ts` and `:: apiRequests.test.ts`
compare the tree against `fl_backend/openapi.json`;
`fl_frontend/src/features/saisons/actions.test.ts` requires every refusal code
`fl_frontend/src/core/refusalRegister.ts :: declaredCodes` reads out of
`fl_backend/app/core/domain.py` to reach a `case` in the German mapper;
`fl_frontend/src/core/refusalPaths.test.ts` and
`fl_frontend/src/shared/components/ui/formSubmit.test.ts` hold structural rules across the tree. **Each
of those has an authority somewhere other than the test.**

**The other kind regexes a component's German out of its own `.tsx` and asserts that it matches a
literal.** `fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/teamErsatz.test.ts`
is the clearest, along with `:: undrawSpielplan.test.ts`, `:: spielplanReplace.test.ts` and
`:: oneWayGuards.test.ts`. A test of that kind can only restate what its author believed when they
wrote the component, in the same commit, and it then defends that belief against every later reader.

**Demonstrated rather than hypothesised.** The replacement panel's own copy test once required the
panel to say a replaced club's players were _stillgelegt_ and forbade _ausgetragen_, under a comment
arguing that wording it as a removal would mislead. **Both halves were the wrong way round**: the
endpoint stamps `saison_spieler` and touches no `spieler` document, so the forbidden word was the
correct one. The suite was green throughout, and the test was what would have had to be edited before
the defect could be fixed. FB-21 on `open-items.md` is the field name that drifted for the same missing
declaration.

**A DOM runner does not close it, which is why this is not OPS-67.** Rendering the panel and asserting
on the rendered text would fail in precisely the same way, because the fault is in what the assertion
compares against, not in how it reads the component. **What closes it is an authority for the vocabulary
and a test that reads it** — the pair of verbs declared once in `docs/glossary.md`, which today
describes `inactive_since` as "the day something left" for every subject and fixes no German for any of
them; and the consequential sentences composed by an exported function, as
`fl_frontend/src/features/teams/utils.ts :: describeReplacementUmfang` and
`fl_frontend/src/features/saisons/utils.ts :: describeSpielplanUmfang` already are, so the assertion is
over a value rather than over a file's bytes.

**What the answer must not be.** A rule banning the shape outright: several of these tests hold the only
line there is under a real rule, and `docs/frontend/spec.md` §1.9 is right that a sweep is how a rule no
linter can express is held. **The line to draw is the authority, not the mechanism** — a sweep that
compares the tree against something outside itself is sound, and one that compares it against a literal
in the same commit is a note about intent wearing a test's clothes.

### 16 · OPS-61 — The commit hook builds its scratch at a path git cannot open

**Status:** Open\
**Surfaces:** Ops\
**Effort:** S\
**Path:** Independent. One line, and the idiom it needs is already written in `scripts/verify.sh` and
`scripts/selfcheck.sh`.

**`.githooks/pre-commit` takes its working directory from `mktemp -d`, which on Git Bash answers
with the MSYS alias `/tmp/tmp.XXXXXX`.** The hook then hands that path to `git hash-object -w`, and
Git for Windows cannot open it from a worktree — so the commit dies after prettier has already
reformatted and re-staged the files, leaving the index written and the commit unmade.

**Measured on 2026-08-12**, committing a merge resolution inside a worktree under
`.claude/worktrees/`:

```
pre-commit hook: prettier reformatted 3 file(s); staging them from the index:
fatal: could not open '/tmp/tmp.ax2X4kHqIt/formatted' for reading: No such file or directory
```

`mktemp -d` answered `/tmp/tmp.dcSn130oAT`; exporting `TMPDIR` to the Windows-native temporary
directory made the same commit succeed on the next attempt with nothing else changed. **That is the
whole diagnosis and the whole fix.**

**It fails loudly, which is the right direction, and it still blocks work** — a commit cannot be
made at all from a worktree until the caller happens to know about `TMPDIR`. The main checkout is
unaffected, which is why the ordinary commit path never shows it.

**The repair is `cygpath -w`**, which resolves the alias, and it is already how `scripts/verify.sh`
spells the pool's own shell and how `scripts/selfcheck.sh` builds its container bind. Every place
that hands a POSIX-looking path to a Windows binary owes the same resolution, so it is worth deciding
whether they should share one helper rather than a spelling each.

### 17 · OPS-79 — A projection and the predicate reading it are coupled in one direction, and the open one fails quietly

**Status:** Open\
**Surfaces:** BE, Ops\
**Effort:** M\
**Path:** Independent. It is a third direction over a pair that
`fl_backend/tests/core/test_write_shapes.py` and `fl_backend/tests/api/test_spielplan_refusal.py`
already guard, and neither of those has to move for it to land. Distinct from OPS-74, which is one
message guarded on one side of a language boundary rather than one coupling guarded in one direction.

**`fl_backend/app/api/saisons/services.py :: RECORDED_FACT_FIELDS` is the projection that decides
whether a season's draw may be destroyed, and the couplings around it are guarded unevenly.** It is
what `fl_backend/app/api/saisons/admin_router.py :: generate_spielplan` and `:: undraw_spielplan`
fetch, and `:: holds_a_recorded_fact` is what reads the result to answer `REQ-SPIELPLAN-005` and
`REQ-SPIELPLAN-006` — whether anything has been entered against a fixture since the draw wrote it.

| The direction                                                                    | Held by                                                                                                                |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Every field the fixture patch writes is in the projection, or named as no record | `fl_backend/tests/core/test_write_shapes.py :: TestEveryFieldAPatchWritesIsWeighedOrNamed`, against `:: NOT_A_RECORD`  |
| Every path in the projection is read by the predicate                            | `fl_backend/tests/api/test_spielplan_refusal.py :: TestWhatCountsAsRecordedAgainstAFixture`, a case per projected path |
| Every key the predicate reads is fetched by the projection                       | **Nothing**                                                                                                            |

**The open direction is the one that fails silently, and it fails toward destruction.** A predicate
that began reading a key the projection does not fetch would see `None` on every fixture every time:
in production the driver returns the projected keys and nothing else, and in the test the fixture
_is_ a projection document. No assertion fails, because the branch never fires. The author believes
the window closes on that field and it does not, and what stands on the far side of the window is a
replace that deletes every matchday and fixture the season holds. The guarded direction's failure is
the harmless one by comparison — a projected field nobody reads costs a wasted fetch.

**The obvious guard is refused, and that refusal is the whole difficulty.** The mechanism available
is an AST sweep of the two functions for the string constants they subscript, which is the technique
`fl_backend/tests/core/test_write_shapes.py :: _model_copy_keys` already uses — and its limitation is
the one that bites here: it sees `ast.Constant` and nothing else.
`fl_backend/app/api/saisons/services.py :: _a_side_is_off_the_draw` composes both bracket-source keys
as `f"{slot}_quelle"`, so a constant sweep misses both and needs an allowlist to compensate. **An
allowlist is exactly the fragility the guarded direction was built without**: that test's fixture is
the projection document, so it needs no second list to stay true. Adding one here would trade a guard
that cannot go stale for one that can, which is worse than the gap it closes.

**Which is why this is a decision rather than a chore.** The clean closure is to stop composing those
two keys — spell them as constants beside the projection, and a sweep needs no allowlist at all. That
is a small edit to production code made to serve a test, and a trade worth stating out loud rather
than making quietly. The alternative is to accept the direction as open and say so in the predicate's
own docstring, so the next author reads the constraint where the code is rather than inferring it
from the guards around it.

**What is already answered, so the gap is not overstated.**
`fl_backend/tests/core/test_write_shapes.py :: NOT_A_RECORD` names `datum` and `uhrzeit` as what a
save may move while nothing counts as recorded, so those two are covered by name. Every key
`:: holds_a_recorded_fact` and `:: _a_side_is_off_the_draw` read today is fetched by the projection.
The gap is that nothing holds them to it.

### 18 · OPS-62 — A version pin bump arms every stamped page citing that workflow

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent. One classifier arm and a fixture pair; arguing the third immateriality test is
the larger half. **OPS-80** changes the stamp comparison in the same check, and the two halves are
independent of one another.

**`branch-impact` (CUR-4) fires on any change to a cited file, and a bot cannot answer it.** A
Dependabot pull request bumping a pinned action changes a workflow, so every stamped page citing that
workflow is asked to re-verify and restamp — work Dependabot has no way to do. Measured on
2026-08-12 against PR #108, which moves `github/codeql-action` from v4.37.4 to v4.37.6 and
touches nothing else: **two pages armed, `docs` exits 1, and no author of that change can clear it.**
It recurs on the monthly schedule.

**The pages cite the workflow for what it does, and name no commit.** A SHA moving with its version
comment cannot invalidate a claim neither page makes, so the rule is asking a human to confirm
something that did not change.

**The repository already answers this shape.** A restamp is not a material
change, and `scripts/docs_gate/branch.py :: _material` already dispatches to two immateriality tests
— `scripts/check_scope.py :: is_comment_only` for parseable source, and
`scripts/docs_gate/branch.py :: _stamp_only_delta` for markdown. **A third sibling is the fix**: a
delta where every changed line is a `uses:` pin whose action path is unchanged and whose version
comment moves with the SHA.

**Narrow it, or it is a hole rather than a carve-out.** The action path must be identical on both
sides — a different action is a different thing — and one changed line that is not such a pin makes
the whole delta material again. The fixture net needs both cases: a pin-only delta that is immaterial,
and a pin-plus-one-line delta that is not.

**Not a bot exemption, and the comment on the test should say why.** Deciding by author gets it
wrong in both directions: a human making the identical bump is still blocked, and a bot making a substantive
workflow change passes unchecked. **The question is what changed, not who changed it** — which is
also what keeps a human's identical bump answerable by the same rule.

**The residual risk, stated rather than hidden:** a major-version bump that alters behaviour a page
describes while touching only the pin line. That is the same risk the stamp-only test already
accepts, and it belongs to the review of the version bump rather than to a stamp on an unrelated page.

### 19 · OPS-77 — A test fixture asserts its own type, and the assertion is the only thing holding it to the model

**Status:** Open\
**Surfaces:** FE, Ops\
**Effort:** M\
**Path:** Independent. Same family as **OPS-73** — both are about a frontend test asserting against
nothing outside itself — and the two could be executed together over the same files. Neither blocks
the other.

**Object literals across the frontend suite are cast to `FLSpiel` or `FLSpielAdmin`, and a cast is
what stops the compiler comparing the literal against the model.**
`fl_frontend/src/features/spiele/utils.test.ts` holds most of them, with one apiece in
`fl_frontend/src/features/admin/utils.test.ts`,
`fl_frontend/src/features/spiele/draftStatus.test.ts`,
`fl_frontend/src/features/spieltage/utils.test.ts` and
`fl_frontend/src/features/teams/utils.test.ts`. **Some go through `as unknown as`**, which discards
even the weak excess-property check a plain `as` keeps.

**The thinnest stand three fields in for the whole model.**
`fl_frontend/src/features/spieltage/utils.test.ts :: makeSpiel` returns a `spiel_nr` and the two
`quelle` fields cast to `FLSpiel`, and the bracket factory in
`fl_frontend/src/features/spiele/utils.test.ts` does the same with a handful more. **Every other field
of that fixture is absent at runtime while the type says otherwise**, and
`fl_frontend/src/features/spiele/schemas.ts :: FLSpiel` is inferred from `:: FLSpielSchema` — a mirror
of a document in which none of those fields may be missing.

**Nothing is wrong today, and the entry should open by saying so.** Both thin factories feed wiring
functions — `fl_frontend/src/features/spieltage/utils.ts :: orderRoundsByWiring` and
`fl_frontend/src/features/spiele/utils.ts :: quelleKey` — which read the fixture's `spiel_nr` and its
two `quelle` fields and nothing else, so every fixture supplies what its consumer asks for. The
remaining casts sit over literals fully occupied for what reads them. **This is a hazard with no
defect behind it**, which is what ranks it here rather than higher.

**What makes it a hazard rather than a style note is the direction a predicate grows.** The functions
these fixtures feed are exactly the ones that gain a clause: a wiring reader that later consults
`sonderereignis`, a status derivation that later reads `elfmeterschiessen`. On the day one does, the
fixture answers with an absent field — a value the model forbids and no stored document can hold — and
the assertion written against it passes, describing behaviour over a document that cannot exist.
**`tsc` cannot report it, because the cast is the author telling it not to.**

**The fix is not deleting the casts.** A partial literal standing in for a large model is legitimate in
a test and is why the casts are there. What is missing is a way for the stand-in to be _checked_.
`satisfies` does not reach it — it verifies what is present and leaves the absent fields absent. **The
shape that does is a factory building a complete, valid fixture and taking overrides**, validated once
at construction through the Zod mirror already in the tree, so the fields nobody names are real values
and a fixture that has drifted from the model fails where it is built rather than wherever it is
eventually read. `fl_frontend/src/features/saisons/utils.test.ts` already works this way, its `spiel`
helper spreading a complete base; the work is bringing the other files onto it.

**The size is the reason it is an entry rather than a fix taken in passing.** It is a few thousand
lines across those files, most of it in
`fl_frontend/src/features/spiele/utils.test.ts`, and none of it is connected to whatever change
happens to expose the question.

**One thing this entry does not claim** (COR-9). A cast is not what makes a fixture describe the wrong
state. A complete, type-correct literal can still represent something the domain does not produce, and
no type-level mechanism reaches that — not a cast's removal, not a factory, not `satisfies`. What
catches it is a reader, or a predicate that eventually disagrees with it. The two failures share a
file and nothing else.

### 20 · OPS-72 — A unique index and the case proving it are paired by position, and only a count holds them

**Status:** Open\
**Surfaces:** BE, Ops\
**Effort:** S\
**Path:** Independent. It sits beside OPS-12, which is the same question for a generated file and its
generator, and beside OPS-76, which is one pass over the same fixtures.

**`fl_backend/tests/core/test_constraints_execution.py :: test_each_unique_index_refuses_the_second_document`
is parametrized over a hand-written list of
document pairs, labelled with `ids` taken from the names in
`fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`.** That labelling is the only coupling between
the declaration and the cases meant to prove it. The ids are labels: no assertion reads one, and the
pairing between the n-th index and the n-th document pair is positional.

**What the coupling catches, it catches by accident.** Removing an index leaves fewer ids than parameter
sets, and pytest fails at collection with a message naming counts and no index — one that prevents the
tests from running at all rather than reporting which rule went unproven. Adding one fails the same way.
**Verified on the installed pytest on 2026-08-25** by running both shapes over probe files outside the
tree.

**One correction to how this is first read.** An emptied `UNIQUE_INDEXES` does defeat the labelling
check, because pytest carves out an empty id list, and the same probe confirms the parameter sets
collect and pass under it. **It does not slip past the test.** `:: apply_constraints` would then build
no unique index, the second insert in each case would land, and every assertion would fail on the
document being accepted rather than rejected. So the loud failure is there; it comes from a different
mechanism than the one meant to hold the pairing.

**The mutations nothing catches are the reason for the entry.** Reordering `UNIQUE_INDEXES` re-labels
every case without changing any outcome, so a case reported under one index's name is exercising
another and every one still passes. And an index whose keys change keeps its name and its hand-written
pair, so whether that pair still proves the narrowed or widened rule is checked by nobody — two sibling
tests, `:: test_the_same_spiel_nr_in_another_season_is_fine` and
`:: test_the_same_position_in_another_phase_is_fine`, happen to cover two of those cases and are not a
general answer.

**The fix is a mapping instead of a list**: key the document pairs by index name and build the
parametrize list by walking `UNIQUE_INDEXES` and looking each name up. A missing key is then a
`KeyError` naming the index, a reorder is inert, and the id is derived from the same value the case is.
The precedent is one file away — `fl_backend/tests/api/test_rules_refusal.py` asserts its own case list
against the imported field tuple at module level, so an unpaired field fails at import.

### 21 · OPS-85 — The documentation gate never opens a stylesheet, and chapter 2 says it should

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent. It sits beside **OPS-29**, the same failure one level down — that one is a
language the reader cannot switch to inside a file it already scans, this one is a file the corpus
never lists at all. **DOC-3** is the third of the family, where a pattern rather than a filter is
what falls short of its rule. None waits on another and each fix is in a different place.

**`scripts/docs_gate/kernel.py :: SOURCE_SUFFIXES` does not carry `.css`, so no comment check has
ever read a stylesheet.** Two filters stand in the way and neither admits one:
`scripts/docs_gate/kernel.py :: tracked_files` builds the corpus from markdown plus
`:: SCANNED_SUFFIXES`, so a stylesheet is never a file
`scripts/docs_gate/references.py :: check_file` is handed; and
`scripts/docs_gate/branch.py :: check_comment_bounds` tests the same tuple again before it measures
a block. INC-9's bounds, INC-6's comment citations, COR-3's history phrases and COR-4's counts
all sit downstream of one filter or the other.

**Chapter 2 states its scope by directory and draws no line by file type.**
[`2-in-code.md`](../_standard/chapters/2-in-code.md)'s `Applies to` names `fl_frontend/src` among
five roots and then lists what it binds — module headers, symbol docs, inline comments and test
docstrings. Both stylesheets sit under that root, so by the written standard their comments carry
INC-9 and INC-6 and by the gate they carry nothing, and neither page says the two disagree.

**The reach, measured 2026-08-27.** `fl_frontend/src/app/globals.css` and
`fl_frontend/src/app/admin/admin.css` are the whole of it: two tracked stylesheets, both inside
chapter 2's scope, holding 161 comment blocks between them — 139 and 22. Three of those break
INC-9, every one of them in `globals.css`: two run to 255 and 263 characters against a bound of 250,
and one runs 5 lines and 348 characters against 3 and 250. `admin.css` is clean. **None of the
three would fail the gate even with the filter widened**, because `check_comment_bounds` measures
only a block the branch in hand wrote, which leaves a standing breach to `/docs:audit` (CUR-6).

**The rule this hole covers has already been broken here, and a person caught it rather than the
check.** `scripts/docs_gate/perkind.py :: check_owner_voice` raises `owner-voice` on
`fl_frontend/src/app/globals.css` at `acee5209` and raises nothing on the same file at `d4eb0f44`,
measured 2026-08-27 by handing the checker both revisions with `.css` read as a C-style source.
Neither verdict is one the gate can reach, that file never being in the corpus. **That is this
entry's sharpest evidence, and it outweighs any count of what is currently clean**: COR-11 held in
the stylesheet most read for how this application looks only for as long as somebody swept it by
hand. Running the same checkers over both files raises one further finding, `stamp-format`, and it
is false — a comment opens on a bold line pinning the vendored HeroUI version, which CUR-3's
pattern reads as a malformed stamp.

**Which way the disagreement should be settled is open, and the measurement is why.** Widening the
filter is not one line: `.css` has to reach `scripts/docs_gate/kernel.py :: CSTYLE_SUFFIXES` as
well, or `:: comment_style` hands the file to the `#` reader and every check runs over an empty
body — OPS-29's silence reproduced in a new place. It also lands with a guard on the stamp pattern
before the gate can go green. The alternative is to say in chapter 2's `Applies to` where its checks
stop, which is the cheaper change and leaves every block in the two stylesheets carrying this
application's styling reasoning under no bound at all. A third question rides on whichever is taken:
both files open on a block INC-2 admits in no stylesheet, and
`scripts/docs_gate/structure.py :: HEADER_SCOPES` would not bind either on a suffix addition, so a
widening has to settle that deliberately rather than inherit it — both blocks sit inside INC-9's
bounds today, so nothing is through that half. **The outcome to avoid is neither**, the enforcement
claim and the silence both left standing, which is how the next over-long block gets written into
the file most read for how this application is styled.

**The byte checks are not in the gap, and no other file type is.**
`scripts/docs_gate/perkind.py :: check_line_endings` and `:: check_binary_bytes` iterate the index
rather than the corpus, so CRLF and a stray CR are caught in a stylesheet as anywhere else.
Sweeping the five roots chapter 2 names for every other suffix the tuple omits, on the same date:
markdown is in the corpus by its own glob and read in full, the icons are assets carrying no
comment, and `scripts/ruff.toml` and `fl_backend/app/core/uvicorn_logging.json` are reached for
citations through `scripts/docs_gate/kernel.py :: OPS_SUFFIXES` but not for INC-9, that check
testing the narrower tuple — a second instance of the same gap, with no comment block below a
module header in either file, so nothing is through it.

**Why it ranks where it does.** The first three tests separate it from nothing here: it makes no
later work possible, no date makes it worse, and nothing done before it has to be redone after it.
Test 4 places it — an afternoon that brings the reach measured above under bounds the standard
already claims bind it, in the one file where a rule is known to have been broken and caught by
hand rather than by the check written for it. **What it does not do is clear a standing breach**:
the three INC-9 blocks fail no branch even with the suffix widened, so they stay `/docs:audit`'s
whichever way this goes. It holds above **OPS-29**, the same shape of hole with nothing
demonstrated behind it, on that escape alone — the effort tie-break would otherwise take OPS-29
first, that one riding another change rather than being one. It stays below **OPS-72**, whose
subject is a test that reports an index proven when it is not.

### 22 · OPS-29 — The documentation gate reads nothing inside an embedded node one-liner

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent. **A rider on the next `scripts/docs_gate/` change** rather than a change of
its own, on the measurement below.

**`scripts/docs_gate/kernel.py :: comment_style` picks one comment reader per file, by suffix, and
cannot switch languages inside a file.** A `.sh` file gets the `#` reader and everything downstream
inherits it — `scripts/docs_gate/kernel.py :: comments_only`, `:: _scan_body`, and
`scripts/docs_gate/branch.py :: branch_additions`, which indexes into the scanned body by line
number, so a `//` line lands on an empty position and drops out. The content is not shortened, it is
absent. That same reader takes `.conf`, `.yml`, `.yaml`, `.toml` and any file with no suffix at all,
`Dockerfile` included.

**Measured on 2026-08-19 rather than reasoned.** Thirty-seven tracked files reach the `#` reader;
eleven carry a non-URL `//`; six of those are `.claude/hooks/*.sh` with genuine embedded JavaScript,
and they hold 59 `//` comment blocks no gate check has ever read. **A branch that adds `//`
comments to one of those files adds nothing `branch_additions` returns** — measured against
`.claude/hooks/guard-branch-bash.sh`, where every added `//` comment line is absent from it. No
standing figure goes with that half, because the count is a property of whichever branch is asked:
take it by diffing the file against the fork point and comparing its `//` lines against what
`branch_additions` returns.

**The citation half is the sharper one and has to be named on its own.** `check_added_citations`
(INC-6) sees none of that region, so a citation written inside one of those blocks can dangle
**silently and permanently** — nothing resolves it on a branch, and nothing resolves it in a standing
sweep either. One written there today would resolve or dangle unobserved either way, and nothing
would notice the day it stopped resolving.

**The length half is the quiet one, which is why it ranks under the other.** A breach there is
harmless until it is found and obvious once it is, and every one of those blocks sits inside INC-9's
three lines and 250 characters as of 2026-08-19. What the gap costs is therefore not a live breach
but the next block written over either bound: `check_comment_length` (INC-9) takes it in any other
file and has never measured this region at all. `check_history_phrases` (COR-3) and `check_counts`
(COR-4) are blind in the same region for the same reason.

**This sits outside the scope classifier's accepted boundary, and not marginally.** That boundary is
`scripts/check_scope.py`'s, and every limit it accepts errs toward _more_ checking:
what no parser can prove is code, so the full gate is demanded. Here unreadable means checked by
nothing and reported as nothing — a different module, a different check family, and the opposite
failure direction, so that boundary cannot be cited to accept it.

**What the change has to be scoped for.** INC-6's `Enforced by` names its checks over every tracked
TypeScript, JavaScript, Python and shell file, and for the embedded-JavaScript region of a shell file
that claim is false — a field claiming _more_ than the gate delivers, where DOC-2 records the
opposite direction. Teaching the shell reader to take `//` runs beside `#` runs is the expected fix.
The honest alternative is amending INC-6's `Enforced by` to say where its checks stop. **The outcome
to avoid is the third one** — leaving both the silence and the enforcement claim standing, which is
how the next dangling citation gets written into the one place a reader trusts most.

**What teaching the reader would newly raise is one advisory, not forty-three**, which is what makes
this a rider rather than its own change. Measured on 2026-08-12 by running the real checkers over a
body carrying only the `//` text of all ten files: rule-id, citation, line-citation, bare-path and
voice raise **nothing**, because the `//` blocks are clean and every citation in them
resolves; COR-3's `check_history_phrases` raises nothing; and COR-4's `check_counts` raises **one
advisory over three lines**. The reason is structural rather than lucky — COR-3, COR-4 and
`check_comment_length` all read `branch_additions`, so they cannot fire on a line no branch added,
and the over-length block named above surfaces only when somebody rewrites it.

### 23 · OPS-11 — The local-compose guard cannot tell an invocation from a mention

**Status:** Open\
**Surfaces:** Ops\
**Effort:** S\
**Path:** Independent — `scripts/selfcheck.sh` already drives this hook the way the hook runner does.

**`.claude/hooks/guard-local-compose.sh` matches the command as text.** It denies a shell command
containing `docker compose`, or `docker-compose` followed by a space, unless that same command also
names the local compose file. A search for the phrase and a heredoc writing it into a document each
contain it, so each is denied — with the message written for someone about to operate the production
stack by mistake. Both shapes were hit during the decision-record demolition on 2026-08-19: a grep
whose search pattern was the phrase, and a heredoc writing `.claude/CLAUDE.md` §5 — the repository's
own rule about that command, which cannot be stated without naming it. The second is the one to sit
with, because the refusal falls on the sentence that carries the rule.

**A false refusal costs more than the inconvenience.** A guard is worth obeying only while every
refusal it issues is worth obeying. One that fires on a command it has no business refusing invites
that command to be reworded rather than reconsidered, and a wording that gets around a false refusal
gets around a true one just as well.

**The escape is textual in the same way, and that half is a hole rather than a nuisance.** The second
`case` releases any command whose text contains `docker-compose.local.yml`, wherever it sits — in a
trailing comment, in an unrelated quoted argument, in a path the command never opens. So a command
that genuinely drives the production definition is allowed through by a mention of the local file it
is not using, which is the single outcome this guard exists to prevent. The refusal half is loud and
one command away from resolved; this half is observable only as a production stack that was operated
by mistake, and the hook's own header says there is no error to notice when that happens.

**What the narrowing has to preserve.** The branch guard is settled on the asymmetry: a false refusal
is one command away from resolved, while a hole is not observable
at all. The same asymmetry binds here, so the test to reach for is where the phrase sits rather than
whether it occurs. A match at a command position — the start of the command or the far side of a
separator, allowing a leading `sudo` or an environment assignment — still refuses
`docker compose --project-name x up`, which an allowlist of subcommands would let through.

**The repository already holds the shape both halves want.** `.claude/hooks/guard-branch-bash.sh`
splits the command into words and reasons about `words[0]` and `words[1]` rather than about the
string — it takes the program's basename and its subcommand, and reads path-like tokens out of the
argument vector. Deciding the same way answers both halves at once: the refusal fires only when the
invoked program is `docker` with `compose` first, or is `docker-compose`, and the escape fires only
when `-f` actually carries the local file as its value.

**Done when:** the guard refuses every invocation shape, allows a command that only names one, and
**refuses an invocation that names the local file somewhere other than a `-f` value**, with
`scripts/selfcheck.sh` asserting each. It already drives this hook for a bare invocation, for the
local file named, and for a command that is not compose at all, so the probes have a home; the third
assertion above is the one with no probe today.

### 24 · OPS-74 — One field list is drift-guarded on the backend and hand-written on the frontend

**Status:** Open\
**Surfaces:** FE, Ops\
**Effort:** S\
**Path:** Independent, and it is the concrete instance of **OPS-73**'s general case. It is filed
separately because its fix is one assertion and OPS-73's is a convention; folding it in is a reasonable
call and this is the half to fold.

**`REQ-RULES-011`'s repair is composed per moved field on the backend and enumerated by hand in the
German.** `fl_backend/app/api/saisons/services.py :: find_rules_refusal` builds its message from the
fields that actually differ, against `:: SHAPE_RULES_FIELDS`;
`fl_backend/tests/api/test_rules_refusal.py` carries one row per field in `:: SHAPE_REPAIR_CASES` and
asserts at module level that the row's field tuple equals the imported `SHAPE_RULES_FIELDS`, so a
further shape field fails at import rather than going untested. **That guard reaches the backend and
stops there** — nothing outside `fl_backend/` names the constant.

**The frontend's arm is one static string.** `fl_frontend/src/features/saisons/actions.ts`, in its
`REQ-RULES-011` case, maps the repairs onto the qualifiers and onto the group shape by hand, with a
different route for each half — redraw with the new number for the first, undraw and re-enter the clubs
for the second. **It is correct and complete for the fields that exist**, and it cannot fail in the
dangerous direction: it can never collapse to a single repair, which is the defect the backend's guard
exists to catch. What it can do is go quietly incomplete if a further shape field is ever added, naming
a repair for some of them.

**Severity is genuinely low and the entry should say so rather than inflate it.** A further shape field
is unlikely — the ones that exist are what
`fl_backend/app/api/saisons/schedule.py :: schedule_for` is a function of — and the failure is an
incomplete sentence rather than a wrong instruction. **What makes it worth an entry is the asymmetry**:
one message has a structural guard on one side and none on the other, and a rule and its German being
two sites is a shape that has already reached an administrator here as a generic message with the whole
gate green.

**Nothing else already reaches it, checked rather than assumed.** Several frontend tests do read backend
declarations at test time — the per-feature `actions.test.ts` files reach
`fl_backend/app/core/domain.py` through `fl_frontend/src/core/refusalRegister.ts`, and two more read
`fl_backend/openapi.json`. **They couple at the level of refusal codes, not fields**: `fl_frontend/src/features/saisons/actions.test.ts` asserts that every
code `PATCH /saisons/{saison_id}` declares reaches a `case` in the mapper, `REQ-RULES-011` included, and
reads nothing about what that case's message must name.

**The fix follows the pattern one file away.** A table in
`fl_frontend/src/features/saisons/actions.test.ts` keyed by shape field, asserted equal to the field
tuple parsed out of `fl_backend/app/api/saisons/services.py`, with each entry's German required to
appear in the `REQ-RULES-011` arm. A further field then fails the frontend suite the same day it fails
nothing on the backend.

### 25 · OPS-68 — Two routes sharing a path and a method collapse to one before the guard sweep reads them

**Status:** Open\
**Surfaces:** BE, Ops\
**Effort:** S\
**Path:** Independent — the assertion belongs beside the mapping that needs it, and
`fl_backend/app/main.py` is untouched by it.

**`fl_backend/tests/api/test_admin_guard.py :: ROUTES_BY_OPERATION` maps `(path, method)` to the
route serving it, walking every mounted `APIRoute` to build it.** A dict keeps the last value
written, so where two mounted routes share that pair the later one replaces the earlier and every
case built on the mapping — the mutation sweep and the one-guard sweep alike — inspects whichever
route won. **The route that lost is never checked for a guard at all.** The key is the path with its
convertor stripped (`:: strip_convertors`), so two routes differing only in a parameter's convertor
collapse together as well.

**Nothing else in that file reports the collapse.**
`:: test_the_published_surface_and_the_mounted_routes_are_the_same_set` compares the published
operations against the mapping's keys as sets, and a collapsed pair satisfies that comparison exactly
as a single route does, the published document keying on the same pair.

**The repair is an assertion beside the mapping**: no two mounted routes share the pair. It needs no
change to how the routers mount, no testing-only API, and it names the colliding pair at collection
time.

**The bound has to be stated rather than left to be assumed (COR-9): the nearest candidate for such a
pair is not one.** The admin single-fixture read and the public one do not collide.
`fl_backend/app/core/routing.py :: by_id` constrains the id parameter to an ObjectId, so a static
segment cannot be read as an id; the admin route carries a static `/admin` after that parameter; and
`fl_backend/tests/api/test_spiele_admin_read.py :: GUARD_CASES` already proves which router answers
each of the two paths, by the guard that refuses the wrong key. **This entry is about the sweep's
blind spot in general, not about that route.**

### 26 · OPS-83 — An in-transaction read's session argument is held to its comment by nothing

**Status:** Open\
**Surfaces:** BE, Ops\
**Effort:** M\
**Path:** Independent. It is the same question as **OPS-63** and **OPS-69** — a claim written in prose
beside the code and read by no test — and the harness it needs is the one
`fl_backend/tests/api/test_saison_patch_isolation.py` already builds.

**`fl_backend/app/api/saisons/admin_router.py :: judge_and_write_the_rules` opens on a read carrying
`session=session` under a comment stating why it must**: the read goes through the session, as the
draw's reads do, so that a retry after a write conflict judges the season as it stands then. **Dropping
that argument reportedly leaves the whole database tier green**, on this branch and on `main` alike
under the same plant. The guard is therefore deletable by anyone, for any reason, with nothing to say
so — and it is that way already rather than by anything this branch did.

**Why the isolation suite does not reach it.**
`fl_backend/tests/api/test_saison_patch_isolation.py :: TestADrawLandingMidPatchIsJudgedAgain` is built
for this route's retry: a hook runs a complete draw inside the update call, and `season_reads == 2`
asserts the callback judged twice rather than once. What the second judgement then refuses on is
`REQ-RULES-011`, decided by the season's fixture count — read from the fixtures collection through a
call keeping its own `session=`. **So the case proves that the retry happened and proves a refusal, and
neither fact passes through the season document's read.** That read supplies `status` and `rules`, and
the plant moves neither.

**What the argument buys, and therefore what a case has to move.** With it, the season row is judged
from the same snapshot as the entries, fixtures, matchdays and squad rows the same judgement reads.
Without it, one document in that judgement comes from outside the snapshot and the rest from inside, so
a commit landing between them is half-seen: the patch is refused, or allowed, against a season that
stood in neither state. **A case that fails without the argument therefore has to move the season
document itself, between that read and the in-session ones** — a plant point the existing hook, which
sits on the update call, does not reach.

**The same comment sits on four sibling reads in that file**, one per transactional callback, each held
by the same nothing. Whether the case is written once for this site or once as a shape over all five is
the design question inside the entry, and writing it for this site alone leaves four guards deletable.

**Not verified here:** the database tier was not run for this entry. That dropping the argument leaves
it green is a report; the mechanism above is what the code says would allow it.

### 27 · OPS-63 — A comment claims two files hold the same pattern, and nothing holds them to it

**Status:** Open\
**Surfaces:** FE, BE, Ops\
**Effort:** S\
**Path:** Independent — both files exist and the suite that would host a check already reads the
published document.

**The two ends of the wire are resolved against each other in exactly one place, and patterns are
outside it on purpose.** `fl_frontend/src/core/apiContract.test.ts` converts every exported Zod
schema to JSON Schema, pairs it with its component in the committed `fl_backend/openapi.json`, and
compares presence, required, nullable, primitive type and enum members.
`fl_frontend/src/core/apiContract.test.ts :: FieldFacts` states the boundary in terms: patterns,
lengths, bounds and messages are deliberately not compared, because the two sides diverge there by
design and comparing validation policy produces failures nobody can act on. **This entry does not
propose moving that boundary.**

**What nothing checks is a narrower claim, made in prose and legible from one side only.**
`fl_frontend/src/shared/schemas.ts` opens by stating that each schema there mirrors a constraint in
`fl_backend/app/shared/schemas/custom.py`, that looser makes the message a lie, and that a pattern is
outside the contract comparison entirely. That sentence is the whole written record of the
`PHONE_REGEX` pair, it is a comparison nothing performs, and it reads only from the frontend:
`fl_backend/app/shared/schemas/custom.py :: PHONE_REGEX` explains its own character class to whoever
edits it, and points at no twin.

**The two patterns agree today, and nothing holds them there.** They last diverged on the character
class: a literal space on one side against `\s` on the other, which in JavaScript absorbs a trailing
newline so `$` still matches. The frontend was the looser end, so the failure mode is a form
accepting a value the API answers with a 422 that nothing in the interface can explain, rather than
a bad value being stored — and it survived a review, a commit body asserting the two were identical,
and a contract test that does not look at patterns. **What makes it worth an entry is that the same
divergence can reappear the next time either side is edited, silently and in the same direction.**
The phone pair's blast radius is nil, since no referee holds a phone number at all, which is exactly
what would make a recurrence invisible.

**`hausnummer` is a second hand-mirrored pair, and it does not share that mercy.**
`fl_backend/app/shared/schemas/addresses.py :: HAUSNUMMER_PATTERN` and
`fl_frontend/src/shared/schemas.ts :: HAUSNUMMER_REGEX` are the two ends, each named on its own side
so the read model and the payload cannot drift within a side — and nothing compares them across the
wire, exactly as with the phone pair. The alphabets agree today, `\d` inside a JavaScript class being
`[0-9]`, but every club, venue and referee form carries a house number, so a divergence here is
visible to an admin on the first address they type. The prose record is weaker here than for the
phone pair: the mirroring comment names `custom.py`, where these two ends live in `addresses.py`, so
a reader following that comment never arrives at them.

**Three answers, and they are not equivalent.**

- **Check the declared pairs.** A list of `(python symbol, typescript symbol)` pairs whose patterns
  must be byte-identical, compared in the frontend suite that already reads across the boundary. It
  says nothing about the pairs not on the list, which is what keeps it inside that boundary.
- **Drop the claim.** Delete the mirroring sentence, let the two ends diverge like every other
  validation policy, and accept the 422 as the contract. Cheapest, and it gives up the one property
  that makes the frontend message trustworthy.
- **Generate one end from the other.** Refused for the mirror as a whole, and refusing it
  for one constant is the same argument at a smaller scale.

### 28 · OPS-69 — A declared-permitted state carries its reason in prose, and no checker reads it

**Status:** Open\
**Surfaces:** BE, Ops\
**Effort:** S\
**Path:** Independent. `fl_backend/tests/core/test_domain.py` already walks every entry and
already resolves three of its fields, so the check has a host and a precedent.

**`fl_backend/app/core/domain.py :: UNENFORCED` is the repository's record of states it permits on
purpose**, and each entry argues why in a `reason=` string — often naming an index, a validator or a
call site as the thing that makes refusing the state expensive or impossible.

**Those arguments are held by review alone.** `scripts/check_docs.py` scans comments and
docstrings, and a `reason=` is neither — it is a data string inside a tuple.
`fl_backend/tests/core/test_domain.py` resolves `near`, `surfaced_by` and `proven_by`, and reads
`reason` for nothing. An index name inside one can be replaced with a name that exists nowhere and
every check still passes.

**Why it is worth closing rather than accepting.** An `UNENFORCED` entry exists to stop a later
reader re-litigating a decision, so a reason that has drifted is worse than none: it argues
confidently from something no longer true, and the states it covers are the ones nobody revisits.
The cheapest check is the one the file already invites — resolve every anchor and every index name
a `reason=` mentions, the way the three neighbouring fields are resolved.

### 29 · OPS-65 — An unused parameter is reported by neither checker the frontend runs

**Status:** Open\
**Surfaces:** FE, Ops\
**Effort:** S\
**Path:** Independent — `fl_frontend/tsconfig.json` is the file, and the single site the flag reports
is named below.

**`fl_frontend/tsconfig.json` declares `noUnusedLocals` and leaves `noUnusedParameters` out, and the
lint rule beside it cannot cover the gap.** `fl_frontend/eslint.config.mjs` runs
`@typescript-eslint/no-unused-vars` with an underscore escape and takes that rule's default for
arguments, which reports a parameter only when nothing after it is read. A parameter a framework's
calling convention forces into the leading position is therefore invisible to both.

**Enabling it costs a single underscore, measured.** Running the installed checker over the project
with the flag on 2026-08-20 reported exactly one site:
`fl_frontend/src/features/auth/actions.ts :: handleSignIn`, whose `prevState` is required by
`useActionState`'s calling convention and read by nothing. TypeScript takes a leading underscore as
the escape, which is the spelling `fl_frontend/eslint.config.mjs` already configures, so the flag and
the rule would agree.

**What it is worth, and what it costs beyond the underscore.** It closes a class the toolchain
otherwise cannot see, and the class is small — the frontend holds no other unused parameter today. A
parameter kept for a calling convention is exactly the shape that has to be underscored to satisfy
it, and an underscore in front of `prevState` reads as "ignored" where the name is what says why the
parameter is there at all. Whether that trade is worth taking is the decision this entry asks for.

**Nothing else moves with it.** `next build` writes its suggested defaults into
`fl_frontend/tsconfig.json` for any key absent from `compilerOptions`, which is why `allowJs` is
declared rather than omitted. `noUnusedParameters` is not among the keys it writes — read from the
installed Next 16.3.0 on 2026-08-20 — so adding it neither collides with that pass nor has to be
defended against it.

### 30 · OPS-66 — The style directive concedes more than the reason recorded for it needs

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent. An nginx change, so the gate is the full form with the images built
([`docs/ops/spec.md`](../ops/spec.md) §1.6) and the deploy is watched, for the reason OPS-64 gives.
It edits the same file as OPS-64 and could ride that same deploy.

**`nginx/prod.conf` sends `style-src 'self' 'unsafe-inline'`, and the narrower pair that serves the
same purpose is `style-src 'self'` with `style-src-attr 'unsafe-inline'`.**
[`docs/ops/spec.md`](../ops/spec.md) §1.4 records why the directive keeps the concession — a
runtime-computed inline `style` attribute, for which CSP offers neither a nonce nor a hash — and
records the narrowing as an nginx change rather than a documentation one. This entry is that change,
and what it needs first is a premise that page states more narrowly than the tree does.

**The premise needs re-measuring before a line is written.** That section states that nothing else in
the application sets an inline style attribute. `fl_frontend/src/shared/components/ui/FilterPanel.tsx`
sets one, carrying the custom properties its overlay's width is computed from; and the component
library sets one on every portalled overlay, react-aria's popover writing its resolved position and
its trigger width as an inline style. PRE-1 puts the code above the spec sheet, so that sentence is
the loser and moves in the same change (CUR-2). **None of it changes the candidate**, because
`style-src-attr 'unsafe-inline'` covers a style attribute wherever it comes from. What it changes is
the residual risk, the population under that directive being far larger than the page implies.

**The residual risk, stated rather than hidden, and unverified here (COR-9).** The narrowing rests
on a client applying `style-src-attr` in place of `style-src` to a style attribute; where a client
does not implement the attribute directive, the fallback leaves `style-src 'self'` governing
attributes as well — and on that client every overlay loses its computed position and the toast's
timer bar loses its duration. Neither the fallback rule nor the client population has been checked
at a source here, so confirming both is the work's opening step rather than an assumption inside it.

**What it buys.** `'unsafe-inline'` on `style-src` also admits an injected `<style>` element, which
is a real capability — exfiltration by attribute selector, and interface redress — on a policy whose
`script-src` half is already conceded and compensated by `react/no-danger`
([`docs/frontend/spec.md`](../frontend/spec.md) §1.8). Dropping the element half while keeping the
attribute half is the whole of the value. That the prerendered HTML carries no inline `<style>` block
is the spec sheet's claim rather than this entry's measurement, and it is worth re-checking beside
the one above it.

### 31 · OPS-12 — Nothing checks a generated file against the generator that owns it

**Status:** Open\
**Surfaces:** FE, Ops\
**Effort:** S\
**Path:** Independent — `fl_backend/openapi.json` already carries the pattern this extends.

**`fl_frontend/src/shared/components/ui/FLLogo.tsx` is written by
`fl_frontend/scripts/generate-brand-assets.mjs`, and what keeps them in step is a banner asking a
reader not to edit the file.** A hand-edit type-checks, lints and builds. It then survives until
somebody runs `pnpm brand` for an unrelated reason — a new icon size, a manifest entry — at which
point the generator overwrites it inside a commit whose subject says something else entirely. Every
other asset that script emits carries no banner at all: `icon.svg`, the favicon and the manifest
icons rest on the convention alone.

**The artifacts agree today.** What the generator emits for the component and what the repository
holds differ in whitespace alone — the script writes the filter primitives and the letter and
speed-bar rects one to a line, and the formatter expands them — so the mark that renders is the mark
the geometry produces, erosion filter included. This entry is about the missing check, not about a
divergence.

**The pattern exists already, on the other surface.** `fl_backend/openapi.json` is a committed
generated artifact whose freshness is a test: it regenerates the document and compares
(`fl_backend/tests/openapi_document.py`). What is missing here is not the idea but its application to
the generator on the other surface, which is why the effort is small.

**What keeps it from being free.** Only the text artifact compares cleanly. The images go through
sharp, whose output is not guaranteed byte-identical across versions, so a check that diffs them
fails on a dependency bump rather than on a hand-edit — and a check that fails for reasons unrelated
to the defect is one that gets suppressed. The honest scope is the emitted component, compared after
the formatter has run over each side so the comparison is about content rather than layout.

**Done when:** the frontend scope of the gate regenerates the component into a temporary location
and fails where it differs from the committed one, and the images are left to review with that
exclusion written down rather than assumed.

### 32 · DOC-9 — Pairs of audit checks hunt one another's ground, and only one pair has a boundary about it

**Status:** Open\
**Surfaces:** Docs\
**Effort:** S\
**Path:** Independent. A prompt is read at the start of a pass, so the repair lands whenever it is
made and pays nothing until a pass runs.

**Pairs of checks under `docs/_auditing/prompts/` ask for the same findings, and each pair fails
differently.**

**The frontend pair contradicts a boundary its own page states.**
`docs/_auditing/prompts/frontend/1-deprecated.md`'s dead-styling-vocabulary check hunts classes and
tokens resolving to nothing, tokens renamed out from under their users, and arbitrary values
duplicating a token. `docs/_auditing/prompts/frontend/6-styling-perf.md`'s token-discipline check
hunts arbitrary values duplicating or bypassing a token, tokens declared and consumed by nothing, and
shadowed or stale token names. That same page's boundary line hands "deprecated utilities and dead
styling vocabulary" to the pass above, so a check and the boundary under it disagree about who owns
the ground.

**The ops and crosscut pair has no boundary at all.**
`docs/_auditing/prompts/ops/1-build-deploy.md`'s gate-coverage check builds a required table of
failure classes against what catches each, naming the known residents of "by nothing" — cache-tag
wiring among them. `docs/_auditing/prompts/crosscut/1-contracts-and-seams.md`'s contract-enforcement
check builds a required table of seams against what would catch a regression today, and cache-tag
wiring is one of its own seams. Neither page's boundary section names the other, so the overlap is
invisible from either.

**Why it is worth a repair rather than a shrug.** A required table is required, so both passes fill
theirs and the same row is derived and reported in each — the duplication the remediation ledger then
has to notice, which [`docs/_auditing/lessons.md`](../_auditing/lessons.md) §7 records as the
ledger's own failure mode. A check duplicated across passes also splits the evidence for one finding
across reports nobody reads together.

**What the repair has to preserve.** A boundary line is how a pass knows what it is not, so the
answer is not simply deleting a check. What each pass needs is a lens: the frontend pair splits on
whether the vocabulary is _dead_ or merely _bypassed_, and the ops and crosscut pair splits on
whether a row is a failure class the gate could catch or a seam no single surface can see. Either
split is a sentence in each prompt, and both pages of a pair move together.

**Not decided:** whether `docs/_auditing/prompts/README.md` should carry a rule that every check
names its counterpart, or whether the boundary lines stay the only mechanism.

### 33 · DOC-2 — An enforcement claim is resolved in one direction only

**Status:** Open\
**Surfaces:** Docs\
**Effort:** M\
**Path:** Independent — a chapter's `Enforced by` field and the check it claims move in one change.

**`scripts/check_docs.py :: check_enforced_by` fails a rule naming a gate check that does not
exist, and nothing resolves the opposite direction.** A rule may omit a check that enforces it, and
a rule may state something a parser can decide while its field reads that it is unenforced. Either
shape leaves the field claiming less than the gate delivers, which is the reading nobody verifies —
and the field is where the standard says what is mechanically defended.

**The clear instance is `anchor`.** It is emitted in the same pass as `link`, over a markdown page
and over a source comment alike, and it is what resolves the heading a link's fragment names. INC-6
names `link` and stops there; COR-6 names `citation`, `path`, `rule-id` and `line-citation` and stops
there. A reader of either rule learns that a link's target is verified and never that its anchor is.
Most of what no rule claims defends the gate itself rather than a rule — its own registry, its
inputs, the repository's line endings — and that is correct, which is why this direction cannot be
closed by requiring every check to be claimed.

**The clear unenforced clause is OUT-7's.** It fixes what a diagram may be, and part of that is
decidable by reading the page: a fence naming a diagram language that is not mermaid, and a `[`
inside a quoted node label. The level clause is not decidable in general.
Its `Enforced by` field claims review judgment for the whole rule, so the part a parser could settle
is settled by nobody, and the field is accurate about it.

**Done when:** each rule's `Enforced by` names every check that enforces it, the clauses a parser
can decide carry one, and the direction the gate does not resolve is either mechanised or written
down as deliberate. PRE-4 closes that field's vocabulary at checks, commands and linters, so a check
added for OUT-7 lands with the field that claims it.

### 34 · OPS-19 — Both repository-wide linters re-read every file on every run

**Status:** Open\
**Surfaces:** FE, Ops\
**Effort:** S\
**Path:** Independent — two package scripts, a gitignore line, and the consequence note in
`docs/ops/spec.md` §1.6. The prettier half lands in `format` and the eslint half in `frontend`
(`docs/ops/spec.md` §1.6's scope table), so what either buys on wall clock is decided by which pool
member is binding at the scope being run.

**`fl_frontend/package.json`'s `lint` and `format:check` scripts point eslint and prettier at the whole
repository, and neither is given a cache.** `fl_frontend/tsconfig.json` sets `incremental: true`; nothing else in
either tree keeps state between runs, so both tools re-read every file they are pointed at whether or
not anything about it has changed since the last run said the same thing.

**What the two steps cost**, measured 2026-08-11 on a development machine while the gate was
profiled: prettier over the repository is 41.5 s with other scopes running beside it and 33.3 s
alone, and eslint is 21.5 s — the longest step in the frontend scope, where a warm Turbopack cache
leaves `next build` at half of it. On a runner the order reverses and eslint is the second-largest
step behind `next build`, 16 s against 28 s over fourteen runs on 2026-08-11, inside the job that
sets a pull request's critical path.

**Why this may be worth more than the concurrency the gate already has.** Running the scopes
concurrently moved the wall clock and spent about a quarter more processor time to do it. A cache
does not redistribute the work, it removes it — and it lowers the floor in CI as well as locally,
which concurrency cannot: `.github/workflows/verify.yml` runs one scope per job, so inside a job
there is nothing to overlap it with.

**The three unknowns this was filed on are answered**, measured on 2026-08-12 on the development
machine — sixteen cores, repository clean — against the invocations the gate uses:

| Run, 2026-08-12                                      | Wall clock |
| ---------------------------------------------------- | ---------- |
| `prettier --check ..`, no cache — the gate's today   | 34.5 s     |
| `prettier --check ..`, `--cache`, warm               | 25.6 s     |
| `eslint .`, no cache and no concurrency              | 23.4 s     |
| `eslint .`, `--cache --cache-strategy content`, cold | 20.5 s     |
| `eslint .`, `--cache --cache-strategy content`, warm | 4.5 s      |

1. **Does a cache survive usefully between local runs?** Yes — decisively for eslint and modestly for
   prettier, and together they remove **about twenty-eight seconds of scope-time from a warm local
   run** (2026-08-12) — scope-time rather than wall clock, because the two halves fall in different
   pool members. Prettier's floor of 25.6 s with a fully warm cache and nothing changed says most of
   its time is startup, discovery and ignore-matching rather than formatting, which bounds what any
   cache can ever buy on that step. **The eslint rows carry no concurrency setting, and the step
   carries one** (the last block of this entry), so what a cache removes on top of that is not among
   these figures.
2. **Does `--cache` change what the check proves?** Not once the key is chosen rather than defaulted.
   A cached clean verdict is exactly as good as its key, and `scripts/verify.sh` passes
   `--no-optimistic-repeat-install` to pnpm precisely because that tool's fast path keys on
   timestamps, where a stale one lets a real mismatch answer that everything is already up to date.
   `--cache-strategy content` hashes the linted file's contents instead — **and that is not
   sufficient here, measured 2026-08-26.** `fl_frontend/eslint.config.mjs` points
   `better-tailwindcss` at `entryPoint: "src/app/globals.css"`, so `no-unknown-classes` decides every
   file's verdict by reading a file it never lints, and eslint's key covers the config and the linted
   file alone. Renaming a class in `globals.css` leaves a warm `--cache --cache-strategy content` at
   exit 0 while the uncached run exits 1 naming four uses of it. **The suspicion this entry was filed
   with is therefore NOT discharged by choosing the key.** It is closable by hashing that stylesheet
   into the resolved config, which changes eslint's own config hash and invalidates the cache — tried,
   and the same experiment then reports all four. That carries a standing obligation to grow the
   hashed set whenever the plugin gains another cross-file input or a second entry point is added,
   and getting it wrong fails silently, which is the trade to weigh rather than assume.

   **The concurrency lever on this step is settled on its own terms and substitutes for no key.** Its
   record is the last block of this entry; what it changes here is the baseline, a cache on eslint
   having to buy its time on top of `--concurrency=2` rather than on top of a serial run.

3. **Can CI persist one?** **Out of scope, decided 2026-08-12: the local win only.** It needs no CI
   change to collect, so `.github/workflows/verify.yml` is left alone and the image build cache —
   buildx's `type=gha`, with no `actions/cache` step — needs no
   revisiting, nor does `.claude/CLAUDE.md` §7's line for it. This is a boundary on the work rather
   than a question still open inside it, and reopening it is its own decision.

**Done when:** `fl_frontend/package.json`'s `format:check` passes `--cache`, and its `lint` either
passes one over a key that also covers `fl_frontend/eslint.config.mjs`'s `better-tailwindcss` entry
point — `--cache-strategy content` alone is refused above — or is settled against, the concurrency
lever it was weighed against having shipped at `--concurrency=2` on the evidence below. Whichever
caches land,
`fl_frontend/.gitignore` carries the line for each cache file, which it has for none of them today.
**One consequence lands with it and belongs beside the
change**: a cache means the gate writes an untracked file into the working tree on every run.
`.claude/CLAUDE.md`'s rule that no formatter the gate runs writes a _tracked_ file still holds, and
`docs/ops/spec.md` §1.6 is where the note goes.

**The concurrency lever on the same eslint step is taken, and its value is chosen against a
diagnostic rather than against the clock**, which is what leaves the cache question standing on its
own. `fl_frontend/package.json`'s `lint` passes `--concurrency=2`. eslint 9.39.5 takes the flag as a
first-class option under flat configuration, and `fl_frontend/eslint.config.mjs` declares no `project`
or `projectService`, so the configuration is not type-aware and a worker parses independently.

**What decides the number is `LOW_NET_LINTING_RATIO`, the 0.7 floor the installed package sets.** Under
it eslint emits `ESLintPoorConcurrencyWarning`, a Node process warning stating that the setting is poor
for the tree just linted, and that check runs identically whatever the setting — only the wording of
its advice moves — so a number quiets it only by genuinely clearing the floor. Measured on the
development machine across roughly twenty runs: `auto`, which is eight workers there, holds a ratio of
0.556 to 0.571 and warns, and that is not a near miss — about 44% of each worker's life is bootstrap
and file reading rather than linting. Two workers hold 0.720 to 0.743 and warned in none of the runs
taken. **No value is both faster than `auto` and quiet**: 4 and 6 are marginally faster and still warn,
so `auto`'s speed was purchasable only by suppressing a correct diagnostic. Node offers the precise
mechanism for that — `--disable-warning=ESLintPoorConcurrencyWarning`, which `fl_frontend/package.json`'s
own `test` script already uses for an unrelated warning — and it is deliberately unused here.

**`auto` also carries a failure mode no warm timing shows.** On a cold V8 compile cache it takes about
28.2 s against about 21.0 s serial, 34% _slower_; disabling the compile cache makes `auto` faster
again, which places the cause on eight workers writing one compile-cache directory at once. That is a
one-off per fresh cache rather than a recurring cost, and it arrives as a regression when it arrives.
`--concurrency=2` is about 16.5 s warm against about 20.0 s serial, and neutral to slightly better
cold. **Output equivalence was re-proved at both settings**: 48 files planted across nine rule
families, under `stylish` and `json`, byte-identical to the serial run including ordering.

**What CI does with it is arithmetic, and one condition this entry set is still unmet.** The installed
eslint's `calculateWorkerCount` takes `auto` to `availableParallelism() >> 1`, so a four-core runner
resolves it to two over a file set this size — a numeric 2 makes that explicit rather than moving it.
**The three CI runs beating the recorded baseline are not among the measurements above**, and cannot be
taken from a development machine: the flag ships on local evidence, and that condition stands open
against it.

### 35 · OPS-10 — Deciding whether a change is comments only costs a process per file

**Status:** Open\
**Surfaces:** Ops\
**Effort:** S\
**Path:** Independent — what the classifier answers does not change, only what the answer costs.

**`scripts/check_scope.py :: is_comment_only` spawns per file, and the gate runs it over the whole
diff.** Each changed file costs a `git show` for its earlier version, and each changed TypeScript
file then costs a fresh node process, because `scripts/check_scope.py :: typescript_same` hands one
pair at a time to `scripts/ts_normalize.mjs`. The cost therefore scales with how many files a branch
touched rather than with what is in them, and it is paid on every gate run at a docs or frontend
scope. `scripts/check_scope.py :: images_culprits` has the same shape on the failure path, running
`scripts/ci_scopes.sh` once per file to name which one required the image build.

**Why it is worth doing and why it is not urgent.** The gate is run before every push, so its
runtime is charged to every change, and a spawn is the part of this work that does not shrink with
the size of the file it is asked about. Against that, nothing is wrong with the answers: the
classifier is correct, and what a slow gate costs is patience.

**What must not change.** The carve-out reaches exactly as far as a parser does, so a batched run
still has to answer
"same" only where a parser proved it, and still has to count every error — a file that will not
parse, a missing toolchain, a crashed process — as code. A batch that loses which pair produced
which verdict, or that turns one file's parse failure into a verdict for the rest, is worse than the
spawning it replaced.

**Not measured:** what the spawns actually cost, and how much of a gate run is attributable to them.
The mechanism above is read from the code; the magnitude is not.

### 36 · OPS-2 — Nothing validates the contents of a restored `.env`

**Status:** Standing\
**Surfaces:** Ops\
**Effort:** —\
**Path:** Independent — ops audit pass O1 owns the script's failure modes.

**Found 2026-08-01**, the hard way, during a server re-clone.

`deploy.sh` checks that `fl_backend/.env`, `fl_frontend/.env`, `nginx/prod.conf` and `certs/` all
**exist** before it pulls anything, and Compose refuses to start a service whose `env_file` is missing.
**Nothing checks that a value inside those files is well-formed**, and each `.env` is gitignored — so
every server restore recreates them by hand from the password manager, unverified, and a malformed
value surfaces as a container that never becomes healthy.

**What that cost.** The restore produced a `MONGODB_URI` whose host had been truncated, most likely a
shell redirection swallowing part of the string as the file was written. Every preflight passed: file
present, key present, URI syntactically parseable. pymongo then resolved an SRV record that cannot
exist, the startup ping raised `ConfigurationError`, the backend crash-looped, nginx never started
because it waits on `service_healthy`, and the site was down until the truncation was found by reading
a stack trace.

**The options, none obviously right:**

| Option                                                  | Catches                                 | Cost                                                                                  |
| ------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| Leave it unchecked                                      | Nothing automatically                   | Zero. The failure is loud, contained, and quick to diagnose once recognised           |
| Name-presence preflight in `deploy.sh`                  | A missing key                           | Small. **Would not have caught this incident** — the key was present and merely wrong |
| Resolve the Mongo SRV record in `deploy.sh` before `up` | Exactly this class, plus a dead cluster | Adds a network dependency to a deploy step, and a DNS blip becomes a refused deploy   |

**The trade to weigh** is that resolving the SRV record is the only option that would have helped, and
it makes deployment fail for reasons unrelated to the deployment. Given the failure is already
contained — nginx serves nothing rather than serving something broken — the honest question is whether
a faster diagnosis is worth a new way for `deploy.sh` to refuse.

**Trigger to revisit:** the second time a restore breaks this way, or any move to a setup where the site
cannot tolerate the minutes between a bad deploy and a human reading the log. Ops audit pass O1
(`docs/_auditing/prompts/ops/1-build-deploy.md`, check 4) covers script failure modes and owns this.

### 37 · OPS-3 — The crawler policy is split between robots.txt and Cloudflare, and neither knows about the other

**Status:** Standing\
**Surfaces:** Ops\
**Effort:** —\
**Path:** Independent — no pass covers it, and the table below is the early warning.

**Found 2026-08-01 while diagnosing a missing WhatsApp link preview.**

`fl_frontend/src/app/robots.ts` disallows a named list of AI crawlers, `meta-externalagent` among them.
That file is a **request**: robots.txt is advisory and a crawler chooses whether to obey it.

Cloudflare is separately enforcing something stronger. Measured against the live site, 2026-08-01:

| User-Agent                | page | image |
| ------------------------- | ---- | ----- |
| `WhatsApp/2.x`            | 200  | 200   |
| `facebookexternalhit/1.1` | 200  | 200   |
| `Twitterbot/1.0`          | 200  | 200   |
| `meta-externalagent/1.1`  | 403  | 403   |

The 403 carries `Server: cloudflare` and a `CF-RAY`, and `nginx/prod.conf` contains no user-agent or
`deny` rules — so the block is an edge setting, made in a dashboard this repository does not configure
and does not record.

**Why it matters, and why it is not urgent.** Link previews on Meta's products are fetched by
`facebookexternalhit`, which is served normally, so nothing is broken today. The risk is
consolidation: if preview fetching ever moves behind `meta-externalagent`, every WhatsApp and Facebook
preview for this site stops working, the failure is silent, and nothing in the repository would explain
it. The 403 is invisible from the codebase.

**What a rework has to decide, rather than assume:**

- Whether the AI opt-out belongs in robots.txt, at the edge, or both — and if both, which one is the
  source of truth when they disagree. They already disagree in kind: one asks, one enforces.
- Whether blocking an agent Meta also uses for product features is the intended trade. The opt-out was
  aimed at training, not at previews.
- Whether the edge configuration should be recorded here at all, given `docs/ops/overview.md` states
  that this repository does not configure Cloudflare. A setting that can break a user-visible feature
  and leaves no trace in the repo is the argument for writing it down somewhere.

**Trigger to revisit:** any Cloudflare bot-protection change, or a report of broken previews. Re-running
the table above takes one `curl` per agent and distinguishes an edge block from a markup problem
immediately.

### 38 · DOC-3 — A rule pattern in the documentation gate reaches less than the rule it enforces

**Status:** Standing\
**Surfaces:** Docs\
**Effort:** —\
**Path:** Independent — no pass covers it, and only the triggers below reopen it.

**Not a defect today, and the corpus is why.** Each pattern below matches everything the repository
currently holds. Each is also narrower than the rule it serves, and where it falls short the gate
answers with silence rather than a finding.

**The rule families are spelt into the patterns.** `scripts/check_docs.py :: RULE_ID_RE` carries the
standard's prefixes as a closed alternation, and `scripts/docs_gate/perkind.py :: RULE_HEAD_RE`,
`:: CHAPTER_ROW_RE` and `:: RULE_INDEX_LINE_RE` repeat the same list. A chapter written under a
prefix none of them carries falls outside all of them at once: citations of its rules resolve to nothing and dangle unreported,
its rules are not held to PRE-4's anatomy, and none of them is required to take a line in the rules
index. Widening the alternation by hand is not the answer, because the list is closed so that the
backend's error codes — which carry an extra segment — can never be read as rule ids. A pattern
whose prefixes disagree with the chapters is a divergence the gate could resolve on its own, the way
`scripts/check_docs.py :: roadmap_ids` derives the roadmap's ids from the tables defining them
instead of matching a shape.

**The metadata pattern is anchored at column 0.** `scripts/check_docs.py :: METADATA_LINE_RE`
requires its bold label to open the line, where `scripts/check_docs.py :: RULE_FIELD_RE` reads a
metadata block of its own and tolerates leading
whitespace — so `scripts/check_docs.py :: check_metadata_breaks` cannot see a metadata block
nested inside a list item or a blockquote, and COR-8's hard break goes unchecked there. Widening it
is not free: this is a discovery pattern run across every page, an indented bold label is a shape
ordinary prose also takes, and a check that reports prose is a check that gets ignored. What an
answer has to find is a way to reach the indented block without reaching indented prose.

**Trigger to revisit:** a chapter added to the standard under a prefix the patterns do not carry, or
the first page that needs a metadata block indented.

### 39 · DOC-4 — A stamp is required by a path and owed by a claim

**Status:** Standing\
**Surfaces:** Docs\
**Effort:** —\
**Path:** Independent — no pass covers it, and only the trigger below reopens it. **OPS-80** and
**OPS-82** are each a change of exactly the kind that trigger names, and OPS-82 is where the three are
read together.

**CUR-3 decides a stamp by what a page claims and never by where the page sits.**
`scripts/check_docs.py :: check_stamp_missing` decides it by `STAMP_REQUIRED_GLOBS`, a list of
paths, because what a page claims is not something a check can read: the globs cover the part of the
criterion a path settles and leave the rest to a reader.

**What the gap costs.** A page stating current state from outside those globs carries no stamp and
nothing reports the omission — and `branch-impact` arms only on a stamped page, so every file that
page cites may change under it with nothing ever asking for it to be re-verified. That is precisely
the staleness the stamp exists to measure, running unmeasured on the pages the stamp never reached.

**Why inverting the default is not free.** The exempt kinds CUR-3 names are decidable by path: a
template, an instruction file, a document addressed to a reader outside this repository. The
class it leaves open is not. A page whose own content is the table that navigates elsewhere needs no
stamp and is not wrong to carry one, so an inverted rule reports it and the report names no defect.
Naming those pages in the check is the outcome to avoid — a list of names is what deciding by kind
was written to replace.

**Trigger to revisit:** a reference page added under `docs/` that sits outside
`STAMP_REQUIRED_GLOBS`, or any change to what the branch-impact check arms on.

### 40 · DOC-10 — One unchanged line exempts a comment block a branch rewrote

**Status:** Standing\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent — one comparison in one function, and the measurement below is what any change
to it has to be argued against.

**`scripts/docs_gate/structure.py :: check_comment_length` holds INC-9's bounds against a block only
where every one of its physical lines is one the branch added.** The block's line numbers must be a
subset of the added set, which `scripts/docs_gate/branch.py :: _added_by_file` derives from one
`git diff -U0` against the fork point. A block one line short of that is skipped at any length.

**A Python docstring makes the shortfall easy to reach.** Its delimiter lines are block lines, so
where the `"""` sit on lines of their own, rewriting the prose between them leaves both delimiters
untouched and the block is exempt however long the new prose runs. Measured on 2026-08-21 by reading
a docstring of that shape through `:: comment_runs`, which yields the opening and the closing line as
members of the block.

**The exemption is deliberate, and the check's own docstring records why** — failing a branch for a
word changed inside an older block is what gets a check suppressed, and a block a branch only partly
rewrote is that branch's own slice, which CUR-6 hands to `/docs:audit-pr`. **The narrow complaint is
only that one unchanged line exempts a block a branch effectively rewrote**, which is not the case
the exemption was written for.

**Tightening it is a decision against a measured cost.** Measured on 2026-08-21 over the twenty
non-merge commits ending at [`2cb204db`](https://github.com/felzab/frankfurtleague/commit/2cb204db),
by replaying each commit's added lines against the blocks in each file as that commit left it: 121
comment blocks were touched in part and left in part, and 34 of those stand over one of INC-9's caps.
A rule of "any added line trips the check" would therefore charge a commit roughly one to two
rewrites of prose it did not come to change. **That measurement is what this entry delivers**, and
the rule change is not proposed with it.

**A second measurement, taken from a branch rather than from history (2026-08-22): the exemption hid
four blocks over INC-9's character cap at once.** Running `check_comment_length` by hand over every
file a branch touched, rather than over the added lines the gate reads, returned blocks of 401, 396,
481 and 451 characters against a cap of 250 — each having passed a green `--docs` run, because each
block's opening and closing lines were context. **A Python docstring is not the only shape that
reaches it**: a `/** … */` block whose delimiters go untouched behaves the same way, and rewriting
the prose between them is the ordinary edit that does it.

**The check also reads the tracked corpus, which is a second route to the same silence.**
`scripts/docs_gate/kernel.py :: tracked_files` enumerates through `git ls-files`, so a comment written
into a file git does not yet know about is measured by nothing until that file is staged. Both routes
are found the same way, by running the checker by hand over the files rather than over the diff.

**Trigger to revisit:** a partly-rewritten block shipping over a cap where its length is what costs
something, or any change to what `check_comment_length` reads, at which point the subset test is
already being touched.

### 41 · OPS-81 — One commit imports a frontend module the commit after it adds

**Status:** Standing\
**Surfaces:** FE, Ops\
**Effort:** —\
**Path:** Independent — it blocks nothing and nothing blocks it, and no gate scope reaches it:
`./scripts/verify.sh` proves the working tree it is run over, and CI proves a tip.

**`fl_frontend/src/features/saisons/actions.test.ts` imports
`fl_frontend/src/core/refusalRegister.ts`, and the tree at
[`f53ce721`](https://github.com/felzab/frankfurtleague/commit/f53ce721) holds the test file without
the module.** The module is in the tree at
[`63a9f68d`](https://github.com/felzab/frankfurtleague/commit/63a9f68d), the commit directly after
it. TypeScript answers that specifier with `TS2307: Cannot find module
'../../core/refusalRegister.ts'`, reproduced 2026-08-26 under the resolution options
`fl_frontend/tsconfig.json` sets and the compiler `fl_frontend/package.json` declares. Both frontend
commands reach it: `typecheck` is `tsc --noEmit`, and `test` runs `node --test`, which discovers
`*.test.ts`. **Not verified by checkout** — the tree at that commit was read rather than built, so
that both commands fail there is taken from the absent module and the diagnostic, neither having
been run at it.

**One commit and one specifier, measured rather than assumed (2026-08-26).** Every relative and
`@/`-aliased specifier in each `.ts` and `.tsx` file under `fl_frontend/src` was resolved against its
own commit's tree, for each commit from
[`d668d82e`](https://github.com/felzab/frankfurtleague/commit/d668d82e) to
[`5e4fafcb`](https://github.com/felzab/frankfurtleague/commit/5e4fafcb) — 1850 specifiers at the last
of them. `f53ce721` is the only commit carrying an unresolved specifier, and that import is the only
one it carries.

**Nothing is red, and a red build is not the symptom to look for.**
`.github/workflows/verify.yml` triggers on `pull_request` and on a push to `main`. Both judge a tip —
the pull request's merge result, and `main` after the merge commit — and neither checks out a commit
in between, so no CI run visits `f53ce721`.

**What it costs is a `git bisect` over the frontend**, which lands there and answers with a failure
unrelated to whatever is being hunted. [`docs/_git/spec.md`](../_git/spec.md) §1.4 permits merge
commits alone, so the commit reaches `main` verbatim and this does not age out.

**Recognise it and skip it, which is the whole of the action.** git's documented shape for a revision
that cannot be built is exit code 125 from a `git bisect run` script, marking it untestable —
`make || exit 125` is the manual's own example. The residual is the one the manual names: skipping a
commit adjacent to the culprit leaves git unable to say which of them was first bad, and this
commit's entire frontend delta being one test file is what settles that by reading the diff.

**Rewriting the history is the repair, and I have declined it.** Carrying
`fl_frontend/src/core/refusalRegister.ts` one commit earlier means rewriting a pushed branch with a
pull request open against it, which moves every line a review comment is anchored to
(`docs/_git/spec.md` §1.4). Weighed against a bisect that skips one commit, I took the gap — so **this entry
records a decision rather than an outstanding repair**, and the window in which the fix was cheap
closed at the push.

**`.git-blame-ignore-revs` does not reach it.** That file feeds `blame.ignoreRevsFile` and moves line
attribution in `git blame`, where the attribution here is right and is nobody's complaint. git offers
no in-repository list a bisect consults, so this entry is the whole of the durable warning — and a
bisect stands at a detached `HEAD`, so `git grep f53ce721 main` is what reads this page from wherever
it has stopped.

**Trigger to revisit:** a second commit reaching `main` in this shape. One is a skip; a pattern is
the argument for a per-commit resolution check, and the sweep above is what it would be built from.
