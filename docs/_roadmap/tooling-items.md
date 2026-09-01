# Tooling items

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

| #   | ID      | Item                                                               | Surfaces          | Effort | Status   | Depends on |
| --- | ------- | ------------------------------------------------------------------ | ----------------- | ------ | -------- | ---------- |
| 1   | OPS-93  | The origin trusts every source inside Cloudflare's ranges          | Ops, Docs         | S      | Open     | —          |
| 2   | OPS-60  | The gate saturates the machine, then idles through its tail        | Ops               | M      | Open     | —          |
| 3   | OPS-100 | A changed citation target puts no page in front of the session     | Ops, Docs         | S      | Open     | —          |
| 4   | OPS-98  | A formatter reshapes a comment before INC-9 measures it            | BE, Ops, Docs     | S      | Open     | —          |
| 5   | OPS-102 | A python constant's closing quotes open a comment run              | Ops, Docs         | M      | Open     | —          |
| 6   | OPS-84  | The linter runs a version past its end of life                     | FE, Ops, Docs     | M      | Standing | —          |
| 7   | OPS-97  | No check can render a Server Component, so §6's rule is unenforced | FE, Ops, Docs     | L      | Open     | —          |
| 8   | OPS-67  | The runner cannot load a component, so none is tested              | FE, Ops, Docs     | M      | Open     | —          |
| 9   | OPS-76  | Most of the database tier runs unconstrained                       | BE, Ops           | M      | Open     | —          |
| 10  | OPS-71  | An invariant citation resolves to a string, not to a definition    | Ops, Docs         | S      | Open     | —          |
| 11  | OPS-95  | A real file in an unaccepted spelling reads as a missing file      | Ops, Docs         | S      | Open     | —          |
| 12  | OPS-78  | The local edge claims to mirror production, unchecked              | Ops, Docs         | S      | Open     | —          |
| 13  | OPS-70  | Two db-tier runs at once fail in a way that names nothing          | Ops               | M      | Open     | —          |
| 14  | OPS-73  | A copy test pins what its own author wrote                         | FE, Ops, Docs     | M      | Open     | —          |
| 15  | OPS-79  | A projection's coupling is guarded in one direction only           | BE, Ops           | M      | Open     | —          |
| 16  | OPS-77  | A test fixture asserts the type nothing else checks                | FE, Ops           | M      | Open     | —          |
| 17  | OPS-72  | The unique-index test pairs by ordinal position                    | BE, Ops           | S      | Open     | —          |
| 18  | OPS-85  | The gate never reads a stylesheet's comments                       | Ops, Docs         | S      | Open     | —          |
| 19  | OPS-74  | One field list is drift-guarded on one side only                   | FE, Ops           | S      | Open     | —          |
| 20  | OPS-87  | A call site's key tier is held to its route by nothing             | FE, BE, Ops       | M      | Open     | —          |
| 21  | OPS-68  | Two routes on one path and method collapse to one                  | BE, Ops           | S      | Open     | —          |
| 22  | OPS-83  | An in-transaction read's session argument is untested              | BE, Ops           | M      | Open     | —          |
| 23  | DOC-13  | The refusal-code table is held to the backend by nothing           | BE, Ops, Docs     | S      | Open     | —          |
| 24  | DOC-15  | A refusal's meaning is written three times, unresolved             | FE, BE, Ops, Docs | M      | Open     | —          |
| 25  | OPS-63  | A comment claims two files hold one pattern, unchecked             | FE, BE, Ops       | S      | Open     | —          |
| 26  | OPS-69  | A declared-permitted state's reason is checked by nothing          | BE, Ops           | S      | Open     | —          |
| 27  | OPS-66  | The CSP's style directive is wider than it needs to be             | Ops, Docs         | S      | Open     | —          |
| 28  | OPS-12  | Nothing checks a generated file against its generator              | FE, Ops           | S      | Open     | —          |
| 29  | DOC-14  | A renamed file's comment blocks are never measured                 | Ops, Docs         | S      | Open     | —          |
| 30  | DOC-2   | An enforcement claim is resolved in one direction only             | Docs              | M      | Open     | —          |
| 31  | OPS-10  | Naming the image build's culprits costs a process per file         | Ops               | S      | Open     | —          |
| 32  | OPS-2   | Nothing validates the contents of a restored `.env`                | Ops               | —      | Standing | —          |
| 33  | OPS-3   | Crawler policy split between robots.txt and Cloudflare             | Ops               | —      | Standing | —          |
| 34  | DOC-3   | A rule pattern reaches less than the rule it enforces              | Docs              | —      | Standing | —          |
| 35  | DOC-10  | A block already over a bound is excused by its opening line        | Ops, Docs         | S      | Standing | —          |
| 36  | OPS-81  | One commit imports a module the commit after it adds               | FE, Ops           | —      | Standing | —          |
| 37  | OPS-101 | The backend, db and frontend jobs have stepped up in wall clock    | FE, BE, Ops       | M      | Open     | —          |

**No entry on this page blocks another**, which is why every `Depends on` cell is an em dash. What
each entry waits on that is _not_ an entry — a page, a decision, a scheduled audit pass — is on its
own `Path` line.

---

## The items in rank order

### 1 · OPS-93 — The origin trusts every source inside Cloudflare's ranges, so the visitor's name is whatever the request says it is

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent, and **none of its three remedies is a change to this repository** — each needs
account or host access. The closed OPS-92 row in [`closed-items.md`](closed-items.md) read the same
block from the other side: that one was about real-IP recovery failing silently, this one about it
succeeding for a party it was never meant to serve. **OPS-78** touches the same pair of files.

**`nginx/prod.conf` trusts Cloudflare's published address ranges to name the visitor, and that list is
every Cloudflare customer's egress rather than this account's.** Each range is a `set_real_ip_from`,
and `nginx/prod.conf :: real_ip_header` names the request header the visitor's address is then read
out of. So a request arriving from inside those ranges is named by what it sent, and the comment at
the block says as much — naming Authenticated Origin Pulls or a host firewall as what would narrow it,
neither being a change to that file. [`docs/ops/overview.md`](../ops/overview.md) carries the same
fact for the ops reader.

**What a trusted source controls, and this half is measured.** The header's value becomes
`$remote_addr`, which is what every `limit_req_zone` in that file keys on — through
`nginx/prod.conf :: map $remote_addr $client_net` and its wider twin
`nginx/prod.conf :: map $remote_addr $client_net48`, each zone paired across the two — and what the
`client` field of `nginx/prod.conf :: log_format` records. From a source inside `172.64.0.0/13`, a
value sent in the header becomes both. **A forged value per request is therefore a fresh bucket per
request**, so a rate limit counts nothing, and the access line names whoever the sender chose. The
measurement was taken while the edge read `X-Forwarded-For`; what it demonstrates belongs to
`set_real_ip_from` rather than to which header is read, so the change of header moved the forged
value and not the property.

**The wider key does not reach this at all, which is worth saying because it looks as though it
should.** `$client_net48` exists so that one subscriber cannot walk a zone across the many `/64`s an
end site is allocated, and it caps that walk where the narrow key could not. **It caps nothing here:**
a forged value is not a walk across a real allocation but an invented address, and an invented address
lands in a fresh bucket in the wide key exactly as it does in the narrow one. **A forgery now misses
both ceilings at once**, so the severity below is what it was before the pair existed.

**What is inferred rather than measured.** That an arbitrary third party can reach the published ports
_from_ inside those ranges — through the platform's own outbound subrequests — is read off how the
platform works and was not exercised against this origin. **The consequence was measured; the
availability of the source was not.**

**A second party may be able to name the visitor too, and it turns on one untested fact.** realip
takes the **first** header of the configured name, and `nginx/prod.conf :: real_ip_recursive off` then
takes the last comma element inside that one; `X-Forwarded-For` is special-cased to walk every header
of that name instead. Exercised on 2026-08-30 with one value pair and only the header name changed, a
client's header arriving ahead of the proxy's **wins** under `CF-Connecting-IP` and loses under
`X-Forwarded-For`. **So if Cloudflare adds its header alongside a client's rather than replacing it,
the party naming the visitor is any visitor at all**, not only a source inside the ranges. That
condition is untested and untestable from here — it takes one request through the real edge.
The closed OPS-92 row in [`closed-items.md`](closed-items.md) carried the same conditional for the
case where the client's header is malformed and the address falls back instead of being displaced.

**The header is a settled choice rather than an open one, and the argument against changing it is
recorded here because both routes above turn on it.** Cloudflare's published security model rests on
where a connection comes from rather than on what a header contains, which is why the
add-versus-replace question has no documented answer: it is a question read out of nginx's source,
not a gap Cloudflare declined to fill. **And a flaw of that reach would not be quiet** — an appended
second `CF-Connecting-IP` would make every origin following Cloudflare's own recommended snippet
spoofable by any visitor, so the absence of such a report is a strong prior that the header is
replaced. **A prior is not a proof**, and the one-request check against the live edge remains the
deciding evidence and remains outstanding. What would NOT improve matters is `real_ip_recursive on`:
with the whole Cloudflare range trusted, the leftward walk steps past any trusted address, so a
genuine visitor whose own address falls inside those ranges — WARP egress, or a subrequest — would
have the walk continue into entries the client wrote. `off` has no such failure mode, which is why
`nginx/prod.conf :: real_ip_recursive off` is the setting the analysis above assumes.

**The access line cannot be used to catch it, which is not obvious from reading the line.**
`nginx/prod.conf :: log_format` records `client` and `x_forwarded_for`, while the address is taken
from the header `real_ip_header` selects — and that header reaches no log field, appearing in this
repository as that directive and nowhere else. **So the value that set the key is absent from the line
it produced**, and the `x_forwarded_for` beside it is a header this edge does not read.

**Nothing else stands in front of the origin.** `docker-compose.yml` publishes 80 and 443 on the
nginx service, and no Authenticated Origin Pulls, Cloudflare Tunnel or host firewall is named in
[`docs/ops/spec.md`](../ops/spec.md), [`docs/ops/overview.md`](../ops/overview.md),
[`docs/ops/runbooks.md`](../ops/runbooks.md), `docker-compose.yml` or `scripts/deploy.sh` — searched
on 2026-08-30.

**Three remedies, and they differ in where the trust is enforced** — two of them the comment at the
block already names. **Authenticated Origin Pulls** makes Cloudflare present a client certificate and
nginx require it: the smallest change here, an
`ssl_client_certificate` and `ssl_verify_client` pair, plus a certificate and a per-hostname setting
in the account — and the ports stay open, so it is only worth what the `ssl_verify_client` enforces.
A **Cloudflare Tunnel** stops the origin listening publicly at all and dials out instead: the
strongest, and the largest change — a container, a credential, and the published ports leaving
`docker-compose.yml`. A **host firewall admitting only Cloudflare's ranges** touches this repository
not at all, and inherits exactly the maintenance the closed OPS-92 row in
[`closed-items.md`](closed-items.md) described, because it is the same list going stale somewhere
else. **The first two make the range list irrelevant to trust; the third makes
it load-bearing twice.**

**Why it ranks where it does.** Test 1 puts it first: every control at this edge that turns on who the
visitor is rests on this one answer — every rate-limit zone at this edge, the two the public
application form added among them, and the `client` on every access line. It ranks above every
toolchain entry below because each of those is paid by a reader or a session inside the repository,
while what this one costs is a control that is live, public and defeated with no signal that it
was.

### 2 · OPS-60 — The gate saturates the machine, then spends its whole tail unable to use it

**Status:** Open\
**Surfaces:** Ops\
**Effort:** M\
**Path:** Independent — it blocks nothing and nothing blocks it. The profile below names which
section binds the run, so removing work from inside any other scope moves nothing here while `db`
is the tail. It
shares no prerequisite with **OPS-70**: the first lever shipped over database names carrying the
_worker_ that chose them, which separates two workers of one run and leaves that entry's two
concurrent runs — every worker of which draws the same suffix — exactly where they were. Its own
branch: it reaches the pool manifest, which carries the exit contract.

**The gate's floor is its longest section, and the schedule is a pure max.** Nothing passes
`--width`, so the pool opens one slot per scope, every scope starts at once, and the
expected-longest are submitted first (`scripts/gate_pool.py :: TYPICAL_MS`,
[`docs/ops/spec.md`](../ops/spec.md) §1.6). No scope waits on another: the compose parse reads its
stand-in `.env` files from a scratch copy rather than the real trees, so what remains of the wall
clock is the longest section itself — the database tier below.

**Two scopes writing one `__pycache__` is not a coupling, and a chain must not be added on
that reasoning.** `docs` and `scripts` have shared two of those directories unconstrained since the
pool was written: CPython writes a bytecode file to a temporary name and renames it, nothing in this
repository reads pytest's `nodeids`, and `lastfailed` is written only when its value changes and
steers only `--lf`, which the gate never passes. The argument in full is `d828ee1c`'s, and it is worth
reading before any scope here is made to wait on another.

**How a start is read off a run, rather than inferred.** Sample `ps` while a full-form run is going
and record when each worker's process first appears: every scope should appear within seconds of
the pool opening, and one appearing later is one something held. That separates a scope that is slow from
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

**1 · Distribute the database tier — built, and owed the measurement that says what it was worth.**
It is aimed at the tail the trace shows, and latency-bound work overlaps rather than divides: two
workers waiting on two commits wait once. The scope runs
`pytest -m db -n auto --dist loadfile`, over databases each worker names for itself and two mongods
the xdist controller starts and shares out, so the width costs processes rather than containers
([`docs/backend/spec.md`](../backend/spec.md) §1.6). **What is not established is whether it pays.**
No timing here is trustworthy: the machine was contended throughout the work, and this entry's own
rule is that a db-tier figure counts only as a pair of runs within a fifth of a second of each other
on an idle machine (**OPS-70**). Two questions are open with it — what `auto` should be, sixteen
workers sharing one `mongod` being a guess rather than a finding, and whether the shared server
becomes the new tail once the workers stop waiting on their own. Sixteen workers driving one
single-node replica set produced no transaction contention across the runs taken while it was built,
but none of those runs stressed it and the machine carried other work throughout — `WriteConflict` at
a wider width is plausible and unproven, and it belongs inside the width question rather than beside
it.

**2 · Distribute the fixture net — a lever on one scope, not yet on the gate.**
`scripts/tests/test_check_docs.py :: _load` copies `scripts/` into a throwaway repository, commits a
planted corpus into it and imports the gate from the copy; `:: _STATE` memoises the result, so the
build is paid once per process. It is what binds its own scope, at 46 seconds against `selfcheck`'s
35 — but that scope closes forty seconds inside `db`, so nothing it gives back reaches the wall clock
until lever 1 has landed. A worker is a process, so it also carries the miniature of lever 1's second
problem, as many fixture builds as workers against one today, and it wants the same absent plugin.

**3 · Distribute the default tier — last, and probably never.** It is the cheapest to prove isolated,
having no database and no container, and it is the one the profile argues away twice over: the
section running it closes well inside `db` — the `backend` and `db` rows of the table below — and a
tier with no container to wait on spends a real fraction of itself in interpreter startup, which a
worker pays again per process. It is recorded here so that it is rejected against the profile rather than reached
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
seconds from the run's start; the `ops` row's late start is the wait that run's schedule imposed on
it, which the pure-max schedule above does not. What a tier costs on its own belongs to
[`docs/backend/spec.md`](../backend/spec.md); what this table holds is the gate's own sections, which
include the waiting. **A row is that commit's cost and not a standing property of its scope**: `ops`
has since gained the access-line check ([`docs/logging/spec.md`](../logging/spec.md) L11), so what
this table is read for is the SHAPE — which section binds the run — rather than any row's seconds.

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

### 3 · OPS-100 — A branch changes what a page cites, and nothing puts that page in front of the session

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent. It lands beside the branch-scoped checks in `scripts/docs_gate/branch.py`,
reads the material classifier that is already there, and `/docs:audit-pr` consumes the same list
once it exists.

**Nothing mechanical asks a branch to re-read the pages describing what it changed.** The
same-commit rule (CUR-2) is answered by the author, and the author here is almost always an
assistant session — the writer most likely to update the code it is touching and to miss the
prose it is not. The retired restamp cascade carried this forcing and went for its costs; its
record — the closed OPS-80 row in [`closed-items.md`](closed-items.md) — shows the hard-failing
version was satisfiable by ritual, one stamp move clearing a branch for good. Failing was the
wrong verdict, not the wrong idea.

**The repair is the arming computation without the stamps.** A report-verdict check: intersect
each docs page's resolved citations with the branch's materially changed files — the classifier
`scripts/check_scope.py` already decides material — and print the pages whose subjects moved. A
list to read, never a failure, in the same tier as `counts` and `history`: no line to falsify, no
bookkeeping to go stale, nothing to suppress. The gate's output lands in the session transcript,
which is exactly where the author is; the review reads the same list in the run the pull request
records.

**Proven against a planted violation first (PRE-4):** a fixture page citing a fixture source
file, the source materially edited on the branch, the page named in the report — and the
negative, a comment-only edit to the cited file arming nothing.

**Why it ranks where it does.** Test 1: every documentation-touching branch after it is safer,
and the work ahead — the corpus disposition rewrite, the tooling shrink, the test estate — is
exactly a run of branches that change what pages cite. It sits below OPS-60, whose subject is
every run's wall clock, and above the citation-resolution family, whose subject is whether a
claim resolves rather than whether anyone is asked to re-read it.

### 4 · OPS-98 — The formatter rewrites a comment between the author and the checker, so its shape inside a call is not the shape INC-9 is measured on

**Status:** Open\
**Surfaces:** BE, Ops, Docs\
**Effort:** S\
**Path:** Independent — one formatter behaviour, one reader, and nothing here waits on either.

**`ruff format` removes a blank line inside an argument list, and keeps one at statement level.**
Exercised on 2026-08-30 through `ruff format -` on two inputs differing only in where the blank line
sat: between two comment paragraphs inside a call it is stripped and the paragraphs become
contiguous; between the same two paragraphs in a function body it survives. **So a comment written as
several paragraphs inside a call reaches the checker as one block**, and
`scripts/docs_gate/kernel.py :: comment_runs` reads it as one — which is what INC-9's bound
is then applied to.

**The obvious way round it does not work either.** A bare `#` between paragraphs survives the
formatter, but `comment_runs` yields it as an empty entry INSIDE the run rather than ending the run,
so the block stays one block and only its character count is unchanged. **The author's instinct and
the formatter's behaviour fail in the same direction**, and nothing tells them so.

**The live instance is invisible, and by a decision that is right.** The comment at
`fl_backend/app/api/teams/admin_router.py :: patch_saison_team`'s replacement write measures 443
characters against the 250-character cap, read through the gate's own functions on 2026-08-30.
`scripts/docs_gate/branch.py :: check_comment_length` measures a block only where every one of its
lines is in the branch's added set, and its docstring records why — failing a branch for a word
changed inside an older block is what gets a check suppressed, and a partly rewritten block is
`/docs:audit-pr`'s under CUR-6. That reasoning holds; the consequence here is that the one place the
trap has already bitten is the one place nothing will report.

**What generalises is that a comment's shape is not the author's to fix.** Anyone writing a long
comment inside a call produces a block INC-9 refuses, learns nothing at the time, and — if the block
is wholly theirs — is failed by a measurement of a shape they did not write.

**Three repairs, and the cheapest may be enough.** Teach `comment_runs` that a run collapsed by the
formatter is several — which needs a rule for what separates them, and the formatter has removed the
evidence. Or measure comment length over the whole file rather than the added lines, which finds every
old block at once and gives up the reason the added-set narrowing exists. **Or rest on the trap now recorded at INC-9** —
[`docs/standard.md`](../standard.md) states the blank-line rule and the move-above-the-statement
answer, which is what the one author who met this did. The third costs nothing further and leaves
the measurement wrong; the first two are a mechanism.
**Deciding that a written-down trap is sufficient is a real answer**, and the entry is here because
that is a judgement rather than a defect.

**Why it ranks where it does.** Test 1 keeps it below the instruments above: what it distorts is one
bound on one comment shape, where those decide whether a whole corpus's claims can be checked at all.
It holds above everything below because it is the measuring instrument rather than a thing
measured, and because the failure is silent at both ends: the gate reports nothing and the
author is given no way to learn why their comment is the wrong length.

### 5 · OPS-102 — A python constant's closing delimiter opens a comment run, so code is measured as prose

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** M\
**Path:** Independent — it blocks nothing and nothing blocks it. It shares INC-9's measurement
surface with **OPS-98** and asks a different question of it: that entry is about the SHAPE a comment
reaches the checker in, this one about what the checker calls a comment at all. Neither fix is in
the other's file.

**`scripts/docs_gate/kernel.py :: comment_runs` reads python by line rather than by token, and
`:: PY_DOCSTRING_OPEN_RE` matches `"""` at the start of any stripped line.** A module-level
triple-quoted CONSTANT opens on a line the pattern cannot match — the quotes sit after `NAME = ` —
and closes on a line holding the delimiter alone, which the pattern matches exactly. So the CLOSING
delimiter is read as an opening, and every line below it up to the next `"""` is collected as prose
and measured against INC-9's bound.

**One instance stands in the tree, and it is under the bound by luck.**
`scripts/tests/test_copy_corpus.py` closes its `MEASURE` constant on such a line; the run that opens
there swallows the `def` beneath it and that function's docstring, and measures 151 characters
against a bound of 250. Nothing the checker does keeps it there — a longer signature or a
two-sentence docstring puts it over.

**What it costs is a wrong REFUSAL, which is the expensive direction.** A run over the bound is a
failing finding, so a branch is refused over a line nobody wrote as a comment, against a rule its
author cannot satisfy by editing any comment. The quiet half is wrong in the same way: a genuine
comment following such a constant is measured joined to the code above it, so a block already close
to the bound is graded on a length it does not have.

**Why M rather than S.** The repair is to derive a python file's runs from `tokenize` rather than
from a line scan, which changes what the runs ARE for every python file in the corpus — not only
the one above. So the corpus has to be re-measured against the new reader and every changed verdict
read: a block that has been passing because it was mis-split is a real finding the moment the split
is right, and the pre-existing INC-9 blocks `/docs:audit` already owns must not be confused with a
new one.

**Done when:** `comment_runs` reads python through a tokenizer, the corpus is re-measured and every
verdict that moved is read and dispositioned, and `scripts/tests/test_check_docs.py` plants a
module-level triple-quoted constant with a long function beneath it and asserts that nothing is
found.

### 6 · OPS-84 — The linter runs a version past its end of life, and the documentation for it describes another

**Status:** Standing\
**Surfaces:** FE, Ops, Docs\
**Effort:** M\
**Path:** Held upstream rather than by anything on this page, so no entry here can unblock it. The
trigger that reopens it is an `eslint-plugin-jsx-a11y` release whose peer range admits eslint 10,
under an `eslint-config-next` whose bundled `eslint-plugin-import` and `eslint-plugin-react` admit it
too. It still moves the tool whose cache key and threading decision
[`docs/ops/spec.md`](../ops/spec.md) §1.6 records, so both are re-answered against whatever ships
here rather than ahead of it.

**eslint 9.x reached end of life on 2026-08-06, and `fl_frontend/package.json` declares `^9.39.5`.**
Confirmed on 2026-08-26 against eslint's own version-support page: v9 is listed as end of life rather
than in maintenance, v10 has been the current major since 2026-02-06, and 9.39.5 — published
2026-07-10 — is the newest 9.x release in eslint's release notes; re-confirmed 2026-08-31, when the
registry served 10.9.1 as `latest` and 9.39.5 as the whole of its `maintenance` channel. **The caret
range therefore spans a line that will publish nothing further**, so `pnpm update` cannot move it and
reports nothing that would say it is frozen.

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

**The peer-range walk is done — measured 2026-08-31 against the installed packages and the npm
registry — and it holds the move.** Flat configuration, the larger half of a v9-to-v10 migration, is
already in use: `fl_frontend/eslint.config.mjs` builds through `defineConfig` and `globalIgnores`.
The plugin set is what holds, each row below being the package's **newest published release**:

| Package                                          | Newest | eslint peer range tops out at | Admits v10 |
| ------------------------------------------------ | ------ | ----------------------------- | ---------- |
| `typescript-eslint` + `@typescript-eslint` pair  | 8.66.0 | `^10.0.0`                     | yes        |
| `eslint-plugin-better-tailwindcss`               | 4.7.0  | `^10.0.0`                     | yes        |
| `eslint-config-next`                             | 16.3.3 | `>=9.0.0`, open-ended         | range only |
| `eslint-plugin-jsx-a11y`                         | 6.10.2 | `^9`                          | no         |
| `eslint-plugin-import` — inside config-next      | 2.32.0 | `^9`                          | no         |
| `eslint-plugin-react` — inside config-next       | 7.37.5 | `^9.7`                        | no         |
| `eslint-plugin-react-hooks` — inside config-next | 7.1.1  | `^10.0.0`                     | yes        |

**`eslint-plugin-jsx-a11y` is the direct blocker, and it is dormant.** Its newest release is the one
installed — 6.10.2, published 2024-10-26 — and `fl_frontend/eslint.config.mjs` imports it directly
for its rule set. Upstream, two pull requests adding eslint 10 support — jsx-eslint/eslint-plugin-jsx-a11y
#1079 and #1081, both opened February 2026 — sit open with nothing merged and nothing released behind
them. `eslint-config-next` compounds it: its own peer range admits v10, but it carries the same plugin
beside `eslint-plugin-import` and `eslint-plugin-react` as plain dependencies, each on a newest
release whose peer range stops at `^9` — so the framework config cannot run supported on v10 either.
**Forcing the install past the declared peer ranges is not the move**: a linter defect fails in the
direction of passing, and an unsupported combination makes that one direction likelier.

**Not verified:** which v10 changes bite here once the set moves. The migration guide —
`eslint.org/docs/latest/use/migrate-to-10.0.0` — was not read against the configuration, no move
shipping while the walk holds it, and a plugin that does move may carry a changed rule default under
it. [`docs/frontend/spec.md`](../frontend/spec.md) states what several of those rules are relied on
for, and is where a moved default lands.

**Why it ranks where it does.** Test 2 separates it from everything below it: the date has passed, and the
distance from the supported line widens on its own with nothing here watching it — the growing
migration that test names. It sits under the entries above it on test 1, none of which this makes
cheaper, safer or possible.

### 7 · OPS-97 — Nothing here can render a Server Component, so no check can reach the boundary rule the repository already states

**Status:** Open\
**Surfaces:** FE, Ops, Docs\
**Effort:** L\
**Path:** Independent, and **OPS-67** is its predecessor rather than its answer: that entry is that no
component can be loaded at all, and repairing it buys a runner for CLIENT components. A Server
Component needs a different harness again, so OPS-67 landing leaves this exactly where it is.
The sweeps PRE-4 constrains are the neighbouring class — a check whose listing cannot falsify its
claim — where here there is no check to hold a listing.

**`.claude/CLAUDE.md` §6 states the rule and names the reason no tool catches it**: a Server Component
may not pass a function to a Client Component, and neither `tsc` nor the build sees it on a dynamic
route. **A rule stated and enforced by nothing is worse than a gap nobody has written down**, because
it reads to every later reader as a guarantee somebody is keeping.

**Each layer misses it for its own reason, and the reasons do not overlap.** A prop typed
`readonly Facet<Row>[]` is correct: the type system has no notion of the serialisation boundary, so a
function is a good value on both sides of it. `next build` never renders a dynamic route, so the
failure has no build-time moment. And no test renders a Server Component, the node runner having no
way to. **So the three things a branch is cleared by are each right and each blind to the same
defect** — and it surfaced instead as a flash and a German error on an admin page, found by a person
opening it.

**What exists now closes one shape rather than the class**, which its author said plainly. Two
source-level assertions in `fl_frontend/src/shared/utils/facets.test.ts` hold that no module under
`src/app/` lacking `"use client"` imports a facets module, and that no `Admin*View.tsx` takes
`facets` as a prop — both reading source text rather than rendering anything. They are proxies for a
runtime property, chosen because the runtime property is out of reach, and they cover the facet shape
alone: the next render prop to cross that boundary will be a different name in a different file.

**The decision is which of those two things this repository wants**, and the honest answer may be the
smaller one. A harness that renders each admin page's server half would test the property itself
rather than a spelling of it, and would catch a boundary crossing nobody predicted — at the cost of a
second runner, a React server runtime, and fixtures for pages that read a database. **Or source-level
proxies per known shape are accepted as the ceiling**, in which case what is owed is a place that
lists which shapes are covered, so §6's rule stops reading as though all of it were held. **Choosing
the second is a real answer**; leaving the choice unmade is what currently reads as the first.

**Why it ranks where it does.** Test 1 puts it above **OPS-67**: that entry makes a class of test
possible, where this decides whether a rule the corpus already publishes can be enforced at all, and
an unenforced published rule misleads every reader who trusts it. The same test keeps it below the
instruments above, which every other entry's verification runs through. **What separates it from
the sweeps PRE-4 constrains is that this one has already reached a user**, rather than merely being
unfalsifiable: the cost of leaving it undone is not hypothetical, and the next crossing is a
different prop in a different file.

### 8 · OPS-67 — No component can be loaded by the frontend test runner, so no component test can be written

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

### 9 · OPS-76 — Most of the database tier runs against collections production would not accept

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

### 10 · OPS-71 — A citation naming an invariant is proved by a substring, so one resolving to a sheet that does not define it passes

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent of DOC-2 and DOC-3, which are about what the standard claims and what a discovery
pattern reaches; this is about what resolution proves.

**`scripts/docs_gate/checks.py :: _check_citation` proves a symbol is DEFINED where the cited
file's language can be read for definitions (`scripts/docs_gate/kernel.py :: defined_symbols`), and
falls back to whether the anchor appears anywhere in the file where it cannot.** A markdown sheet is
the case that cannot, so a citation naming a spec sheet and an invariant id is still proved by a
substring. **That proves the id's characters are somewhere in the sheet, and nothing more**: an
invariant id resolves against a sheet that mentions it anywhere at all — in another invariant's
prose, in a §1.1 table cell, in §3's remedy table — whether or not the sheet defines an invariant by
that number, and whether or not that invariant means what the citing page says it means. **The live demonstration is already in the corpus:**
`docs/frontend/spec.md` defines no invariant in the forties and mentions backend invariants from that
range in its prose, so a citation naming that sheet and one of those ids
resolves cleanly against a definition it does not hold.

**Two failure modes, and the second is the dangerous one.** The first is containment: a shorter id is a
substring of a longer one, so a citation to an invariant a sheet does not define passes as long as one
starting with the same digits does. The second is collision: a new invariant given a number the sheet
already uses resolves perfectly, from both directions, while the sheet now defines one number twice.
**Nothing detects the duplicate either.** `scripts/docs_gate/checks.py :: invariant_ids` walks
`:: INVARIANT_ROW_RE` over every sheet and appends a sheet to an id's home list only where the sheet is
not already in it, so a sheet defining one id in two rows is indistinguishable from a sheet defining it
once.

**The machinery to close both already exists and is already passed in.** `scripts/check_docs.py`
computes the invariant homes and hands them to the per-file check, which uses them for
`scripts/docs_gate/checks.py :: check_invariant_citations` — the comments-only check for an id two
sheets define. **What is missing is the same resolution for the citation form**: where a citation's
anchor is exactly an invariant id, require the cited sheet to be among that id's homes rather than
testing for a substring, and report a duplicate row within one sheet as a finding of its own. Both are
small changes in files that already hold the data.

**One thing to get right.** The substring fallback stays for what no reader can index — a shell
symbol, a markdown heading, a config key — so this narrows the check for one anchor shape rather than
replacing the fallback, and `scripts/docs_gate/checks.py :: INVARIANT_CITE_RE` is the pattern that
already recognises that shape.

### 11 · OPS-95 — A citation naming a real file in an unaccepted spelling is reported as a file that does not exist

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent. It lands in `scripts/docs_gate/checks.py` beside **OPS-71**,
the other entries about what a citation resolves to. Neither blocks the other.

**`scripts/docs_gate/checks.py :: _resolve` refuses a slashed token that is neither
repository-relative nor package-root-relative, and never reaches the name index behind it.** The
function tries the repository path, then `scripts/docs_gate/kernel.py :: repo_path`, then a bare-name
lookup — but the bare-name route is guarded by a test for a `/` in the token, so a token holding one
returns the empty list rather than falling through. Exercised on 2026-08-30 over one real file
written four ways: the repository path and the package-root-relative spelling both resolve, the bare
filename resolves, and the intermediate spelling — the file's path from inside its own package's
source root, without that root — resolves to nothing.

**The finding it produces names the wrong fault.** An empty resolution is reported as
`cited file not found`, so a citation whose file is present and whose symbol is right is reported as
naming a file that is not there. **The reader is sent to look for a deleted file when what is wrong
is a spelling**, and the shortest route out of the finding — deleting the citation — is the one
repair that loses a true claim. This holds whether or not the file is tracked: the fault is the
spelling rather than the listing the name is looked up in.

**Whether the spelling should resolve at all is the decision, and it is not obvious.** COR-6 asks for
an anchored path, and refusing a spelling the standard does not sanction is defensible;
`scripts/docs_gate/kernel.py :: repo_path`'s own docstring records that existence is what keeps a
token naming a KIND of file out of the check. So the answer may be to keep refusing and say so, in a
message that names the spelling rather than the file — which costs one line and teaches the rule at
the point of failure. The alternative is to let the package-root fallback that already serves a
token like `src/core/...` serve a deeper one too, which resolves more spellings and weakens the
pressure toward the one COR-6 asks for.

**Why it ranks where it does.** The first three tests separate it from nothing here: nothing merges
wrong through it, no date makes it worse, and no work is redone. **Test 4 places it** — an afternoon
that turns a misdiagnosis into an instruction, over a population any comment or page can enter, which
is worth less than the entries above it and more than an entry whose whole subject is one file.

### 12 · OPS-78 — The local edge claims to mirror production, and nothing reads either half of the claim

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent of every entry here. FB-17 on [`open-items.md`](open-items.md) is what makes it
timely rather than what blocks it: that entry owns the question of what rate limit its public write
should carry, and every public write that exists takes its own through an exact-match `location` of
its own — so the edit lands in both files or in neither, and nothing would say which. An ordering
preference across pages, and a dependency in neither direction.

**`nginx/local.conf` opens by claiming the same routing, rate limits and security headers as
`nginx/prod.conf`, and its `/api/admin/` block says it must stay identical to production's or the
local stack cannot catch a routing mistake — and nothing checks either sentence.** `scripts/verify.sh`
runs `nginx -t` in its ops scope against `nginx/prod.conf` alone. The local file is no longer
unparsed — `nginx/redaction_test.sh` serves it in the pinned image in that same scope, and a config
nginx cannot load never answers, so a typo in it now fails the gate. What stands is the comparison:
nothing reads either half of the header's claim that the two files agree. `scripts/check_compose_mirror.py` compares `docker-compose.yml` against
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
the same rate-limit zones at the same rates, apply the same bursts to the same exact-match
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

### 13 · OPS-70 — Two db-tier runs at once fail in a way that names nothing

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
is the expensive direction — a false alarm is one re-run from resolved, while a corrupted green
announces nothing.

**What is established about the harness, and what is not.** Almost every db-marked suite names its own
database — `fl_backend/tests/core/test_constraints_execution.py :: DATABASE_NAME` is
`fl_constraints_test`, and nearly every sibling suite carries a distinct one — so the suites do not
collide with one another. Two names are shared between suites — the one the suites seeding through
pymongo's synchronous client take from `fl_backend/tests/config.py :: CORPUS_DATABASE`, and the
`fl_test` that `fl_backend/tests/conftest.py :: mongo_database` hands out, whose sharers keep to the
partition recorded at `fl_backend/tests/api/conftest.py :: league`. Both now carry the worker that
chose them (`fl_backend/tests/worker.py :: worker_database`), which separates two workers of ONE run
and does nothing for two runs, every worker of which draws the same suffix.
A run starts its `mongo:8` containers through testcontainers with no reuse flag set anywhere in the
tree — `fl_backend/tests/conftest.py :: pytest_configure_node` where it is distributed and
`:: mongo_url` and `:: mongo_replica_set_url` where it is not — so two runs are not obviously sharing
a server either. **The mechanism is therefore unestablished, and finding it is the first half of this
entry**, ahead of choosing a repair.
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

**A second occurrence, on 2026-09-01, whose mechanism WAS measured — and it is not the one above.** With
roughly a dozen agents driving db-tier suites on one Windows machine, `AutoReconnect` surfaced with
`WinError 10048` under it while 12,000 to 15,900 sockets machine-wide stood in `TIME_WAIT`: the host ran
out of ephemeral ports, and a run started once `TIME_WAIT` had drained below 7,000 was green. **That is a
property of the host under a dozen concurrent agents, not of the harness or the driver**, and the driver
half was measured rather than assumed: three hundred `fl_backend/tests/database.py :: a_clean_database`
client lifecycles against the single-node replica set, polled through `serverStatus`, held
`connections.current` flat at 3 while `totalCreated` climbed linearly to 903, with live sockets on the
client side flat at 4 — so no pool the driver holds accumulates connections to reconnect over. Three
further db-tier runs, one of them deliberately concurrent with another, were green, and the
`connection pool paused` symptom did not reproduce.

**Width is a second contributor to the same socket pressure, measured on this repository's own runs.**
A db-tier run at `-n auto --dist loadfile` left 799 more sockets in `TIME_WAIT` than it found — 596
before, 1,395 after — while a serial run of the same 769 tests on the same machine went net negative,
1,149 before and 844 after. A dozen agents each running one distributed tier is therefore some 9,600
sockets before anything else on the host touches a port, which is most of the band above. The
mechanism is structural rather than a leak: a worker is a pytest session of its own, so each opens its
own clients against the two shared servers, and `fl_backend/tests/conftest.py :: mongo_database` and
`fl_backend/tests/database.py :: shared_client` are per process rather than per run. **This attributes
neither occurrence** — it says the width the gate's own db scope already runs at is a contributor any
repair has to survive, and gives the arithmetic a diagnosis can start from. **Count the state with
`Get-NetTCPConnection -State TimeWait`**: a localised Windows `netstat` prints the state in the host's
own language, so a grep for `TIME_WAIT` reads zero on a machine holding thousands.

**The two occurrences stay separate, and the port exhaustion does not account for the earlier one.** The
2026-08-26 round's controls point away from load and nothing recorded about it names a port or a socket
count, so what the corpus holds is one occurrence with a measured mechanism and one still unattributed.
Joining them needs evidence neither currently carries.

**Not measured:** whether the collision can reach CI at all. `.github/workflows/verify.yml` runs one
`verify.sh` scope per job and each job takes its own runner, so two db-tier runs would have to land on
one host — which a hosted runner is not.

### 14 · OPS-73 — A copy test compares source text against a literal its own author typed

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
the defect could be fixed. The closed FB-21 row in [`closed-items.md`](closed-items.md) was the
field name that drifted for the same missing declaration.

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

### 15 · OPS-79 — A projection and the predicate reading it are coupled in one direction, and the open one fails quietly

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
fetch, and `fl_backend/app/api/saisons/services.py :: holds_a_recorded_fact` is what reads the
result to answer `REQ-SPIELPLAN-005` and
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
`fl_backend/app/api/saisons/services.py :: holds_a_recorded_fact` and `:: _a_side_is_off_the_draw`
read today is fetched by the projection.
The gap is that nothing holds them to it.

### 16 · OPS-77 — A test fixture asserts its own type, and the assertion is the only thing holding it to the model

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

### 17 · OPS-72 — A unique index and the case proving it are paired by position, and only a count holds them

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
tests, `fl_backend/tests/core/test_constraints_execution.py :: test_the_same_spiel_nr_in_another_season_is_fine`
and `:: test_the_same_position_in_another_phase_is_fine`, happen to cover two of those cases and are not a
general answer.

**The fix is a mapping instead of a list**: key the document pairs by index name and build the
parametrize list by walking `UNIQUE_INDEXES` and looking each name up. A missing key is then a
`KeyError` naming the index, a reorder is inert, and the id is derived from the same value the case is.
The precedent is one file away — `fl_backend/tests/api/test_rules_refusal.py` asserts its own case list
against the imported field tuple at module level, so an unpaired field fails at import.

### 18 · OPS-85 — The documentation gate never opens a stylesheet, and the standard says it should

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent. It sits beside the closed OPS-29 row in
[`closed-items.md`](closed-items.md), the same failure one level down — that one was a language the
reader cannot switch to inside a file it already scans, this one is a file the corpus never lists at
all. **DOC-3** is the third of the family, where a pattern rather than a filter is what falls short
of its rule. Neither open entry waits on the other and each fix is in a different place.

**`scripts/docs_gate/kernel.py :: SOURCE_SUFFIXES` does not carry `.css`, so no comment check has
ever read a stylesheet.** Two filters stand in the way and neither admits one:
`scripts/docs_gate/kernel.py :: tracked_files` builds the corpus from markdown plus
`:: SCANNED_SUFFIXES`, so a stylesheet is never a file
`scripts/docs_gate/checks.py :: check_file` is handed; and
`scripts/docs_gate/branch.py :: check_comment_bounds` tests the same tuple again before it measures
a block. INC-9's bounds, INC-6's comment citations, COR-3's history phrases and COR-4's counts
all sit downstream of one filter or the other.

**The standard's In-code section states its scope by directory and draws no line by file
type.** [`docs/standard.md`](../standard.md)'s In-code scope line names `fl_frontend/src` among
five roots, and the section binds module headers, symbol docs, inline comments and test
docstrings. Both stylesheets sit under that root, so by the written standard their comments carry
INC-9 and INC-6 and by the gate they carry nothing, and neither page says the two disagree.

**The reach, measured 2026-08-27.** `fl_frontend/src/app/globals.css` and
`fl_frontend/src/app/admin/admin.css` are the whole of it: two tracked stylesheets, both inside
the In-code scope, holding 161 comment blocks between them — 139 and 22. Three of those break
INC-9, every one of them in `globals.css`: two run to 255 and 263 characters against the bound of
250, and one to 348. `admin.css` is clean. **None of the
three would fail the gate even with the filter widened**, because `check_comment_bounds` measures
only a block the branch in hand wrote, which leaves a standing breach to `/docs:audit` (CUR-6).

**The rule this hole covers has already been broken here, and a person caught it rather than the
check.** `scripts/docs_gate/checks.py :: check_owner_voice` raises `owner-voice` on
`fl_frontend/src/app/globals.css` at `acee5209` and raises nothing on the same file at `d4eb0f44`,
measured 2026-08-27 by handing the checker both revisions with `.css` read as a C-style source.
Neither verdict is one the gate can reach, that file never being in the corpus. **That is this
entry's sharpest evidence, and it outweighs any count of what is currently clean**: COR-11 held in
the stylesheet most read for how this application looks only for as long as somebody swept it by
hand.

**Which way the disagreement should be settled is open, and the measurement is why.** Widening the
filter is not one line: `.css` has to reach `scripts/docs_gate/kernel.py :: CSTYLE_SUFFIXES` as
well, or `:: comment_style` hands the file to the `#` reader and every check runs over an empty
body — the silence closed OPS-29 removed, reproduced in a new place. The alternative is to say in the In-code
scope line where its checks stop, which is the cheaper change and leaves every block in the two stylesheets carrying this
application's styling reasoning under no bound at all. A third question rides on whichever is taken:
both files open on a block INC-2 admits in no stylesheet, and
`scripts/docs_gate/checks.py :: HEADER_SCOPES` would not bind either on a suffix addition, so a
widening has to settle that deliberately rather than inherit it — both blocks sit inside INC-9's
bound today, so nothing is through that half. **The outcome to avoid is neither**, the enforcement
claim and the silence both left standing, which is how the next over-long block gets written into
the file most read for how this application is styled.

**The byte checks are not in the gap, and no other file type is.**
`scripts/docs_gate/checks.py :: check_line_endings` and `:: check_binary_bytes` iterate the index
rather than the corpus, so CRLF and a stray CR are caught in a stylesheet as anywhere else.
Sweeping the five roots the In-code scope names for every other suffix the tuple omits, on the same date:
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
whichever way this goes. What holds its rank is the escape itself, demonstrated here rather than
supposed. It stays below **OPS-72**, whose subject is a test that reports an index proven when it is
not.

### 19 · OPS-74 — One field list is drift-guarded on the backend and hand-written on the frontend

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

### 20 · OPS-87 — A call site declares which key tier it sends, and nothing holds the declaration to the route it reaches

**Status:** Open\
**Surfaces:** FE, BE, Ops\
**Effort:** M\
**Path:** Independent — one candidate check over the frontend's query and mutation modules, and the
decision below is what building it has to be argued against. Nothing blocks it.

**`fl_frontend/src/core/api.ts :: apiClient` takes the key tier as an option and defaults it to
`base`, so a call naming no `authType` is authorized as the public app.** `getFetchHeaders` puts the
base key on the request, and the actor header rides on the admin tier alone, so an omission also
sends the call unattributed.

**The omitting direction is loud.** An admin router is guarded whole by
`fl_backend/app/core/security.py :: verify_access_admin`, so a base key reaching one is refused with
`REQ-AUTH-004` and the read or the write fails outright rather than succeeding under-authorized.
`fl_backend/tests/api/test_admin_guard.py` holds that backend half by comparing guards by identity.
**Nothing ships silently broken in this direction**, which is worth stating plainly: the cost of an
omission is a failure an administrator meets, not data reaching somebody it should not.

**The over-declaring direction is the silent one.** `authType: "admin"` on a call a public route
would have answered succeeds exactly as the narrower tier would, and the only differences are the
admin key on the wire and the actor header attached to a read that needed neither. Nothing reads a
call site to say its tier is wider than the route requires, and `.claude/CLAUDE.md` §7's ban on
caching an admin-scoped read makes the tier a decision with consequences past authorization.

**What exists is per-slice and hand-written.** `fl_frontend/src/features/bewerbungen/queries.test.ts`
and `fl_frontend/src/features/spielorte/queries.test.ts` each assert the tier on a recorded call, and
`fl_frontend/src/features/kontakte/actions.test.ts` matches `authType:` in its own mutations source;
every other feature's queries and mutations declare their tiers with nothing reading them, measured
2026-08-28. The two audit prompts that pair the halves end to end —
`docs/_auditing/prompts/crosscut/1-contracts-and-seams.md` and
`docs/_auditing/prompts/frontend/4-security.md` — do it by reading, on a schedule.

**What makes a mechanical pairing non-trivial is that neither side publishes the tier.**
`fl_backend/openapi.json` describes one `HTTPBearer` scheme and marks an operation as needing a
bearer token or not; which key it wants is a router-level dependency the document does
not carry. So a check would have to derive the backend half from the routers themselves and the
frontend half from the call sites, and that derivation — not the comparison — is the work.

**The decision is whether that is worth building** against a failure mode that is loud in one
direction and, in the other, costs a wider key on a request that would have succeeded anyway.

### 21 · OPS-68 — Two routes sharing a path and a method collapse to one before the guard sweep reads them

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

### 22 · OPS-83 — An in-transaction read's session argument is held to its comment by nothing

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

### 23 · DOC-13 — Every refusal code is written twice, and nothing resolves one spelling against the other

**Status:** Open\
**Surfaces:** BE, Ops, Docs\
**Effort:** S\
**Path:** Independent. The same shape as **OPS-83**, **OPS-63** and **OPS-69** — a claim written beside
the code and read by no check — and the host is `scripts/check_docs.py`, which already reads both of
the trees such a check needs.

**[`docs/logging/error-codes.md`](../logging/error-codes.md) is where a refusal code's meaning and its
HTTP status are stated, and the codes themselves are string literals in the backend — named constants
in the `services.py` of every slice that refuses, and inline at the raise in
`fl_backend/app/core/security.py` and `fl_backend/app/core/exception_handlers.py`.** [`docs/backend/spec.md`](../backend/spec.md),
[`docs/frontend/spec.md`](../frontend/spec.md), [`docs/domain.md`](../domain.md),
[`docs/glossary.md`](../glossary.md) and [`docs/logging/spec.md`](../logging/spec.md) each cite that
page rather than restating it, and so do most of the modules raising the codes —
`fl_backend/app/api/bewerbungen/services.py` names it in the comment standing above its refusal-code
constants, as do the `saisons`, `spieler`, `spieltage` and `teams` services beside it and
`fl_backend/app/core/security.py`. Not all of them do: `fl_backend/app/api/spiele/services.py` points
its block at [`docs/backend/spec.md`](../backend/spec.md) §1.4 instead, and
`fl_backend/app/api/schiedsrichter/services.py`, `fl_backend/app/api/spielorte/services.py` and
`fl_backend/app/core/exception_handlers.py` point at neither. It is the one document a reader opens to
learn what a code an admin surface just received means.

**Nothing resolves the two spellings.** No file under `scripts/` opens the page. The gate's identifier
check reaches the documentation standard's own rule ids and stops:
`scripts/docs_gate/checks.py :: RULE_ID_RE` is a closed alternation of the standard's prefixes,
and DOC-3 records that it is closed **on purpose**, so that a backend error code — which carries an
extra segment — can never be read as a rule id. A code added, renamed or retired in the backend and
missed in the table is therefore a silent divergence, and a row for a code nothing raises is the same
divergence read from the other end.

**The two sides agree today, which is what makes this cheap rather than urgent.** Compared on
2026-08-28: every `REQ-` code the backend spells takes a row, and every row's code is spelled by the
backend. What that costs to leave undone is a class rather than a defect — and the unwatched event is
frequent, because a branch adding a refusal adds a row by hand and nothing reads the pair.

**What the repair looks like, and the precedent for it.**
`scripts/docs_gate/kernel.py :: roadmap_ids` already derives a set of ids from the tables defining
them rather than matching a shape, and the roadmap check compares that set against the pages using it.
The same shape here is a set comparison in both directions between the codes the table's rows carry
and the codes the backend spells. **The published document is not the second source:** measured on
2026-08-28, `fl_backend/openapi.json` names seven of them, the rest reaching a caller without an
endpoint ever declaring them, so the constants under `fl_backend/app/` are the only complete side.
Every code is a whole string literal on both sides —
`fl_backend/app/api/spiele/services.py :: STATE_RESULT_ON_A_NON_EVENT` and
`:: STATE_NO_SHOW_WITHOUT_TWO_SIDES` are plain constants like the rest, and nothing composes one from
a status or from anything else — so a comparison between the two sets needs no tolerance for a
partly-spelled code. What a check reading the backend by SHAPE rather than by declaration would have
to tolerate is a glob in prose: `fl_backend/app/core/domain.py` writes `REQ-STATE-*` inside an
`Unenforced` reason, naming the pair rather than a code the table could carry a row for.

### 24 · DOC-15 — A refusal code's meaning is written three times in prose, and nothing resolves any pair of them

**Status:** Open\
**Surfaces:** FE, BE, Ops, Docs\
**Effort:** M\
**Path:** Independent. **DOC-13** is its neighbour and covers the SPELLINGS rather than the meanings;
a check written for that one enumerates the codes this one would need, so the two are cheaper in that
order — an ordering preference, not a block. The one instance ranked beside this was **BE-26** in
[`closed-items.md`](closed-items.md), and it is closed, so neither ranked page is holding an example
of the class.

**One refusal code carries its meaning in three written statements, and no check reads any of them.**
`fl_backend/app/core/domain.py :: RULES` gives each rule a `summary`;
[`docs/logging/error-codes.md`](../logging/error-codes.md) gives each code a row stating what it
refuses and with which status; and the frontend turns the code into the German sentence an admin or an
applicant actually reads, naming it as a string literal in each slice's `actions.ts`, in
`fl_frontend/src/shared/utils/actionError.ts`, and in
`fl_frontend/src/features/bewerbungen/utils.ts` for the public application form. **No figure is
quoted for how many**, deliberately: every branch that adds a refusal adds to all three listings and
has no reason to open this page, so a dated count here is stale by the branch after the one that
takes it — and the three listings named above ARE the count, each a grep from a reader who wants it.
The three sets agree today, which is what makes this a class rather than a defect.

**What the checks that exist do reach.** `fl_backend/tests/core/test_domain.py` resolves each rule's
`implemented_by` and `tested_by` and asserts the code appears in both; it opens no `summary`. On the
frontend the assertions are that a code maps to something at all and which field path it lands on —
`fl_frontend/src/features/bewerbungen/utils.test.ts` is the shape, and the refusal-path sweep in
`fl_frontend/src/core/refusalPaths.test.ts` holds that path to a rendered input. **Not one of them compares a sentence with the condition the backend refuses
on.** So a sentence describing a neighbouring fact passes every test, ships, and is read by the person
the refusal is for. **How close those facts sit is recorded in the code itself**: the comment above
`fl_frontend/src/features/bewerbungen/utils.ts :: mapBewerbungSubmitRefusal`'s arm for a club already
in the season warns that a second application and a club already playing read alike and only one of
them is what the backend refused, and **BE-26** in [`closed-items.md`](closed-items.md) was the same
confusion caught in a rule summary.

**Why it files beside DOC-13 rather than widening it.** DOC-13's repair is a set comparison between
two enumerations: complete, mechanical, and an afternoon. This one has no such form — nothing decides
whether a German sentence states the fact a predicate tests. Under one id the cheap half would close
the entry and the half that matters would leave with it.

**What a repair can and cannot reach, which is the decision.** A check can hold the three sets
together — every rule's code takes a row, every code a surface renders takes a sentence — and that is
DOC-13's shape extended by one side. What it cannot do is judge a meaning, so the rest is a place
where the three statements are read side by side and a rule about when they are re-read: a fourth
column on the table, or a generated comparison a reader walks.
`docs/_auditing/prompts/crosscut/1-contracts-and-seams.md`'s sixth check already asks a pass to trace
each error class through to the German it renders, so the reading exists and happens when a programme
runs rather than when a refusal changes. **Choosing between those is the work**, and the entry is here
rather than decided because the cheapest of them is also the one nothing enforces.

**Why it ranks where it does.** The first three tests leave it among the entries around it: nothing
ships wrong today, no date makes it worse, and what accumulates is one unread sentence per refusal
added. Test 4 places it below **DOC-13** — that one buys a complete answer for an afternoon, while
this costs more and can never answer the half that matters — and above **OPS-63**, whose population is
one comment about two files where this reaches every refusal the product can state.

### 25 · OPS-63 — A comment claims two files hold the same pattern, and nothing holds them to it

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

### 26 · OPS-69 — A declared-permitted state carries its reason in prose, and no checker reads it

**Status:** Open\
**Surfaces:** BE, Ops\
**Effort:** S\
**Path:** Independent. `fl_backend/tests/core/test_domain.py :: test_every_declaration_carries_its_reason`
already walks `UNENFORCED`, and the file already resolves three of an entry's fields, so the check
has a host and a precedent.

**`fl_backend/app/core/domain.py :: UNENFORCED` is the repository's record of states it permits on
purpose**, and each entry argues why in a `reason=` string — often naming an index, a validator or a
call site as the thing that makes refusing the state expensive or impossible.

**Those arguments are held by review alone.** `scripts/check_docs.py` scans comments and
docstrings, and a `reason=` is neither — it is a data string inside a tuple.
`fl_backend/tests/core/test_domain.py` resolves `near`, `surfaced_by` and `proven_by`, and reads
`reason` only for being non-empty — `:: test_every_declaration_carries_its_reason` asserts
`entry.reason.strip()` and never what the string claims. An index name inside one can be replaced
with a name that exists nowhere and every check still passes.

**Why it is worth closing rather than accepting.** An `UNENFORCED` entry exists to stop a later
reader re-litigating a decision, so a reason that has drifted is worse than none: it argues
confidently from something no longer true, and the states it covers are the ones nobody revisits.
The cheapest check is the one the file already invites — resolve every anchor and every index name
a `reason=` mentions, the way the three neighbouring fields are resolved.

### 27 · OPS-66 — The style directive concedes more than the reason recorded for it needs

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent. An nginx change, so the gate is the full form with the images built
([`docs/ops/spec.md`](../ops/spec.md) §1.6) and the deploy is watched: the config is mounted
read-only and nginx waits on both upstreams being healthy, so a bad block takes the site down rather
than turning something red.

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

### 28 · OPS-12 — Nothing checks a generated file against the generator that owns it

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

### 29 · DOC-14 — A file that arrives as a rename brings its comment blocks in as context, so INC-9 measures none of them

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent. **DOC-10** watches the same check from the other side — a block that was over
a bound before the branch reached it — and neither entry blocks the other.

**`scripts/docs_gate/branch.py :: check_comment_length` reads a block only where the branch
touched a line inside it, and a rename puts no line of a carried block in the branch's added set.**
`scripts/docs_gate/branch.py :: _added_by_file` derives that set from `git diff -U0` against the fork
point, deliberately without a pathspec so git has something to detect a rename against — its own
docstring says so. A detected rename emits hunks for the edited lines alone, so every comment block
that came across untouched is context, and INC-9 measures nothing in it at any length. Verified on
2026-08-28 by replaying `_added_by_file`'s parse over
[`d0ad46a4`](https://github.com/felzab/frankfurtleague/commit/d0ad46a4), where a renamed 27-line
component yields ten added lines and the rest of the file, comments included, is context under the
new path.

**The fork-side exemption does not reach this case.** Its ground is that a branch must not be failed
for prose it did not come to change. A file the branch moved is the branch's at its new path,
and no line of a carried block is one the branch declined to touch — every line arrived with the
move.

**Turning rename detection off is not the repair.** `_added_by_file` also feeds
`scripts/docs_gate/branch.py :: branch_additions`, which `check_history_phrases` and `check_counts`
read, so a moved file counted as wholly added would report every history phrase and every count
inside it as the branch's own prose. **The narrower question is the decision:** whether
`check_comment_length` alone should treat a rename's destination as added while the set the other
branch-scoped checks read stays as it is.

### 30 · DOC-2 — An enforcement claim is resolved in one direction only

**Status:** Open\
**Surfaces:** Docs\
**Effort:** M\
**Path:** Independent — a rule's `Enforced by` field and the check it claims move in one change.

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

### 31 · OPS-10 — Naming the files that required the image build costs a process per file

**Status:** Open\
**Surfaces:** Ops\
**Effort:** S\
**Path:** Independent — what the check answers does not change, only what the answer costs.

**`scripts/check_scope.py :: images_culprits` runs `scripts/ci_scopes.sh` once for every material
path**, to learn which of them is the reason the images scope is required. The cost scales with how
many files a branch touched rather than with what is in them.

**It is the last per-file spawn in this checker, and it sits on the failure path alone.** The
passing path reads every earlier version through one `git cat-file --batch`, and answers every
TypeScript pair through as few `scripts/ts_normalize.mjs` batch processes as one command line
holds, both driven from `scripts/check_scope.py :: material_paths`. What is left is therefore
charged only to a run already ending in the images refusal, which is why this sits last of the open
entries rather than among the work above it.

**What keeps it from being free.** `scripts/ci_scopes.sh` answers for a file list, not for a file,
so nothing it prints says which member of the list turned a scope on — asking it once per path is
what buys that. The alternatives are a per-file mode in the mapping script, which puts a second
output shape in the one file every workflow reads, or halving the list until each culprit is
isolated, which is more machinery than a failure path deserves.

**What must not change.** The refusal has to keep naming the files, and keep naming all of them: an
answer that reports one culprit, or none, removes the only thing telling an author which change
asked for the image build. CLAUDE.md §7 holds separately that the comment classifier must never give
a CI job a way to shrink itself, so nothing here may narrow the set of paths the mapping is asked
about.

**Not measured:** what the spawn actually costs, and how much of a failing gate run is attributable
to it. The mechanism above is read from the code; the magnitude is not.

### 32 · OPS-2 — Nothing validates the contents of a restored `.env`

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

**What the deploy already does about an unhealthy build, and why none of it reaches this.**
`scripts/deploy.sh :: roll_back` restores the previous pair by image id wherever the run recorded a
target, and the unhealthy ending points the operator at the frontend's startup gate
(`fl_frontend/src/core/config.ts`) as the first thing to read. **Both stop short of this incident.**
A re-clone records no rollback target, so there is nothing to put back; and the value that broke is
the backend's `MONGODB_URI`, which the startup gate parses no further than its scheme
(`fl_backend/app/core/config.py :: validate_mongodb_uri`). Each bounds the window on an ordinary bad
deploy, which is the ground the trigger below stands on.

**Trigger to revisit:** the second time a restore breaks this way, or a move to a setup where the
site cannot tolerate a restore that produces an unusable value on a host with no previous build to
fall back to. Ops audit pass O1 (`docs/_auditing/prompts/ops/1-build-deploy.md`, check 4) covers
script failure modes and owns this.

### 33 · OPS-3 — The crawler policy is split between robots.txt and Cloudflare, and neither knows about the other

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

### 34 · DOC-3 — A rule pattern in the documentation gate reaches less than the rule it enforces

**Status:** Standing\
**Surfaces:** Docs\
**Effort:** —\
**Path:** Independent — no pass covers it, and only the triggers below reopen it.

**Not a defect today, and the corpus is why.** Each pattern below matches everything the repository
currently holds. Each is also narrower than the rule it serves, and where it falls short the gate
answers with silence rather than a finding.

**The rule families are spelt into the patterns.** `scripts/check_docs.py :: RULE_ID_RE` carries
the standard's prefixes as a closed alternation, and `scripts/docs_gate/checks.py ::
RULE_HEAD_RE` and `:: RULE_INDEX_LINE_RE` repeat the same list. A rule family added under a
prefix none of them carries falls outside all of them at once: citations of its rules resolve
to nothing and dangle unreported, and its rules are not held to PRE-4's anatomy. Widening the alternation by hand is not the answer, because the list is closed so that the
backend's error codes — which carry an extra segment — can never be read as rule ids. A pattern
whose prefixes disagree with the standard is a divergence the gate could resolve on its own, the way
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

**Trigger to revisit:** a rule family added to the standard under a prefix the patterns do not
carry, or the first page that needs a metadata block indented.

### 35 · DOC-10 — A block already over a bound is excused by its opening line alone

**Status:** Standing\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent — one comparison in one function. **DOC-14** reaches the same check from the
side where no line of the block was touched at all, and neither blocks the other.

**`scripts/docs_gate/branch.py :: check_comment_length` measures a block this branch touched and
excuses one whose OPENING LINE already broke a bound at the fork.** The opening is what identifies a
block across an edit deeper inside it, where a line number moves with every insertion above. So a
branch rewriting the prose inside a long block is not charged for its length, and a branch rewriting
that block's first line is.

**That boundary is deliberate, and it is the residue worth watching.** Rewording a summary line is an
ordinary edit, and it hands the whole block's length to whoever made it — the cost the exemption
exists to avoid, narrowed to one line rather than removed. Reconstructing the fork-side block from
the diff's own removed lines would close it, and that is a mechanism with its own failure modes,
built against a cost nobody has met yet.

**Measured on 2026-08-30, on the branch that made the change:** twenty blocks over a bound were
touched, and not one of them had been over that bound at the fork — so the exemption fired for
nothing and charged nobody. That is one branch rather than a history, and it is what this caution
rests on.

**Trigger to revisit:** a branch charged for a block whose length it did not create, or any change to
how `check_comment_length` decides whose block a block is.

### 36 · OPS-81 — One commit imports a frontend module the commit after it adds

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

### 37 · OPS-101 — The backend, database and frontend jobs have taken a step up in wall clock that no report named

**Status:** Open\
**Surfaces:** FE, BE, Ops\
**Effort:** M\
**Path:** Independent — it blocks nothing and nothing blocks it. It is **OPS-60**'s subject one level
out: that entry is the shape of a local full-form run, this one is what CI actually spends per job
over time. It has a clock the entries below it do not, and that is what puts it here rather than
beside the other cost entries: the reference table
[`.github/gate-wall-clock.tsv`](../../.github/gate-wall-clock.tsv) is calibrated on a tree that
already carries the step, so until this is judged the report treats the higher figure as normal.

**The measurement.** Read on 2026-09-01 from the runs API, over every `verify.yml` run on a push to
main: a job's span is its first step's start to its last step's end, and each figure below is the
median of the last twelve completed main runs against the twelve before them.

| Job          | last twelve | previous twelve |  delta | reshuffle p95 |
| ------------ | ----------: | --------------: | -----: | ------------: |
| `backend-db` |      67.5 s |          52.0 s | +29.8% |         24.3% |
| `backend`    |      38.0 s |          32.0 s | +18.8% |         15.6% |
| `frontend`   |     120.5 s |         107.0 s | +12.6% |          9.7% |

**The reshuffle column is what makes those three a finding rather than three numbers.** Shuffling the
same twenty-four samples at random and re-cutting them into two windows moves each median by the
percentage in that column at p95 — so a delta under it is the cut and not a change. All three sit
above their own p95, and no other job does: `images` at −2.1%, `changes` at −5.6% and `scripts` at
−5.2% are all inside p50.

**The figures are understated rather than generous.** The floor in the last column is computed from
the same twenty-four samples that contain the shift, which inflates it; and the population is
successful runs only, so a run slow enough to fail or to reach `timeout-minutes` is outside the
sample entirely.

**What it is not.** These runs are GitHub-hosted, so no local machine's load reaches them; queue time
is out of the span by construction; and the direction is consistent across three independent jobs
rather than one, which a runner-pool artefact would not be.

**What answering it needs.** The three jobs share `scripts/verify.sh` and little else, so the first
question is whether one cause or three are involved — the backend pair points at test count or
collection time, `frontend` at the build. The window that identifies the cause is on record now; the
runs API prunes, and the candidate commits stop being few. **Closing it re-measures and rewrites
`.github/gate-wall-clock.tsv`**, whose figures are the ones this entry says are too high.
