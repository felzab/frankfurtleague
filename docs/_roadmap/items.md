# Open items

**Purpose:** everything open on the product, the toolchain, the gate and the documentation corpus —
each entry carrying the analysis its decision needs. How an entry is authored, tagged and closed is
[`protocol.md`](protocol.md)'s.

| Section                                               | Answers                                                  |
| ----------------------------------------------------- | -------------------------------------------------------- |
| [What every entry carries](#what-every-entry-carries) | Which fields an entry states, and what each one may hold |
| [The items at a glance](#the-items-at-a-glance)       | Every item, its tags and its status                      |
| [The items](#the-items)                               | Each entry in full                                       |

## What every entry carries

An entry is a ``### `<token>` · <the claim>`` heading, then one table of the three fields below, then
the analysis, and it says what is wrong, why it matters and what done looks like. Analysis stays
only where it changes the approach — a rejected alternative written as a present constraint, or a
trap the implementer would otherwise walk into. Everything else goes to the body of the commit that
files the entry, which `git log -S` reaches.

| Field          | Holds                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tags**       | Every axis below that the paths the entry names fall under. Derived from the entry's own text, never chosen: a tag disagreeing with what is written is the failure this field exists to catch |
| **Status**     | One value from the closed set [`protocol.md`](protocol.md) derives                                                                                                                            |
| **Depends on** | The token of an entry here that blocks this one, or an em dash                                                                                                                                |

**A token is eight characters from `abcdefghjkmnpqrstuvwxyz23456789`, hyphenated after the fourth** —
no `i`, `l`, `o`, `0` or `1`, because a token is read aloud and typed into a commit trailer.
It is generated at random when the entry is filed rather than allocated from a sequence, checked for
collision with one `git grep`, and carries no order and no meaning. It is never reused, and a
closing commit's trailer names it.

**Tags come from three axes, and an entry carries every tag its own text earns.**

| Axis        | Vocabulary                                                                      | Derived from a path or symbol under                                                |
| ----------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Surface** | `FE`                                                                            | `fl_frontend/`                                                                     |
|             | `BE`                                                                            | `fl_backend/` whole, `tests/` included                                             |
|             | `DB`                                                                            | a collection name, an index, `fl_backend/app/core/crud.py`                         |
|             | `Ops`                                                                           | `scripts/`, `nginx/`, `.githooks/`, `.claude/hooks/`, a compose file, a Dockerfile |
|             | `Docs`                                                                          | `docs/`, `.claude/`                                                                |
| **Concern** | `gate`                                                                          | `scripts/gate/`, `scripts/checks/`, `.githooks/`, `.claude/hooks/`                 |
|             | `ci`                                                                            | `.github/` whole, not its `workflows/` and `actions/` alone                        |
|             | `tests`                                                                         | `scripts/tests/`, `fl_backend/tests/`, a `*.test.ts`                               |
|             | `edge`                                                                          | `nginx/`, Cloudflare, a compose service definition                                 |
|             | `versions`                                                                      | a manifest, a lockfile, a pin, a digest                                            |
| **Slice**   | the directory names under `fl_frontend/src/features/` and `fl_backend/app/api/` | a whole path segment matching one of them, anywhere in the path                    |

**`BE` reaches the whole package rather than its `app/`**, because a backend test otherwise carries
`tests` and no surface at all, which hides a backend failure from a reader filtering on `BE`. `Docs` covers `docs/` and `.claude/` under one tag, and no second tag splits them: both trees are
documentation to the reader filtering on it. A hook under `.claude/hooks/` earns `Ops` and `gate`
beside it, being a guard the gate probes. `DB` and `versions` are the two a path
need not produce — a collection name and a manifest are named in prose — so either may stand where
no path derives it, and neither may be missing where one does.

**A slice matches a whole path segment and never a substring**, because German compounds a term into
a longer word meaning something else: `spiele` sits inside `spieler`, and both are live slices with
large trees, so a substring match tags every `spieler` path as the most-used slice in the repository.
The segment matches anywhere in a path rather than under the two roots alone, so
`fl_frontend/src/app/admin/aktionen/` earns `aktionen` from the route tree as well as from the
feature package. Eleven slices are spelled the same on both sides; `admin`, `auth`, `dashboard` and
`meta` exist on the frontend alone. **An entry naming no path carries no tag**, and that is a finding
rather than a default: an entry nobody can place is one whose subject is not stated.

**A status is derived, never chosen**, by the first matching row of
[`protocol.md`](protocol.md) — which is also where each value's meaning is fixed. A closure
re-derives every entry's, not only its own, because `Blocked` is a claim about another row.

**An entry may carry one `Lands with:` line** naming the tokens it shares a pass with. It is deleted
when any member of that batch lands, so it is either current or gone. Relatedness by subject is
never written there: the tags already answer it.

Some entries are seeded into an audit pass under `docs/_auditing/prompts/` as one of its starting
checks. Some are issue-shaped feature work parked here at my direction, so that one place holds what
is outstanding; everything else belongs here only while the reasoning, rather than the work, is the
deliverable.

## The items at a glance

| Token       | Item                                                                                                                         | Tags                                                                        | Status   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| `2rz3-a754` | A colliding pair split across the read's cap is marked at neither end                                                        | FE, BE, Ops, Docs, edge, bewerbungen                                        | Open     |
| `2v3g-9g2y` | The root not-found page renders without the shell every other page has                                                       | FE                                                                          | Open     |
| `32bs-nhzd` | Every write is recorded, and nothing restores one past the editor's fifteen seconds                                          | FE, BE, DB, Docs, spiele                                                    | Open     |
| `3hb2-3d9q` | One test file dies under the gate's parallel load and names no cause                                                         | FE, Ops, gate, tests, saisons                                               | Open     |
| `3pb5-7qyc` | `--accent-info` has no `-solid` grade and no on-colour, and nothing records why                                              | FE, Ops, Docs, gate                                                         | Open     |
| `3s6w-kndn` | A local gate run's wall clock is the scripts suite or the frontend build, and the one lever left is inside the scripts scope | Ops, Docs, gate, ci, tests                                                  | Open     |
| `4ad2-vz8k` | The test client reaches anyio through a deprecated alias, and no line in this repository declares either package             | BE, ci, tests, versions                                                     | Standing |
| `645h-nj9q` | The linter runs a version past its end of life, and the documentation for it describes another                               | FE, Docs, versions                                                          | Standing |
| `6m3r-xpcu` | Every replacement for the component library is either a restyle of the foundation it already stands on or a full rewrite     | FE, Docs, versions                                                          | Open     |
| `6zuv-9tkx` | Nothing here can render a Server Component, so no check reaches the boundary rule the repository already states              | FE, Docs, tests                                                             | Open     |
| `7wne-u6hm` | Three test modules each open a cache scope through the same React internal                                                   | FE, tests, saisons, spiele, teams                                           | Open     |
| `8wd7-ff49` | The consent field has a schema and a ruled writer, and no flow that writes it                                                | FE, BE, Docs, meta, spieler                                                 | Blocked  |
| `9s24-rvgc` | The email shell's token floor is a fixed number well under what its parse finds                                              | FE, Ops, gate, tests                                                        | Open     |
| `buut-5cyw` | An undo restores a whole stored fixture from a list read before the save                                                     | FE, BE, Docs, admin, spiele                                                 | Open     |
| `ceqd-e4aq` | An admin table's declared floor can be wider than the viewport its layout starts at                                          | FE, Docs, tests                                                             | Open     |
| `cvub-qx5s` | `NOTICE` asserts the source copyright of a natural person while an association publishes the site                            | FE, meta                                                                    | Open     |
| `dq3b-mgpq` | Every tone tint falls under the text floor on a `muted` ground, and one tab strip puts pills there                           | FE, Ops, gate, admin                                                        | Open     |
| `ex2m-qjkg` | The season's shape is offered wider than it can be saved, and two of its three fields have no contiguous legal range         | FE, BE, Docs, tests, saisons, spiele, teams                                 | Open     |
| `f38s-y3hj` | A sweep taking `.tsx` alone decides no test file, and the spelling keeping its fixtures out is refused by nothing            | FE, Docs, tests                                                             | Open     |
| `f3ar-m4qf` | Setting up a season is a hand-run sequence, and only an admin can enter a squad                                              | FE, BE, DB, Ops, Docs, edge, bewerbungen, kontakte, saisons, spieler, teams | Open     |
| `f4uf-jape` | A copy test compares source text against a literal its own author typed                                                      | FE, BE, Docs, tests, saisons, teams                                         | Open     |
| `gbjj-9wfh` | A test fixture asserts its own type, and the assertion is the only thing holding it to the model                             | FE, tests, admin, saisons, spiele, spieltage, teams                         | Open     |
| `hnx7-zbb9` | One field list is drift-guarded on the backend and hand-written on the frontend                                              | FE, BE, tests, saisons                                                      | Open     |
| `hq7d-2vnm` | The required-mark guard reads literal names only, so a shared field block is unguarded                                       | FE, tests                                                                   | Open     |
| `huzh-hdfx` | A never-clause bounds what a stylesheet may say about a toast, and the stylesheet says more                                  | FE, Docs                                                                    | Open     |
| `k4wq-8mvr` | Every failure carries a closed class beside its code, and the register's kinds are held by a check                           | FE, BE, Ops, Docs, gate, tests                                              | Open     |
| `m4m3-hxmj` | The shared editor shell's widest layout step has never been rendered                                                         | FE, Docs                                                                    | Open     |
| `nadg-bnjb` | Every admin write states its success twice, and the second sentence cannot render                                            | FE, auth, spiele, spielorte, teams                                          | Open     |
| `nbcn-zvdk` | The panel a triage decision is taken from is rendered by no test                                                             | FE, BE, Docs, tests, admin, bewerbungen                                     | Decided  |
| `nce5-j467` | A comment claims two files hold the same pattern, and nothing holds them to it                                               | FE, BE, tests                                                               | Open     |
| `njhn-pmtn` | Every call site writes a fallback for a failure message that always arrives                                                  | FE, Docs                                                                    | Open     |
| `pa6f-ksu4` | A season id that is no year is refused nowhere, and first noticed by an hourly sweep failure                                 | BE, DB, Docs, bewerbungen, saisons                                          | Open     |
| `pb66-krbw` | A fixture carries one date, and a play window cannot be expressed                                                            | FE, BE, spiele                                                              | Open     |
| `pw5c-zps5` | A referee gets no consent record, where a contact person confirms their own                                                  | FE, BE, DB, Docs, meta, schiedsrichter, spieler, teams                      | Open     |
| `qg8u-tbd6` | One test module is named for a function and holds the cases of two others                                                    | FE, Docs, tests                                                             | Open     |
| `qstz-dwrj` | Only the match editor tells an admin which empty field somebody is waiting on                                                | FE, BE, Docs, admin, spiele                                                 | Open     |
| `qw6j-scru` | Two colour swatches and one library attribute are what a fix has to reach before `style-src 'self'` can ship                 | FE, Ops, Docs, gate, edge, admin, auth, bewerbungen, spieltage, teams       | Open     |
| `skyx-nrgh` | A refusal composes a repair the product refuses to perform                                                                   | FE, BE, Docs, tests, saisons                                                | Open     |
| `suuz-dged` | Frontend test modules hook their whole process, so the runner's one-process mode is closed and nothing says so               | FE, tests, versions                                                         | Open     |
| `t3xf-s5hy` | The confirm-panel sweep discovers its roster by the hook a panel calls, so a hand-rolled one is never a subject              | FE, Docs, tests                                                             | Open     |
| `tbh5-u4c3` | The browser's own chrome takes no colour from the season scheme                                                              | FE, tests                                                                   | Open     |
| `tutf-44dk` | Three non-text pairs sit under 3:1 in the dark theme, and no row measures one                                                | FE, Ops, gate                                                               | Open     |
| `uayf-u7g4` | The crawler policy is split between robots.txt and Cloudflare, and neither knows about the other                             | FE, Ops, Docs, edge                                                         | Standing |
| `v7bs-d859` | The frontend keeps a visual system that no document states                                                                   | FE, Docs                                                                    | Open     |
| `v9tn-3hce` | The log answers what broke and hardly what happened                                                                          | FE, BE, Docs                                                                | Open     |
| `vgk8-btxt` | What decides whether a module belongs in `core` or in `shared` is written nowhere                                            | FE, Docs                                                                    | Open     |
| `vspa-r35v` | One commit imports a frontend module the commit after it adds                                                                | FE, Docs, ci, tests, saisons                                                | Standing |
| `w2c2-xc9j` | One tag strip repeats until it is done, and every other reader of markup as text makes a single pass                         | FE, tests, saisons                                                          | Open     |
| `w4tm-9khd` | A sweep reads a JSX opening tag by its first angle bracket, so attribute order decides its population                        | FE, tests, spieler                                                          | Open     |
| `z82x-us4y` | A contract sweep's caller set is every file naming the client, its own tests included                                        | FE, BE, tests                                                               | Open     |
| `z8nf-7nzd` | `typing` imports instead of `collections.abc`                                                                                | BE, Docs, versions                                                          | Decided  |
| `zp46-yt3p` | No exact placing is available above the certainty walk's fixture limit                                                       | BE, Docs, saisons, teams                                                    | Standing |

## The items

### `2rz3-a754` · A colliding pair split across the read's cap is marked at neither end

| Tags                                 | Status | Depends on |
| ------------------------------------ | ------ | ---------- |
| FE, BE, Ops, Docs, edge, bewerbungen | Open   | —          |

**The duplicate marking runs over the rows one read served.**
`fl_frontend/src/features/bewerbungen/duplicates.ts :: findBewerbungDubletten` walks the list the page was
handed, groups the `eingereicht` rows on season plus club or season plus Kürzel, and marks every member of a
group of two or more. `fl_backend/app/api/bewerbungen/router.py :: get_bewerbungen` serves at most
`fl_backend/app/shared/schemas/bounds.py :: LIST_LIMIT_DEFAULT` rows and reports when its answer was cut. A
colliding pair split across that cut falls into no group, so neither half is marked and nothing names the pair
— the notice can say that a pair is unmarked and cannot say which.

**That is not cosmetic, because the marking is what the write's silence buys.** Uniqueness on an
unauthenticated form is itself a denial of service, so the write refuses no duplicate and the queue
shows them instead; a queue that shows them across part of its set honours that ruling across part
of its set.

**A decision leaves the row, and the queue does not serve it by default.**
`fl_backend/app/api/bewerbungen/admin_router.py :: ablehnen_bewerbung` sets `status` to `abgelehnt`
and stamps who decided and why; the row stays, deliberately, the submission being the record the
decision was taken against. The triage page sends the status its bar selects
(`fl_frontend/src/features/bewerbungen/facets.ts :: bewerbungenQueueStatus`), open by default, so a
decided application leaves the working set while staying one press away. No endpoint removes an
application, so the row itself is permanent.

**Two answers are closed, and each looks right from the code alone.**

- **Per-school uniqueness on the write is refused by my ruling.** An index over unauthenticated
  input hands whoever fills the field first the power to own it, so a real school meets a refusal
  holding its own name and the rule meant to protect it locks it out. The marking is what the league
  has **instead** of that index, and the argument is recorded at `findBewerbungDubletten` and stated
  again in `docs/frontend/spec.md`.
- **Pagination is refused because a cursor splits the set the marking runs over.** Paging would
  remove the mechanism the ruling above rests on, and remove it silently, with no surface saying
  that a pair split across a page boundary goes unmarked —
  `fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungenListResponse`'s own declaration records
  that the list is served whole for exactly this reason. It also lands in the facet: the status counts now come
  from the server (`docs/backend/spec.md :: I193`) and would survive it, but a page holding one
  season's rows leaves every other season at zero, so the cross-season view goes dead.

**Done when** a colliding pair is marked or named however the read was cut. The queue now narrows on
the server and the bar is told the counts it cannot derive
(`fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungenListResponse`), so the cap is spent on the
status being triaged rather than on the archive — which shrinks the window without closing it.
**There is no bulk action**, so clearing a flood is one press per row, each with its own
confirmation and its own round trip.

**What bounds the severity.** Reaching the state takes a deliberate flood: the ceiling is
`nginx/prod.conf`'s `bewerbung48` zone, whose own comment puts filling the list from a single
allocation at roughly three hours of sustained work, and closing the season's application window
stops new rows at once.

**What is read and what is not** (COR-9). Every gap above is read off a branch rather than measured:
`findBewerbungDubletten`'s loop, `ablehnen_bewerbung`'s `$set`, and the list `countFacetOptions` is
handed. **Nothing here was driven against a truncated queue.**

### `2v3g-9g2y` · The root not-found page renders without the shell every other page has

| Tags | Status | Depends on |
| ---- | ------ | ---------- |
| FE   | Open   | —          |

**`fl_frontend/src/app/not-found.tsx` renders no navigation and no footer**, so a visitor who
lands on a retired address — `/team`, which this branch removed, is the live example, and every
mistyped URL is another — meets a page whose only exits are a "Zurück" button and a link to the
start page. Every other page on the site carries the public shell.

**Why it matters.** A 404 is one of the most-reached pages on any site with an index history, and it
is the page where a visitor is least sure where they are. Dropping the navigation there removes the
one affordance that recovers them, and it makes the page look like a different site.

**The trap.** The shell is a layout, and `not-found.tsx` at the app root sits ABOVE the
`(public)` route group whose layout carries it, so wrapping it means either moving the file into
that group — which changes which unmatched URLs it answers — or lifting the shell. Neither is a
one-line change, which is why this is filed rather than folded into the brand refresh.

**Done when** an unmatched URL renders the public navigation and footer, and a test pins that it
does.

### `32bs-nhzd` · Every write is recorded, and nothing restores one past the editor's fifteen seconds

| Tags                     | Status | Depends on |
| ------------------------ | ------ | ---------- |
| FE, BE, DB, Docs, spiele | Open   | —          |

**The recording exists and the restore over it does not.** Every write funnels through
`fl_backend/app/core/crud.py` and is recorded with the actor, the request, the collection, the
document and the image the write replaced (`fl_backend/app/core/recording.py`); `/admin/aktionen`
lists the rows and narrows to one document's history. A row therefore holds what a replay needs, and
replaying one is a small change over the undo spine the entity editors already share
(`fl_frontend/src/shared/utils/undoDispatch.ts :: offerUndo`). What is missing is the control that
does it: a restore offered on a log row, past the editor's fifteen-second, browser-held undo — one
that survives a reload and reaches a write nobody was watching at the time.

**The write worth building it for is the one nobody asked for.** Applying a bracket advancement
clears the advanced fixture's `ergebnis`, its `elfmeterschiessen` and a no-show recorded on it
(`fl_backend/app/api/spiele/crud.py :: advance_bracket_winners`), so correcting a quarter-final
deletes a semi-final scoreline that a person had entered, as a consequence of an edit somewhere
else. That destruction is recorded and attributable; recoverable past the fifteen seconds is what
this entry adds. Until it lands, an unrestorable write is recovered by hand from the row that
recorded it — slowly, which is the cost of leaving this open rather than a loss.

**What blocks it is a measurement.** `docs/frontend/spec.md` §1.3 admits a route handler for a
page-owned editor and refuses one for a row control, and a restore on a log row is a row control.
Whether Next's E592 reproduces on a page that stays mounted is what decides between a server action
and a route handler of its own, and nobody has measured it.

**Retention is built, and it is this entry's reach.** `docs/backend/spec.md :: I119` expires a stamped
log row twelve months after the write it recorded, and a restore reaches a write only while its row
stands, so the retention bound is the restore's reach. A row carrying no stamp is expired by
nothing, and its values leave at the once-only reset in `docs/datenschutz.md :: 3` instead.

**Two kinds of write sit outside what any restore could replay — a pupil's erasure, and taking a
season's draw away — and for different reasons.** The erasure keeps no image at all, the values
being what it destroys; the removal, whether a confirmed replace or an undraw that writes none back,
keeps an array of every removed document, and `/spiele` has neither a create nor a delete, so
nothing exists to replay one into (`docs/backend/spec.md :: I48`, `:: I26`). Both are records for a
person to read rather than anything a restore can reach, which is a bound on this entry rather than
work inside it.

**How far the log page can reach past its one read is not this entry's.**

### `3hb2-3d9q` · One test file dies under the gate's parallel load and names no cause

| Tags                          | Status | Depends on |
| ----------------------------- | ------ | ---------- |
| FE, Ops, gate, tests, saisons | Open   | —          |

**A file the branch does not touch can fail the frontend section of `scripts/gate/verify.sh` at file
level, with no case named under it.**
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/undrawSpielplan.test.ts` is
the file it has happened to. Run on its own it passes, repeatedly; the whole suite run beside it
passes with every case green; and a second full gate run is green. What separates the failing run
from the passing ones is the load the section runs its suite under.

**A file-level failure is the shape that hides the cause.** `node --test` reports a file whose
process exits non-zero as a single failing test named for the path, so a worker killed under memory
pressure, a module that never loaded and a case that never reported all arrive as one line with the
same text. Nothing in the output tells them apart, which leaves another full gate run as the only
available diagnosis — the most expensive one there is, and green more often than not.

**Which half this is has not been established.** Whether it is this file interacting with the load —
the frontend section runs the suite beside a type check, a lint and a formatter — or a runner-level
fault that would land on whichever file was unlucky is unknown, and treating it as either is a guess.
The entry is filed against the diagnostic rather than against the file for that reason: whichever
half it turns out to be, the run that produces it has to say so.

**Done when** a file-level failure in the frontend section carries something a reader can act on —
the worker's exit status and its stderr, or the runner's own diagnosis — so the next occurrence is
read off the run that produced it rather than off a rerun.

**What is read and what is not** (COR-9). The passes are runs: the file alone, and the whole suite
after it. The failure is one gate run's report, not reproduced since. Nothing was instrumented, no
worker's exit status was captured, and no second file has been seen to fail this way, so the
population this reaches is unmeasured.

### `3pb5-7qyc` · `--accent-info` has no `-solid` grade and no on-colour, and nothing records why

| Tags                | Status | Depends on |
| ------------------- | ------ | ---------- |
| FE, Ops, Docs, gate | Open   | —          |

**`fl_frontend/src/app/schemes/2027.css` declares `--accent-brand-solid` with `--fg-on-brand`
and `--accent-success-solid` with `--fg-on-success`, and gives `--accent-info` neither.** The tone
therefore has no fill a white glyph may sit on, while `brand` and `success` do. Nothing in the
scheme, in `docs/frontend/spec.md`'s token-role table or in the commit that wrote the file says
whether that is a decision or an omission.

**Why it matters.** The next surface needing a solid informational fill — a filled state badge, a
tile, a selected day — has three moves available and no way to choose between them: invent the two
tokens, spend `brand-solid` on something that is not the brand, or use a tint where a fill was
wanted. The first is a scheme change that every future season file inherits, so it is the one that
must not be made casually.

**Done when** either the pair exists and `scripts/checks/docs_gate/scheme.py :: PAIRS` measures it,
or a comment in the scheme file says which surfaces are meant to go without it.

### `3s6w-kndn` · A local gate run's wall clock is the scripts suite or the frontend build, and the one lever left is inside the scripts scope

| Tags                       | Status | Depends on |
| -------------------------- | ------ | ---------- |
| Ops, Docs, gate, ci, tests | Open   | —          |

**The profile re-taken on 2026-09-07, two full-form runs on the idle 16-core machine, `ps` sampled
every two seconds:** every worker was first seen within seven seconds of the start, the runs took
139 and 131 seconds, and the two sections that bind them trade places within that spread: the
`frontend` build closed last in the first run at 134 against the `scripts` section's 122, and the
`scripts` section closed last in the second at 126 against 90, its pytest run over `scripts/tests/`
(`scripts/gate/verify.sh :: do_pytest`) the unit still running; `images` closed at 95 and 45 (a cold
and a warm layer cache), `format` at 88 and 91, `backend` and `db` at 42 to 45, `docs` at 27, `ops`
at 15 and 36. In CI the frontend job binds outright, 122 seconds against the scripts job's 52
(`.github/gate-wall-clock.tsv`), which is `g489-8ptk`'s subject. The tail the 2026-08-26 profile
described, forty seconds of `db` alone at six to twenty per cent, is gone: the tier closes inside
both sections' span. `scripts/gate/gate_pool.py :: TYPICAL_MS` carries the same profile as its
ranking.

**Lever 1, the distributed database tier, is taken and measured.** On the idle machine, each width a
pair of runs within a fifth of a second of each other, the tier took 30.1 seconds at two workers,
24.0 at three, 21.0 at four, 18.5 at six and 19.2/19.4 at eight, against 48 to 49 at one worker over five
runs of which no pair converged, so the distribution took thirty seconds off the tier and the cap
and floor `scripts/gate/verify.sh :: GATE_WIDTH_DB_PYTEST` and `:: GATE_WIDTH_DB_PYTEST_FLOOR`
carry sit on those readings. Whether the shared server becomes the
new tail past eight, and whether `WriteConflict` appears at a wider width, is unmeasured and
belongs inside the width question.

**Lever 2 is the one left, and it is now the live one.** `scripts/tests/test_check_docs.py :: _load`
copies `scripts/` into a throwaway repository and imports the gate from the copy, `:: _STATE`
memoising it so the build is paid once per process; the scripts suite that carries it binds the run
at 122 seconds inside a full form against 54 alone at eight workers. A worker is a process, so the
lever carries lever 1's second problem in miniature, as many fixture builds as workers, and what it
gives back is bounded by the self-check running beside it in the same pool, which costs 45 seconds
alone and 97 inside a run because it waits on the machine rather than works
(`.github/gate-wall-clock.tsv`'s `scripts` paragraph carries the readings).

**Lever 3, distributing the default tier, is rejected against this profile.** The section running
it closes at 45 seconds, well inside the scripts section, and a tier with no database and no
container spends a real fraction of itself in interpreter startup, which a worker pays again per
process. `.claude/CLAUDE.md` §7's `tests` clause closes the other obvious answer to any tail: no
db-marked test leaves the gate.

**Two scopes writing one `__pycache__` is not a coupling, and a chain must not be added on that
reasoning.** `docs` and `scripts` have shared two of those directories unconstrained since the pool
was written: CPython writes a bytecode file to a temporary name and renames it, nothing in this
repository reads pytest's `nodeids`, and `lastfailed` is written only when its value changes and
steers only `--lf`, which the gate never passes. The argument in full is in the commit
`git log --all --grep lastfailed` returns, and it is worth reading before any scope here is made to
wait on another.

**What a change to any of this owes.** `scripts/lib/_lib.sh :: finish` owns the four-code exit
contract's classifier, its ladder is `:: _RANK_LABELS` and its codes are declared in
`scripts/lib/checker_kernel.py` and driven by `scripts/tests/test_exit_contract.py`, so anything
reaching that file re-opens the contract's measured rank, finding and exit combinations; anything
reaching how the self-check's probes execute owes a before-baseline, a verdict-set diff and a
required zero, **because a probe that has stopped firing looks exactly like a probe that passes**. A
db-tier change owes the harder version of the same: those verdicts are what a branch rests on, and a
worker that silently cleared a neighbour's seeds fails somewhere else entirely.

**Done when** lever 2 has been taken or rejected against a profile of the same shape, every figure
quoted carrying its spread and its run count, and a lever worth taking beats the run's own spread
rather than one sample inside it. **How a start is read off a run rather than inferred:** sample
`ps` while a full-form run is going and record when each worker's process first appears, which
separates a scope that is slow from one that started late.

### `4ad2-vz8k` · The test client reaches anyio through a deprecated alias, and no line in this repository declares either package

| Tags                    | Status   | Depends on |
| ----------------------- | -------- | ---------- |
| BE, ci, tests, versions | Standing | —          |

**Importing starlette's test client emits one `DeprecationWarning` naming `anyio.abc.BlockingPortal`,
and the import is what emits it rather than any test.** That module binds its portal-factory type at
module level from the alias, and the installed anyio serves the name through a deprecation hook that
warns and redirects to `anyio.from_thread.BlockingPortal`. `from __future__ import annotations` at the
top of the starlette module does not defer the access — it defers annotations, and this is a plain
assignment — which is the reading most likely to talk somebody out of checking. Verified 2026-09-07 by
importing the module in this backend's virtualenv with warnings recorded: one warning, raised from
that assignment. Both packages move without us.

**What the removal of that alias costs is four collection errors.**
`fl_backend/tests/api/test_actor_binding.py`, `fl_backend/tests/api/test_admin_guard.py`,
`fl_backend/tests/api/test_bewerbungen_read.py` and `fl_backend/tests/api/test_error_responses.py`
each import `TestClient` from `fastapi.testclient`, which is the same starlette module. The failure
would land where a module is collected rather than in an assertion anybody can read as a product
defect — the default backend tier turning red at once, naming a package this repository never asked
for.

**Neither package is named where a version bump would be noticed.** `fl_backend/pyproject.toml`
declares starlette by a floor rather than a pin, and anyio not at all: it arrives as a transitive
dependency in `fl_backend/uv.lock`. `.github/dependabot.yml` puts the `uv` ecosystem on `/fl_backend`
monthly, minor and patch grouped and a major on its own, and only one of the two halves is a
dependency it can name. The starlette release that stops touching the alias would be proposed by
name; the anyio release that removes it is proposed by nothing, and reaches the tree inside another
bump's lockfile resolution.

**The line at fault is starlette's, which is why this stands rather than being planned.** Nothing here
can move the access, and filtering the warning would put a suppression in front of the one signal
saying the alias is still being touched.

**Watch for** an anyio major arriving transitively — inside a grouped starlette bump's lockfile
resolution — while the resolved starlette still binds that name. A major is its own pull request
where the ecosystem can name the package, which is exactly what makes this one silent: the diff a
reader opens says starlette, and the line that breaks the tier is anyio's.
The repair at that moment is the starlette floor, raised to a release whose test client
reads `anyio.from_thread`, and a lock refresh — never a pin holding anyio back, which would hold every
other consumer of it back too.

**Not verified.** No anyio release notes were read, so nothing here says when the alias is scheduled
to go, or whether it is. The warning was counted over a single import in a fresh interpreter rather
than over a full suite run, where what keeps it to one is the warning filter's own per-location
deduplication.

### `645h-nj9q` · The linter runs a version past its end of life, and the documentation for it describes another

| Tags               | Status   | Depends on |
| ------------------ | -------- | ---------- |
| FE, Docs, versions | Standing | —          |

**eslint 9.x reached end of life on 2026-08-06, and `fl_frontend/package.json` declares `^9.39.5`** —
a caret range spanning a line that will publish nothing further, so `pnpm update` cannot move it and
reports nothing that would say it is frozen. Confirmed 2026-08-26 against eslint's own
version-support page, and re-confirmed 2026-08-31, when the registry served 10.9.1 as `latest` and
9.39.5 as the whole of its `maintenance` channel. The linter takes no further fix of any kind,
security or otherwise, and it is still the only check in the toolchain that catches some things at
all: `fl_frontend/eslint.config.mjs`'s own comment beside `better-tailwindcss/no-unknown-classes`
records that tsc, the Prettier plugin and the browser each accept an unresolvable class in silence.
**A defect in a frozen linter fails in the direction of passing.** What bounds the exposure is where
it runs — the gate's frontend scope and a developer's machine, never the production image — so this
is a toolchain exposure rather than a product one.

**`eslint-plugin-jsx-a11y` is the direct blocker and it is dormant.** Measured 2026-08-31 against the
installed packages and the npm registry: its newest release is the one installed, 6.10.2, published
2024-10-26, its eslint peer range stops at `^9`, and two upstream pull requests adding v10 support
sit open with nothing merged and nothing released behind them. `eslint-config-next` compounds it —
its own peer range admits v10 while it carries that plugin beside `eslint-plugin-import` and
`eslint-plugin-react` as plain dependencies, each on a newest release whose peer range stops at
`^9` — so the framework config cannot run supported on v10 either. Flat configuration, the larger
half of a v9-to-v10 migration, is already in use. **Forcing the install past the declared peer ranges
is not the move**: a linter defect fails in the direction of passing, and an unsupported combination
makes that one direction likelier.

**The consequence to act on until the move lands is the sharper one for anyone reading.**
`eslint.org/docs/latest` serves v10, and `.claude/CLAUDE.md` §4 holds a reference authoritative only
while it is official **and** current with the installed version in it as a documented release — which
the current documentation is not for 9.39.5. So the repository's own reflex, reading the project's
own docs, answers about a major version this repository does not run, with nothing in the reading to
mark the gap. **An eslint API claim here has to come from a version-pinned page or from the installed
package under `fl_frontend/node_modules`, and has to say which.**

**Trigger to revisit:** an `eslint-plugin-jsx-a11y` release whose peer range admits eslint 10, under
an `eslint-config-next` whose bundled `eslint-plugin-import` and `eslint-plugin-react` admit it too.

**Not verified:** which v10 changes bite here once the set moves — the migration guide was not read
against the configuration, no move shipping while the walk holds it, and a plugin that does move may
carry a changed rule default under it, which [`docs/frontend/spec.md`](../frontend/spec.md) is where
it lands. The move also re-answers the cache key and threading decision
[`docs/ops/spec.md`](../ops/spec.md) §1.6 records.

### `6m3r-xpcu` · Every replacement for the component library is either a restyle of the foundation it already stands on or a full rewrite

| Tags               | Status | Depends on |
| ------------------ | ------ | ---------- |
| FE, Docs, versions | Open   | —          |

**The criteria are mine, and they are five.** Free, open source preferred. Performant, with CSS load
time and JavaScript bundle size above everything else. Easy to work with, with no odd behaviours. At
least as good-looking as HeroUI. The same KINDS of components — not a drop-in, and a different
foundation is welcome. **A narrower Content-Security-Policy is not among them:** a strict `style-src`
refuses a served `style` attribute and a served `<style>` element alike, and every candidate
positions its overlays through the CSSOM, which that directive does not govern, exactly as HeroUI
does — so a switch buys nothing there, and one of them costs something (`qw6j-scru`).

**"At least as good-looking" is mostly this repository's own work, which is what makes a candidate's
demo a poor predictor.** `fl_frontend/src/app/globals.css` imports HeroUI's per-component stylesheets
one at a time — its own comment gives the reason, that HeroUI's single entry pulls in everything and
Tailwind does not tree-shake a dependency's CSS — then remaps HeroUI's colour tokens onto the site's,
sets a fluid type scale outside Tailwind's own namespace, and writes rules against HeroUI's class
names, the toast block [`docs/frontend/spec.md`](../frontend/spec.md) I23 governs among them. A
candidate inherits the tokens and replaces the structure, so the look lands where this repository puts
it rather than where the candidate's demo does.

**The inventory is what no ranking may skip, and every HeroUI component here is a styled
`react-aria-components` component.** The pieces with no counterpart in a packaged candidate are a
short list: the segmented `DateField` and `TimeField`, the `Calendar` behind `DatePicker`, the
collection `Table`, `ScrollShadow`, `useOverlayState`, the `toast` queue, `InputGroup`, `CloseButton`
and `Chip`. `Button`, `FieldError`, `Label` and `TextField` carry the most call sites by a wide
margin, so the migration's bulk is the plainest part of it.

**The figures that predict anything are this build's, and no published package size is one of them.**
Measured 2026-09-07 over `fl_frontend/.next`: the main stylesheet is 39,655 B gzipped, the JavaScript
every route loads is 131,315 B gzipped, and the whole chunk set is 1,054,553 B gzipped. HeroUI,
`react-aria-components` and Mantine all tree-shake per import and a copy-in kit ships only the files
copied, so a registry's number describes a package nobody installs whole. **A candidate's figure
exists only once a branch has built this site with it.**

**Ranked as the reading supports, with what each costs.** Read 2026-09-07 from the npm registry, from
each project's repository and from each project's own documentation; all of that moves without us.

1. **Keep `react-aria-components` and replace the styled layer** — Intent UI first, with Untitled UI
   React's free tier or shadcn/ui's `--base aria` as the alternatives. All MIT, all copy-in, all on
   Tailwind v4 and React 19. Accessibility and internationalisation stay react-aria's, and every call
   site keeps its component vocabulary. The bill is import re-pointing across every file importing
   `@heroui/react`, the HeroUI-only pieces above re-homed, the HeroUI half of `globals.css` moved into
   owned component files, and [`docs/frontend/spec.md`](../frontend/spec.md) §1.11 and I23 rewritten.
2. **Mantine 9.6** (MIT, 9.6.0 published 2026-08-31, the lowest open-issue count of any candidate).
   The widest packaged coverage there is, dates and notifications included. Its styling engine is its
   own and sits beside Tailwind rather than on it, and its provider emits theme variables as a runtime
   `<style>` element, which `style-src 'self'` refuses exactly as it refuses a served attribute — so
   this one candidate makes `qw6j-scru` harder rather than neutral. Every call site changes shape: the
   form model, the collection APIs, `@internationalized/date` values, and the router and locale
   providers. A rewrite.
3. **shadcn/ui on Base UI** (MIT, the largest ecosystem by far, eight house styles at init). Base UI
   ships no date picker, no calendar, no time field and no collection table; shadcn fills the first
   three with react-day-picker and a native time input, and the fourth with plain markup. The same
   rewrite as Mantine, with weaker stand-ins for four inventory items.

**Set aside, each against the criterion it fails.** Chakra UI v3 and PrimeReact's styled mode both
build their stylesheet at runtime, which is the CSS-load-time criterion. Radix Themes has no date,
toast, accordion, number or combobox component, and its own documentation warns about mixing with
Tailwind. Flowbite React and Headless UI each leave four or more inventory items to a second source.
daisyUI is a stylesheet rather than a component set, so every keyboard and ARIA behaviour would be
written here, and its script-free dropdown rests on CSS anchor positioning, which
`fl_frontend/package.json`'s browserslist floor does not reach. Ark UI's styled layer is Panda CSS, a
second styling engine beside Tailwind. Catalyst is paid.

**Done when** a branch has built this site on the leading candidate and its stylesheet and chunk
figures stand beside the ones above, and I have judged the look over the local stack. Nothing here
decides that: the ranking is what the reading supports, and the build is what settles it.

**Not verified.** No candidate has been built into this site, so every figure above describes what
ships today and nothing about what would. Per-component coverage was confirmed on the leading kit's
pickers, table and overlays and taken from index pages for the rest; whether Mantine can emit its
theme variables without the runtime `<style>` element was not established, and it is the one open
question that could move Mantine's rank.

### `6zuv-9tkx` · Nothing here can render a Server Component, so no check reaches the boundary rule the repository already states

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| FE, Docs, tests | Open   | —          |

**`.claude/rules/frontend.md` states that a Server Component may not pass a function to a Client
Component and names the reason no tool catches it**, and a rule stated and enforced by nothing is
worse than a gap nobody has written down, because it reads to every later reader as a guarantee
somebody is keeping. Each layer misses it for its own reason and the reasons do not overlap: a prop
typed `readonly Facet<Row>[]` is correct, the type system having no notion of the serialisation
boundary, so a function is a good value on both sides of it; `next build` never renders a dynamic
route, so the failure has no build-time moment; and no test renders an async Server Component, whose
markup exists only once its own awaits have resolved. **So the three things a branch is cleared by are each right and each blind to
the same defect** — which surfaced instead as a flash and a German error on an admin page, found by a
person opening it.

**What exists now closes one shape rather than the class**, which its author said plainly. Two
source-level assertions in `fl_frontend/src/shared/utils/facets.test.ts` hold that no module under
`fl_frontend/src/app/` lacking `"use client"` imports a facets module, and that no `Admin*View.tsx`
takes `facets` as a prop — both reading source text rather than rendering anything. They are proxies
for a runtime property, chosen because the runtime property is out of reach, and they cover the facet
shape alone: the next render prop to cross that boundary will be a different name in a different
file.

**Done when the repository has chosen which of two things it wants, and the honest answer may be the
smaller one.** A harness rendering each admin page's server half would test the property itself
rather than a spelling of it, and would catch a boundary crossing nobody predicted — at the cost of a
second runner, a React server runtime, and fixtures for pages that read a database. **Or source-level
proxies per known shape are accepted as the ceiling**, in which case what is owed is a place that
lists which shapes are covered, so the render-prop rule stops reading as though all of it were held.
**Choosing the second is a real answer**; leaving the choice unmade is what currently reads as the
first.

**The shared render harness is not its answer.** `fl_frontend/src/shared/testing/renderTest.ts`
compiles a `.tsx` and renders it synchronously, which reaches a Client Component and no async Server
Component ([`docs/frontend/spec.md`](../frontend/spec.md) §1.9), so what that harness buys leaves
this entry where it stands.

### `7wne-u6hm` · Three test modules each open a cache scope through the same React internal

| Tags                              | Status | Depends on |
| --------------------------------- | ------ | ---------- |
| FE, tests, saisons, spiele, teams | Open   | —          |

**`fl_frontend/src/features/saisons/queries.test.ts`,
`fl_frontend/src/features/spiele/queries.test.ts` and
`fl_frontend/src/features/teams/queries.test.ts` each import React's `react-server` build and
install a memo table on the internals object whose exported name says it may not be used**, and each
carries its own assertion that the build still exposes it. What the three prove is that one render
pass memoizes a filtered admin read, which is what a page relies on; what they rest on is React's
private surface, so a release moving it fails three modules at once and the same repair is written
three times.

**Done when** one module opens the scope and the three take it from there. It has to be reached by a
static import, the modules under test by `await import`: the opener installs itself as it evaluates,
and a module already resolved by then gets the real cache rather than the harness's.

### `8wd7-ff49` · The consent field has a schema and a ruled writer, and no flow that writes it

| Tags                        | Status  | Depends on  |
| --------------------------- | ------- | ----------- |
| FE, BE, Docs, meta, spieler | Blocked | `f3ar-m4qf` |

**`einwilligung.bestaetigt_am` has a schema and no writer a person reaches.**
`fl_backend/app/api/spieler/services.py :: registration_einwilligung` composes one, writing
`erteilt_von` as `erziehungsberechtigt` and `bestaetigt_am` as the same day; its one caller,
`fl_backend/app/api/spieler/admin_router.py :: post_spieler`, sits on a router guarded by
`verify_access_admin`. So a pupil registered through the admin surface is stored as consented by a
guardian on the day of registration, and nothing distinguishes that row from one a guardian actually
filed. The comment at the line gives the reasoning as the guardian being the one filing it, which is
true of no caller the system has.

**The writer is ruled, and the flow that would be it does not exist.** `docs/datenschutz.md` §2
settles it: everyone signs up for themselves through the website and gives their own consent there,
from 16, and an administrator may neither create a player nor assume, enter or transcribe a consent
on anybody's behalf. There is no guardian workflow. So `registration_einwilligung` and its admin
caller go with the flow that replaces them, and the consent vocabulary then has to express a
person's own consent and a carried-over record and nothing else — `bestandsuebernahme` already marks
the second.

**What the ruling leaves standing.** The gate publishing nobody without a recorded consent may be
built before the flow ships, provided every pupil row standing today counts as fully consented:
those rows are deleted once at the end of this season (`docs/datenschutz.md` §3), and the gate must
not empty the public squad lists meanwhile. Today no read consults the stored field at all —
publication is gated on nothing — and the predicate is written into `docs/backend/spec.md`'s
read-rules table before any code.

**Done** is the sign-up flow writing a person's own consent, `registration_einwilligung` and its
caller gone with it, the vocabulary narrowed to what stays expressible, the publication gate reading
what the flow stores, and the notice's squad and referee publication rows
(`fl_frontend/src/features/meta/components/views/DatenschutzView.tsx`) moved off the legitimate
interest they rest on to the consent the flow collects. A pupil's birthdate is optional only
until that registration and required from it, `fl_backend/app/core/domain.py :: UNENFORCED`
carrying the state that ends there.

### `9s24-rvgc` · The email shell's token floor is a fixed number well under what its parse finds

| Tags                 | Status | Depends on |
| -------------------- | ------ | ---------- |
| FE, Ops, gate, tests | Open   | —          |

**`fl_frontend/src/core/emailShell.test.ts` guards its own parse with a lower bound rather
than with the scheme's own count.** The assertion exists so that a parse returning nothing cannot
make every later case pass vacuously — which is the right instinct — but the bound sits far enough
below what the parse actually returns that the file could silently lose several tokens and the guard
would still hold. `fl_frontend/src/app/brandAssets.test.ts` carries the same shape.

**Why it matters.** These two files are the only route by which an email and a favicon follow the
season scheme; both are pinned by parsing a stylesheet rather than by importing it, so a regex that
stops matching is the failure mode they exist to catch, and a floor loose enough to absorb it is the
one thing that would hide it.

**The trap.** Pinning the exact count instead is a hardcoded number in the active repository, which
the corpus rules refuse. What is wanted is a bound derived from the scheme file itself — the light
block's declared token count, which `scripts/checks/docs_gate/scheme.py` already derives for the
gate — so that the two blocks are compared with each other rather than with a literal.

**Done when** neither test can pass on a parse that lost tokens, and neither states a number.

### `buut-5cyw` · An undo restores a whole stored fixture from a list read before the save

| Tags                        | Status | Depends on |
| --------------------------- | ------ | ---------- |
| FE, BE, Docs, admin, spiele | Open   | —          |

**A save on `/admin/spiele/[spiel_id]` can rewrite fixtures nobody opened, and the undo offered for it puts
each of them back as a whole document.** `fl_backend/app/api/spiele/admin_router.py :: patch_spiel_data`
resolves the bracket inside its transaction, so one save clears results on advanced fixtures and releases
sides on others. `fl_frontend/src/features/spiele/utils.ts :: buildUndoPayloads` then composes one payload per
moved fixture through `:: toPatchPayload`, which lists every field the endpoint takes because the update is a
wholesale `$set` — `fl_backend/app/api/spiele/schemas.py :: FLPatchSpielDataPayload` says so at each field,
and an omitted one is overwritten with nothing. So an undo writes back `datum`, `uhrzeit`, `notiz`, both
quellen and both sides of a fixture whose slot was the only thing that moved.

**The values come from a snapshot, and the snapshot is a different read from the write it
corrects.** The moved fixtures are picked out of the season list the admin context holds
(`fl_frontend/src/features/spiele/utils.ts :: listMovedSpiele`):
`fl_frontend/src/features/admin/components/providers/AdminContextWrapper.tsx` fetches it once per
page render through `fl_frontend/src/features/spiele/queries.ts :: getAdminSpiele`, and
`fl_frontend/src/features/admin/components/providers/AdminContextProvider.tsx` holds it for the life
of the mounted editor. That read is uncached, so the window is one page visit rather than a cache
lifetime — and inside it, anything another writer changes on a moved fixture is reverted by the
undo, silently, with nothing in the payload marking a field the resolution never touched.

**One half of the shape is closed, and the reason it is closed does not generalise.** A payload
built from that list alone would blank `mietpreis` and `payment`, which the season list does not
carry, so the editor reads each moved fixture's booking through
`fl_frontend/src/features/spiele/actions.ts :: readAdminSpielBookingsAction` after the write and
merges it in. That is sound for exactly one reason, stated at the line: the resolution rewrites
slots and results and never a ground or a referee, so the booking read after the write is the
booking that stood before it. **No other field has that property.**

**The response already names what it rewrote, and stops one step short of what a narrow restore
needs.** `fl_backend/app/api/spiele/schemas.py :: FLSpielAdvancement` and `:: FLSpielReleasedSide`
report per fixture the `voided_ergebnis`, `voided_elfmeterschiessen` and `voided_sonderereignis` a
rewrite destroyed, and which `side` was released. Neither carries enough to rebuild those fields: an
`ergebnis` is a formatted string rather than the goal counts a payload takes, and a released side
names its club rather than the `team_id` a payload takes.

**Two answers, and they are different sizes.**

- **Carry the prior values on the response and restore only the fields it names.** The write path
  then has to accept a payload naming fewer fields than `FLPatchSpielDataPayload` declares, which is
  the whole reason every field there is required — so the endpoint's contract,
  `fl_backend/openapi.json`, the Zod mirror checked against it and the payload builder all move in
  one change.
- **Restore over the action log instead.** `fl_backend/app/core/recording.py` keeps the document
  each write replaced, so a restore reading it is correct by construction and needs no prior value
  on the response at all. That is `32bs-nhzd`'s subject, and taking this route makes this entry a
  consumer of that work rather than a repair of its own.

**What may not move either way.** `.claude/rules/frontend.md` fixes two edges a repair may not
cross — the undo offer is scoped to the destructive save, and a route-handled undo may not sit
outside a page-owned editor — so what moves is the payloads rather than where the undo lives.

**Not measured:** whether a moved fixture has ever changed under a mounted editor. One person writes
today, so the window is a single administrator's page visit; a second writer arrives in the season
plan this year (confirmed 2026-08-12), which is what turns that window into a shape two people can
meet inside.

### `ceqd-e4aq` · An admin table's declared floor can be wider than the viewport its layout starts at

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| FE, Docs, tests | Open   | —          |

**Ruled: an admin table is never scrolled sideways to be read.**

**A table's floor is computed rather than chosen, and nothing compares it to the width it has.**
`fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts :: TABLES` is the roster — the admin
lists whose rows sit in a react-aria table — and for each one the test adds the widths its columns
declare to a free-text allowance per undeclared column, then requires the table's single `min-w-`
floor to equal that sum exactly. The controls column has its own derivation,
`fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts :: ACTIONS_WIDTH`, which grows with the
most controls one row can hold. Both are checks that the floor matches what the columns asked for.
Neither asks whether the viewport can give it.

**Below the floor the reader gets a scroll container, and the busiest table is the one it reaches
first.** Each table renders cards below Tailwind's `md` step and the table layout from it up, so the
narrowest viewport that shows a table is that step; a table whose controls and free-text columns push
its floor past that step is scrolled sideways for every width between the two. The scroll container
is deliberate as a last resort and says so at the line, deliberately keeping its bar visible — which
is the right behaviour for a table that overflows and the wrong outcome for a table that should not.

**The repair is a shared budget, not a trim per table.** Each table's floor is the sum of decisions
taken in that table — how many controls a row offers, how much room a free-text column is owed — so
narrowing one is a product decision about that list, and narrowing every member of the roster by
hand still leaves the table added after it free to reintroduce the defect. What holds is a width no
table may exceed, derived from the step its layout starts at, with the per-table sums measured
against it.

**Done when** no admin table declares a floor wider than the narrowest viewport its table layout is
shown at, and a check refuses one that does — extending the roster's existing sums rather than
adding a second reader of the same markup, with the bound recorded where a session adding a column
meets it (`docs/frontend/spec.md`).

### `cvub-qx5s` · `NOTICE` asserts the source copyright of a natural person while an association publishes the site

| Tags     | Status | Depends on |
| -------- | ------ | ---------- |
| FE, meta | Open   | —          |

**`NOTICE` names an individual as the copyright holder of the source**, and the site is
published by the association `fl_frontend/src/core/brand.ts :: VEREIN_NAME` names and
`fl_frontend/src/features/meta/components/views/ImpressumView.tsx` renders. The two documents
therefore disagree about who owns what, in the one place a reader goes to find out.

**Why it matters.** The name reservation in the same file is the league's, and it is the half that
gets read; the copyright line beside it is the half that decides whether a fork is licensed by the
right party. An association that has not been assigned the source cannot license it, and an
individual who has assigned it cannot keep asserting it.

**The trap.** This is a legal question rather than a wording one — whether the source was assigned
to the association at all, and whether the association exists yet in a form that can hold it. The
Impressum still carries `i. G.`, so the answer may be that the individual line is correct today and
becomes wrong on the day the register entry lands.

**Done when** who holds the source copyright is decided, `NOTICE` says so, and, if the answer
changes at registration, the condition is written where whoever files the registration meets it.

### `dq3b-mgpq` · Every tone tint falls under the text floor on a `muted` ground, and one tab strip puts pills there

| Tags                 | Status | Depends on |
| -------------------- | ------ | ---------- |
| FE, Ops, gate, admin | Open   | —          |

**`fl_frontend/src/shared/components/ui/badges.ts :: PILL_TINT` states that a pill sits on
`surface` or `background` and never on `muted`, and one live surface does exactly that.**
`fl_frontend/src/features/admin/components/views/AdminSpieleActionRequiredView.tsx` gives its tab
strip `fl_frontend/src/shared/components/ui/formFieldStyles.ts :: TAB_TRACK`, whose ground is
`bg-muted`, and puts a `COUNT_BADGE` wearing a `/15` tone tint inside each tab. Recomposited over
that ground the four light inks measure 4.20:1 to 4.48:1 against the 4.5:1 a badge at this step
answers to.

**Why it matters.** `scripts/checks/docs_gate/scheme.py :: PAIRS` measures every pill on `surface`,
which is the tighter of the two grounds a pill is allowed and therefore the right floor — but
nothing measures a pill on a ground the rule forbids, so the rule is prose and the next tab strip
carrying a count is the next instance.

**The trap, which is why no repair is obvious.** Moving the track to `bg-surface` costs the strip
its recessed reading AND kills the hover, because
`fl_frontend/src/shared/components/ui/formFieldStyles.ts :: TAB_ITEM`'s hover fill is `bg-surface`
and would then equal the track. Keeping the track and dropping those badges to `/10` clears the floor
but puts two tint strengths in the system, which the palette spent a round removing. Giving the
unselected tabs their own opaque fill is a third answer and the largest change of the three. The
figures predate this scheme, which moved them toward the floor without reaching it.

**Done when** either a badge on a `muted` ground clears its floor, or a check refuses one and the
rule stops being prose.

### `ex2m-qjkg` · The season's shape is offered wider than it can be saved, and two of its three fields have no contiguous legal range

| Tags                                        | Status | Depends on |
| ------------------------------------------- | ------ | ---------- |
| FE, BE, Docs, tests, saisons, spiele, teams | Open   | —          |

**`number_of_groups`, `qualifiers_per_group` and `teams_per_group` are `SaisonRuleNumberField` steppers in
both the create modal and the Regeln panel, and the combinations they accept are wider than the ones a season
can be saved in.** The **saisons** clause in `.claude/rules/cross-surface.md` bars exactly this — _offer in
the form wiring the write path refuses_ — and the three shape fields are where the product still does it. The
clearest instance needs no arithmetic at all:
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/spielplanShape.ts :: SHAPE_FIELDS`
gives `qualifiers_per_group` a `minValue` of 1 and **no maximum**, so the stepper walks upward without end
into a refusal.

**The legal set is small, and two of the three fields cannot be expressed by an interval.**
`fl_backend/app/api/saisons/schedule.py :: qualifier_count` is `number_of_groups ×
qualifiers_per_group`, and `REQ-RULES-001` requires that product to be a power of two in
`[2, MAX_QUALIFIERS]` — `:: knockout_phases_for` returns an empty tuple otherwise, and
`fl_backend/app/api/saisons/services.py :: find_rules_refusal` turns that into the refusal.
`fl_backend/app/api/spiele/schemas.py :: MAX_QUALIFIERS` is `2 ** len(KNOCKOUT_PHASES)`, and
`:: PHASE_ORDER` names four knockout rounds, so the ceiling is 16. A product is a power of two only
where the group count is one, so **the legal group counts are 1, 2, 4, 8 and 16 — never 3, 5, 6 or
7** — and that holds at today's cap, not only at a raised one. `qualifiers_per_group` is bounded the
same way from the other side, and `REQ-RULES-007` adds that it may not exceed `teams_per_group`.

So `number_of_groups` and `qualifiers_per_group` want selects: their legal values are
**non-contiguous**, and a stepper with a floor and a ceiling is structurally incapable of stating a
set that skips. `teams_per_group` wants to stay a stepper, its legal values being a genuine range —
`max(2, qualifiers_per_group)` upward — with bounds derived from the other two rather than written
into `SHAPE_FIELDS` by hand. **The defect is not that a number field is the wrong control, it is
that two of these three fields do not describe intervals.**

**`SHAPE_FIELDS` is where the offer belongs.** Its own docstring says it is "One table for the
fields and the confirmation both, so no readout can label a number differently from the field above
it", so the redraw confirmation inherits a corrected offer for free.
`fl_frontend/src/shared/components/ui/refusableOption.ts :: pickIfOffered` and
`fl_frontend/src/shared/components/ui/RefusableSelect.tsx :: RefusableSelect` are the mechanism
already built for an option that closes, and they fix the repository's answer to a stored value the
offer does not hold: a closed option resolves to `null`. Where the stored value must stay visible
rather than clear, the pattern is the Herkunft picker's — keep the row only where it IS the current
choice, so it reads as a statement rather than an offer.

**The redraw panel gains the most.** `REQ-SPIELPLAN-004` demands that every offered group hold
exactly `teams_per_group` after a redraw, so that panel can offer only shapes whose group count
times team count equals the clubs already entered. That collapses three interacting fields into a
short reachable list, on the one panel where a wrong guess costs a failed draw rather than a refused
save.

**What selects can and cannot design out.** `REQ-RULES-001` and `REQ-RULES-007` are arithmetic on
the three numbers alone, so an offer can guarantee them. `REQ-RULES-002`, `REQ-RULES-003` and
`REQ-RULES-006` read the season's own occupancy and fixtures, and
`.../AdminSaisonEditForm/FormRegelnSection.tsx` is handed three freeze flags and no occupancy today.
Threading the group fill counts in would reach the first two, and it is cheaper than it sounds:
`REQ-RULES-011` freezes all three fields absolutely once a fixture exists, so the only editable case
is an undrawn season, where occupancy is the sole remaining stored constraint.

**No backend rule is removed, and this is written down so a later session does not reach for one.** The
selects eliminate a round trip, never a rule. A stale tab holds an offer derived from rules that have since
changed; the API is reachable without the form; and a derived offer is a further mirror of backend rules that
can drift — `fl_frontend/src/features/saisons/schemas.ts :: hasPlayableBracket` is already the second, and
`.claude/rules/cross-surface.md` holds the Zod mirror to presence, required, nullable, type and enum, so
`fl_frontend/src/core/apiContract.test.ts` compares no numeric bound and would not catch the drift. The offer
therefore needs a test of its own pinning it against the backend's rule functions;
`fl_frontend/src/features/saisons/recordedFactMirror.test.ts` is the precedent for parsing the Python side
rather than restating it. Where a rule should genuinely stop holding,
`fl_backend/app/core/domain.py :: UNENFORCED` is the mechanism and deletion is not.

**Raising the cap to 16 is my direction, and these are the hazards it turns live.** Each was read
2026-08-27 and none is reachable while the cap and the closed name set agree.

| Site                                                           | What it does                                                                                                                                                                                                                                                                                                    | Loud or silent                                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `fl_backend/app/api/teams/services.py :: offered_gruppen`      | `get_args(FLGruppenNames)[:number_of_groups]` — a bare slice that returns four names for eight and raises nothing. `find_entry_refusal`, `REQ-SPIELPLAN-004` and `fl_backend/app/api/saisons/spielplan.py :: _squads` all inherit it                                                                            | **Silent.** Held shut today only by `fl_backend/tests/api/test_reference_models.py`, which asserts the cap equals the set size |
| `fl_frontend/src/features/teams/utils.ts :: buildGruppeOffer`  | The identical slice in TypeScript, so clubs could not be entered into the new groups at all                                                                                                                                                                                                                     | Silent                                                                                                                         |
| `fl_frontend/src/features/teams/schemas.ts :: FLGruppenSchema` | A `z.object` with four required keys, and `z.object` strips unknown ones — a fifth group is dropped on parse and the standings page renders four tables with no error                                                                                                                                           | Silent at runtime; `apiContract.test.ts` catches the drift                                                                     |
| `fl_backend/app/api/teams/services.py :: build_gruppen`        | Seeds from the name set rather than the season, so a wider set renders empty group cards on every smaller season. Changing it moves `docs/backend/spec.md :: I10`, the glossary's trap and `FLGruppenSchema`'s shape together                                                                                   | Silent                                                                                                                         |
| `.../AdminEditSpielDataForm/FormTeamPicker.tsx`                | Hardcodes the group list with `satisfies`, which type-checks against a wider union and quietly stops offering the new groups                                                                                                                                                                                    | Silent                                                                                                                         |
| `FormRegelnSection.tsx` and `AdminCreateSaisonForm.tsx`        | Two hand-written `maxValue={4}` steppers, pinned by no test                                                                                                                                                                                                                                                     | Silent                                                                                                                         |
| `fl_backend/app/api/spiele/admin_router.py` and `:: crud.py`   | Season-scoped fixture reads raise past `LIST_LIMIT_DEFAULT` (1024) as a 500 rather than a refusal. `fl_backend/app/api/saisons/schemas.py :: TeamsPerGroup`'s comment states its ceiling of 16 was chosen to keep the largest legal season inside that limit, so raising the group cap makes that comment false | Loud, as a 500                                                                                                                 |

Raising the group cap adds no seeding key: `fl_backend/app/api/saisons/spielplan.py ::
bracket_seeding` constructs the arrangement for any legal shape, and the table it replaced at
runtime is now the reference that construction is held to.

**What is unexpectedly clean.** No layout anywhere is sized per group — every grid in
`fl_frontend/src` is card responsiveness, no tab strip or filter row carries one entry per group,
and no table has a column per group. Nothing on the frontend sorts group names, so the byte-order
hazard `docs/backend/spec.md :: I54` guards against does not reach this. The standings page stacks
one card per group and grows, which is a design question at sixteen groups rather than a breakage.

**Not verified.** Nothing here was seen rendering — no admin session is available to the sessions
that read it — so every claim about a control is read off source and class strings. The legal-set
arithmetic is derived from the rule functions rather than executed.

### `f38s-y3hj` · A sweep taking `.tsx` alone decides no test file, and the spelling keeping its fixtures out is refused by nothing

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| FE, Docs, tests | Open   | —          |

Lands with: `z82x-us4y`

**Every sweep collecting `.tsx` alone hands `fl_frontend/src/core/treeWalk.ts :: filesUnder` a
predicate that decides no test file**, where the sweeps collecting `.ts` as well call
`fl_frontend/src/core/treeWalk.ts :: isTestFile`, which reads either spelling. What holds the first
set clean is that the estate spells every test file `.test.ts`, so a `.tsx` predicate drops them by
accident rather than by decision.

**The failure is a rename away, and a sweep is already sitting on it.**
`fl_frontend/src/shared/components/ui/formSubmit.test.ts` collects the `.tsx` files whose text names
`<ConfirmSaveModal` and holds the result to a floor — and it writes that literal itself, as the
needle it searches for. Under the other spelling it would be swept into its own answer and counted
among the editors it measures. The rest carry the same shape: what each searches for is text it also
contains. Whether such a file would run is a separate question from whether it is swept, because the
walk reads the directory and nothing about the runner's collection reaches it.

**Nothing stands behind the rule that already names this.** `.claude/rules/frontend.md`'s **sweeps**
clause bars taking a test file's fixtures as the production text a sweep asserts over; no gate check,
lint rule or hook refuses the `.test.tsx` spelling, so what holds the clause here is the tree's
current habit.

**A blanket exclusion is not the repair.** `fl_frontend/src/core/mail.test.ts` sweeps the tree and
asserts against a set naming its own file, so a sweep may legitimately want the test files. What
none may do is leave the answer to whichever suffix it happened to want.

**Done when** every sweep's predicate states its own answer to the test-file question, so the
population each walks is the one it chose rather than the one the tree's current spelling gives it.

### `f3ar-m4qf` · Setting up a season is a hand-run sequence, and only an admin can enter a squad

| Tags                                                                        | Status | Depends on |
| --------------------------------------------------------------------------- | ------ | ---------- |
| FE, BE, DB, Ops, Docs, edge, bewerbungen, kontakte, saisons, spieler, teams | Open   | —          |

**My item, 2026-08-13.** The Saison create form becomes a guided workflow that takes an admin through a whole
new season — its dates, which clubs play it, which clubs are new, and the rules it runs under — and the season
is then built behind that flow, as automatically as it can be. Beside it, `/admin/kontakte` lists the school
and team representatives a season holds. An accepted application tells its own contacts
(`fl_frontend/src/features/bewerbungen/notifications.ts :: sendBewerbungMail`); what is still owed is that
message for a team entered by hand, and a link or a code to paste into that team's group chat. The link leads
to a page, also new, where the players of that team enter themselves with their position, squad number and the
rest — a returning player recognised rather than duplicated, a number clash raised rather than stored. The
Saison page and its editor change with it.

**It is a programme, and its parts are not one change.**

| Part                                                        | Needs first                                   | Could ship alone |
| ----------------------------------------------------------- | --------------------------------------------- | ---------------- |
| The guided creation flow, as a page over the create payload | —                                             | Yes              |
| Drawing the season from that flow rather than by hand       | the flow                                      | No               |
| Telling a representative entered by hand their team is in   | —                                             | Yes              |
| A shareable link or code, and what it authorises            | a ruling on the authorisation model           | No               |
| The public self-registration page                           | the link, and a public write path             | No               |
| Recognising a returning player                              | the registration page                         | No               |
| Raising a squad-number clash                                | the registration page; the reissue hole below | The hole, alone  |
| Rework of the Saison page and its editor                    | whichever of the above lands                  | Yes              |

**The season's structure is not this entry's to build.**
`fl_backend/app/api/saisons/schedule.py :: schedule_for` takes a season's rules and returns, per phase the
season actually plays, how many matchdays it takes and how many matches each holds; `:: expected_matches` is
what a matchday's `anzahl_spiele` reports, and a rules combination that cannot be played is refused
(`fl_backend/app/api/saisons/services.py :: find_rules_refusal`). The draw writes that answer out:
`POST /saisons/{saison_id}/spielplan` composes every matchday and every fixture of the season from those rules
and the clubs entered into it, in one transaction ([`docs/backend/spec.md`](../backend/spec.md) I46), and
`spiel_nr` is contiguous from 1 in playing order because the draw assigns it rather than a caller choosing
one. So the shape of a season is a pure function of what a create form collects, and the flow's structural
half is showing that function's answer while the admin is still choosing, then calling the draw once.

**What the flow owes the draw is the ORDER, not the arithmetic.** The draw refuses a season already
finished (`REQ-SPIELPLAN-003`) and a group holding anything but the teams its rules ask for (`-004`),
so every club still has to be entered before it runs, and a wizard reaching it early is refused
rather than left half-drawn. A season already holding a fixture or a matchday is refused too
(`-001`, `-002`) **unless the request confirms a replace**, which removes both lists and draws them
again inside the same transaction; `REQ-SPIELPLAN-005` holds that to a `future` season with nothing
recorded. The replace CARRIES the new shape rules and writes them in that same transaction, which is
what makes a season drawn from the wrong numbers repairable: a season's shape rules and its draw are
one fact, so `REQ-RULES-011` keeps them off the patch entirely rather than lifting. The draw is
therefore repeatable for as long as the setup lasts, and a flow that draws early and draws again
after a correction is a shape the API supports — at the price of a confirmation, because a replace
destroys the whole schedule rather than the part that was wrong, and nothing writes one back. **What
a replace reaches is the qualifier count**, the group shape being fixed by the clubs already
entered; `DELETE /saisons/{saison_id}/spielplan` undraws the season instead, which is the way back
from a group shape guessed wrong, and [`docs/domain.md`](../domain.md) carries the sequence. Today it
is a panel an admin presses on `/admin/saisons/[saison_id]` once the clubs are in
(`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/FormSpielplanSection.tsx`),
which is the hand-run sequence this entry is about rather than a flow.

**Ending the flow by making the season live is the one thing it must not do.**
`POST /saisons/{saison_id}/activate` is the only code path in the system that writes `status`, a
created season is always `future`, and creating and activating are two steps **on purpose** — a
single "create it and make it live" call turns a typo in a four-character season id into a silent
rollover of the running season, produced by a form field. A guided workflow that finishes by making
the season current is exactly that call with a wizard in front of it. The flow ends at a season that
is ready and `future`; the rollover stays the panel on `/admin/saisons/[saison_id]`, where the
outgoing season's unfinished fixtures are listed rather than counted.

**A matchday follows from the rules rather than from a person, which is what makes generating a
season a consequence rather than a feature.** A phase takes exactly the matchdays its rules imply —
one per round, so a knockout round is one matchday and not several — and `position` and
`saison_phase` are the draw's, on no payload afterwards. `/admin/spieltage` lists what the draw
wrote, and a matchday's own editor sets the span the draw leaves null. What remains of the
structural half is therefore the flow that collects the rules, not a second writer of anything:
`spiele.spieltag_id` still has no fixture-level create or delete, and nothing needs one — the one
endpoint that removes a matchday removes that season's fixtures in the same transaction, so the
reference cannot dangle (`fl_backend/app/core/domain.py :: REFERENCES`).

**A public write into application data has two precedents, and neither inserts a person into the
league.** The application form's `POST /bewerbungen` is base-tier and stores what a school
submitted, decided by nobody until the triage reaches it
([`docs/backend/spec.md`](../backend/spec.md) §1.1); the confirmation page's
`POST /bewerbungen/einwilligung` writes one named contact person's own answer into that stored
application, authorised by an emailed token rather than by a session. Every other write that touches the league's own
data sits behind `verify_access_admin`, declared at router level and inherited by the endpoints
under it; the browser side of that is an email allowlist checked at sign-in and re-derived on every
session read (`fl_frontend/src/core/auth.ts`). The remaining public unauthenticated writes touch no
application data — the sign-in action, which triggers an outbound email and writes into the Auth.js
store alone, and `fl_frontend/src/app/api/client-error/route.ts`, which writes a log line — and each
public write has its own `limit_req_zone` in `nginx/prod.conf`, keyed so that only the POST is
limited. **A self-registration page is the first that inserts a person**, and the first whose text
reaches a public page with no decision standing between.

**Recognising a returning player has a shape already, and the tempting version of it is refused.**
`spieler` holds the person and the `saison_spieler` junction holds everything a squad list shows;
`uniq_spieler_id_saison_id` gives a person one row per season, so bringing back somebody who already
has a retired row for that season is `POST /spieler/{spieler_id}/saisons/{saison_id}/reactivate` and
never a second create. Making a create idempotent on a natural key was rejected because a two-letter
shorthand cannot distinguish the same club returning from a different one wanting those letters, and
getting it wrong repoints history silently. **A typed name is a weaker key than a shorthand**, so the
same argument binds harder here: matching on a name has to propose a candidate rather than resolve
one, and the resolution belongs to somebody who can be wrong out loud. `is_nachgetragen` is the
field that already records a squad entry arriving after the season began, derived from the chosen
season's status rather than asked
(`fl_frontend/src/features/spieler/components/forms/AdminCreateSpielerForm.tsx`), and a
self-registration into a running season is precisely that case.

**Nothing refuses a shared squad number and nothing reports one, so this page inherits a question
rather than a pattern.** A shared shirt is a permitted state on every write path
(`fl_backend/app/core/domain.py :: UNENFORCED`). The squad editor's rail raises no banner about a
number
(`fl_frontend/src/features/spieler/components/forms/AdminSpielerEditForm/banners.ts :: buildSpielerBanners`),
and the create form judges `nummer` on its format alone; the editor's save routes through a
confirmation for any banner above `info`
(`fl_frontend/src/shared/components/ui/railBanner.ts :: resolveBlockingBanners`), and the only one it
raises is `spieler.team-changed` — a transfer rather than a shirt. A page where a whole team enters
itself multiplies those writes and has no admin reading them, so whether a self-registered player
may take a shirt somebody in the squad already wears — and who is told — is a product call this
entry owns, and no admin surface answers it first.

**What the Saison page and its editor inherit.** The create form is a dialog today
(`fl_frontend/src/features/saisons/components/modals/AdminCreateSaisonModal.tsx` over
`fl_frontend/src/features/saisons/components/forms/AdminCreateSaisonForm.tsx`), and what happens
when a form outgrows one is already fixed: it becomes a page at its own route, with panels per
section, a field judged when it is left, one save bar, a discard guard and an undo route handler. A
flow that also picks clubs and creates them passes that threshold by a distance, so the guided
workflow is a page rather than a larger modal, and the pattern to copy is on
`/admin/saisons/[saison_id]` —
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm.tsx` and
the panels beside it, the Spielplan draw among them. The editor is where a wrong answer from the
flow is corrected, so every field the flow collects has to be editable afterwards, and the narrowing
refusals `find_rules_refusal` performs are what the flow has to state while a value is still being
chosen — which is `ex2m-qjkg`'s subject, and building this flow before it means building that offer
twice.

**Where a representative's contact is kept is fixed, and the flow inherits it rather than choosing
it.** The block is embedded rather than given a collection of its own: on the `saison_teams`
junction (`fl_backend/app/api/teams/schemas.py :: FLSaisonTeamKontakte`) and on an application row,
both validated through one sub-schema (`fl_backend/app/core/constraints.py :: _KONTAKTE_PROPERTIES`),
so a role added to the block reaches both collections in the commit that adds it. `/admin/kontakte`
reads the junction's copy, and `fl_backend/app/api/kontakte/admin_router.py :: erase_kontaktperson`
is the one route that removes a person from either.

**What a failed notification does is fixed too** — a decision's message reaches every person the
application names and no failure to deliver it retracts the decision
([`docs/frontend/spec.md`](../frontend/spec.md) I39). What is local to this entry is how little of
that surface there is to copy from: `fl_frontend/src/core/mail.ts :: sendMail` has two callers
today, the triage's fan-out in `sendBewerbungMail` and the sign-in link through the Resend provider's
override in `fl_frontend/src/core/auth.ts`. Telling a representative entered by hand that their team
is in adds the third.

**Undecided, and each needs a ruling before the part depending on it starts:**

- **What the link authorises, and what a leaked one can do.** A code per team per season, or a
  signed URL; whether it expires with the registration window; whether it can be revoked and
  reissued; and whether it identifies the team alone or the team and the person. A link pasted into
  a group chat is a link that leaves the group chat.
- **Whether a self-registered entry is live on submission or waits to be admitted.** A squad list is
  a public page, so a public write that lands straight in one is public text written by an
  unauthenticated stranger — the trust `teams.description` and an `austritt`'s `grund` already
  carry, extended to somebody the league has not authenticated.
- **What the form may ask for, and where the notice saying so lives.** `stufe` is the Hessen
  Oberstufe, so the people typing into this page are school pupils. The public route group
  `fl_frontend/src/app/(public)/(meta)/` holds `about`, `kontakt` and `team`. Everyone signing up
  gives their own consent there and the minimum age is 16 (`docs/datenschutz.md` §2), so the flow is
  also where a consent text and a birthdate are collected.
- **Whether the flow may enter a club it has just created.** No junction row is ever removed —
  `saison_teams` has a POST, a PATCH and a replace, and no DELETE — but a club does leave a season
  two ways, and the WRONG club is the repairable one:
  `POST /teams/{team_id}/saisons/{saison_id}/replace` hands the row to the club that should have
  been entered, reseeding its identity copy and carrying the change into the season's fixtures,
  refused in a `past` season and once any of those fixtures has left a record (`REQ-REPLACE-001`,
  `-002`). What it does not reach is the club too MANY: a replacement brings one club in for one
  going out, and refuses a club the season already holds (`-003`), so a wizard that enters a club
  nobody should have entered still ends in an `austritt` — a public record with a reason on it,
  which is a heavy consequence for a step in a flow designed to be fast.
- **What a rate limit for this surface should be.** The zones that exist are sized for a person
  signing in, for a crashing browser, and for one school submitting one application; a whole squad
  filling a form in one break is a different shape of traffic on the same edge, so `zone=bewerbung`
  ([`docs/ops/spec.md`](../ops/spec.md) §1.3) is the nearest precedent rather than the answer.

### `f4uf-jape` · A copy test compares source text against a literal its own author typed

| Tags                                | Status | Depends on |
| ----------------------------------- | ------ | ---------- |
| FE, BE, Docs, tests, saisons, teams | Open   | —          |

**[`docs/frontend/spec.md`](../frontend/spec.md) §1.9 calls the frontend's `readFileSync` tests one
kind — sweeps that hold a rule no linter can express — and they are two.** Each of one kind has an
authority somewhere other than the test: `fl_frontend/src/core/apiContract.test.ts` and
`fl_frontend/src/core/apiRequests.test.ts` compare the tree against `fl_backend/openapi.json`,
`fl_frontend/src/features/saisons/actions.test.ts` requires every refusal code
`fl_frontend/src/core/refusalRegister.ts :: declaredCodes` reads out of
`fl_backend/app/core/domain.py` to reach a `case` in the German mapper, and
`fl_frontend/src/core/refusalPaths.test.ts` and
`fl_frontend/src/shared/components/ui/formSubmit.test.ts` hold structural rules across the tree.
**The other kind regexes a component's German out of its own `.tsx` and asserts that it matches a
literal** — `fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/teamErsatz.test.ts`
is the clearest, with `:: undrawSpielplan.test.ts`, `:: spielplanReplace.test.ts` and
`:: oneWayGuards.test.ts` beside it — and can only restate what its author believed when they wrote
the component, in the same commit, then defend that belief against every later reader.

**Demonstrated rather than hypothesised.** The replacement panel's own copy test once required the
panel to say a replaced club's players were _stillgelegt_ and forbade _ausgetragen_, under a comment
arguing that wording it as a removal would mislead. **Both halves were the wrong way round** — the
endpoint stamps `saison_spieler` and touches no `spieler` document, so the forbidden word was the
correct one. The suite was green throughout, and the test was what would have had to be edited before
the defect could be fixed.

**Rendering the panel does not close it.** An assertion over the markup
`fl_frontend/src/shared/testing/renderTest.ts :: renderMarkup` produces fails in precisely the same
way, because the fault is in what the assertion compares against rather than in how it reads the
component.

**Done when** the vocabulary has an authority and a test reads it — the pair of verbs declared once
in [`docs/glossary.md`](../glossary.md), which today describes `inactive_since` as "the day something
left" for every subject and fixes no German for any of them, and the consequential sentences composed
by an exported function, as `fl_frontend/src/features/teams/utils.ts :: describeReplacementUmfang`
and `fl_frontend/src/features/saisons/utils.ts :: describeSpielplanUmfang` already are, so the
assertion is over a value rather than over a file's bytes. **What the answer must not be is a rule
banning the shape outright**: several of these tests hold the only line there is under a real rule,
and [`docs/frontend/spec.md`](../frontend/spec.md) §1.9 is right that a sweep is how such a rule is
held. **The line to draw is the authority, not the mechanism** — a sweep that compares the tree
against something outside itself is sound, and one that compares it against a literal in the same
commit is a note about intent wearing a test's clothes.

### `gbjj-9wfh` · A test fixture asserts its own type, and the assertion is the only thing holding it to the model

| Tags                                                | Status | Depends on |
| --------------------------------------------------- | ------ | ---------- |
| FE, tests, admin, saisons, spiele, spieltage, teams | Open   | —          |

**Object literals across the frontend suite are cast to `FLSpiel` or `FLSpielAdmin`, and a cast is
what stops the compiler comparing the literal against the model.**
`fl_frontend/src/features/spiele/utils.test.ts` holds most of them, with one apiece in
`fl_frontend/src/features/admin/utils.test.ts`,
`fl_frontend/src/features/spiele/draftStatus.test.ts`,
`fl_frontend/src/features/spieltage/utils.test.ts` and
`fl_frontend/src/features/teams/utils.test.ts`. **Some go through `as unknown as`**, which discards
even the weak excess-property check a plain `as` keeps. The thinnest stand three fields in for the
whole model: `fl_frontend/src/features/spieltage/utils.test.ts :: makeSpiel` returns a `spiel_nr` and
the two `quelle` fields, where `fl_frontend/src/features/spiele/schemas.ts :: FLSpiel` is inferred
from `:: FLSpielSchema`, a mirror of a document in which none of those fields may be missing.

**Nothing is wrong today, and the entry opens by saying so.** Both thin factories feed wiring
functions — `fl_frontend/src/features/spieltage/utils.ts :: orderRoundsByWiring` and
`fl_frontend/src/features/spiele/utils.ts :: quelleKey` — which read the fixture's `spiel_nr` and its
two `quelle` fields and nothing else, so every fixture supplies what its consumer asks for. **This is
a hazard with no defect behind it.**

**What makes it a hazard rather than a style note is the direction a predicate grows.** The functions
these fixtures feed are exactly the ones that gain a clause: a wiring reader that later consults
`sonderereignis`, a status derivation that later reads `elfmeterschiessen`. On the day one does, the
fixture answers with an absent field — a value the model forbids and no stored document can hold —
and the assertion written against it passes, describing behaviour over a document that cannot exist.
**`tsc` cannot report it, because the cast is the author telling it not to.**

**Done when** a stand-in can be checked. **Deleting the casts is not the fix** — a partial literal
standing in for a large model is legitimate in a test and is why the casts are there — and
`satisfies` does not reach it, verifying what is present and leaving the absent fields absent. **The
shape that does is a factory building a complete, valid fixture and taking overrides**, validated
once at construction through the Zod mirror already in the tree, so the fields nobody names are real
values and a fixture that has drifted from the model fails where it is built rather than wherever it
is eventually read; `fl_frontend/src/features/saisons/utils.test.ts` already works this way, its
`spiel` helper spreading a complete base. The size is why it is an entry rather than a fix taken in
passing: a few thousand lines across those files, none of it connected to whatever change happens to
expose the question.

**One thing this entry does not claim** (COR-9). A cast is not what makes a fixture describe the
wrong state. A complete, type-correct literal can still represent something the domain does not
produce, and no type-level mechanism reaches that — not a cast's removal, not a factory, not
`satisfies`. What catches it is a reader, or a predicate that eventually disagrees with it. The two
failures share a file and nothing else.

### `hnx7-zbb9` · One field list is drift-guarded on the backend and hand-written on the frontend

| Tags                   | Status | Depends on |
| ---------------------- | ------ | ---------- |
| FE, BE, tests, saisons | Open   | —          |

**`REQ-RULES-011`'s repair is composed per moved field on the backend and enumerated by hand in the
German.** `fl_backend/app/api/saisons/services.py :: find_rules_refusal` builds its message from the
fields that actually differ, against `:: SHAPE_RULES_FIELDS`, and
`fl_backend/tests/api/test_rules_refusal.py` carries one row per field in `:: SHAPE_REPAIR_CASES` and
asserts at module level that the row's field tuple equals the imported constant, so a further shape
field fails at import rather than going untested. **That guard reaches the backend and stops there** —
nothing outside `fl_backend/` names the constant. The frontend's arm is one static string:
`fl_frontend/src/features/saisons/actions.ts`, in its `REQ-RULES-011` case, maps the repairs onto the
qualifiers and onto the group shape by hand, with a different route for each half. **It is correct
and complete for the fields that exist, and it cannot fail in the dangerous direction** — it can
never collapse to a single repair, which is the defect the backend's guard exists to catch. What it
can do is go quietly incomplete if a further shape field is ever added, naming a repair for some of
them.

**Severity is genuinely low and the entry should say so rather than inflate it.** A further shape field is
unlikely — the ones that exist are what `fl_backend/app/api/saisons/schedule.py :: schedule_for` is a function
of — and the failure is an incomplete sentence rather than a wrong instruction. **What makes it worth an entry
is the asymmetry**: one message has a structural guard on one side and none on the other, and a rule and its
German being two sites is a shape that has already reached an administrator here as a generic message with the
whole gate green.

**Nothing else already reaches it, checked rather than assumed.** Several frontend tests do read
backend declarations at test time — the per-feature `actions.test.ts` files reach
`fl_backend/app/core/domain.py` through `fl_frontend/src/core/refusalRegister.ts` — but they couple
at the level of refusal codes, not fields: `fl_frontend/src/features/saisons/actions.test.ts` asserts
that every code `PATCH /saisons/{saison_id}` declares reaches a `case` in the mapper, `REQ-RULES-011`
included, and reads nothing about what that case's message must name.

**Done when** a table in `fl_frontend/src/features/saisons/actions.test.ts` keyed by shape field is
asserted equal to the field tuple parsed out of `fl_backend/app/api/saisons/services.py`, with each
entry's German required to appear in the `REQ-RULES-011` arm — so a further field fails the frontend
suite the same day it fails nothing on the backend. **This is the concrete instance of `f4uf-jape`'s
general case**, filed separately because its fix is one assertion and that one's is a convention;
folding it in is a reasonable call and this is the half to fold.

### `hq7d-2vnm` · The required-mark guard reads literal names only, so a shared field block is unguarded

| Tags      | Status | Depends on |
| --------- | ------ | ---------- |
| FE, tests | Open   | —          |

**`fl_frontend/src/core/schemaGerman.test.ts :: requiredNamesIn` pairs every control marked
`isRequired` with the schema path it writes, and fails where that schema accepts the emptiness the
control produces.** It reads the path off `name="…"` as a literal, so a control naming itself by
template literal is invisible to it and generates no case.

**`fl_frontend/src/shared/components/ui/AddressFields.tsx` names all five of its controls that
way**, from a `namePrefix` prop, so the address block six callers embed contributes nothing to the
pairing. One of the five carried a mark its schema never enforced, and every suite stayed green.

**Done looks like the five reaching the pairing**, proven by putting `isRequired` back on the
Hausnummer control and watching the suite go red — that field's regex is spelled with `*` rather
than `+`, so it is the one whose schema accepts what a mark would promise to refuse.

The limitation is deliberate and its docstring says so: a computed name and a conditional
`isRequired` both fail toward finding less. **A widened reader must keep that direction** — a name
it cannot resolve is skipped rather than guessed at, because a false pairing fails a branch that
touched neither the control nor the schema, which is the standing tax CUR-6 refuses.

### `huzh-hdfx` · A never-clause bounds what a stylesheet may say about a toast, and the stylesheet says more

| Tags     | Status | Depends on |
| -------- | ------ | ---------- |
| FE, Docs | Open   | —          |

**`.claude/rules/frontend.md` permits a toast to be styled from CSS at the shell and at the
frontmost close button, and `fl_frontend/src/app/globals.css` styles a surface past both.** The
block there sets `.toast` and each of its `--<variant>` modifiers, the close button under
`[data-frontmost]`, and the timer bar — its animation, and the pause the region's hover and focus put
on it.

**The same rule is stated in a wider place, and the wider statement is the one that fits the code.**
[`docs/frontend/spec.md`](../frontend/spec.md) I57 states it as a ban on adding — never a new
`.toast*` rule in a stylesheet — which names the surface rather than counting it. The **toast**
clause states it as a bound on what may be styled at all, and the bound it names falls short of what
the stylesheet holds. PRE-1's ladder puts the code above the spec sheet and the spec sheet above
`.claude/CLAUDE.md`, so the clause is the loser of both.

**Ruled: replace the clause's first half with the spec sheet's formulation and keep the second
half** (`docs/datenschutz.md` §10, 2026-09-02). That is a `.claude/CLAUDE.md`-governed edit only I
authorise, and I do; naming the surface the way I57 does — the toast rules a stylesheet may hold are
the ones markup cannot reach, and a new one is a breach — states the same bound without a figure
that goes stale the next time a rule is genuinely forced into CSS.

**Which parts are genuinely in question, verified against `@heroui/styles` 3.2.4 on 2026-08-20 by
enumerating the selectors its `toast.css` declares:**

- **The variant modifiers are the shell.** HeroUI writes `toast` and its `--<variant>` modifier onto
  one element, so a rule tinting that element's border styles the shell rather than something beside
  it. Every modifier the stylesheet overrides is declared by that file.
- **`toast-region` is never a rule's subject.** It occurs only as the ancestor in the selectors that
  pause the timer, and the property lands on the timer.
- **The timer bar is this app's own element, and its rules are what the clause does not name.**
  `toast.css` declares no `toast__timer` selector, and
  `fl_frontend/src/core/providers/AppToaster.tsx :: toastCard` is what puts the class on the
  element. Its keyframes and its paused state are keyed on an ancestor's hover and focus, which a
  utility on the element cannot express — so a stylesheet is the only route, which is the argument
  the close button's rule already rests on.

**What the change may not sweep in.** `table__column` and the secondary variant's row hover are
vendored selectors overridden in the same file, and no clause governs them. §1.11 of the frontend
spec sheet is what governs both cases, and it already asks a stylesheet rule to name the HeroUI
version it was written against.

**Done when** the clause's first half reads as I57 does, and the stylesheet's toast comment, the
block opening `THE TOAST, deliberately small:` and the one over-bound block in that file no pass has
yet read, has been read once against COR-5 and COR-14 and taken to the lines it constrains.

### `k4wq-8mvr` · Every failure carries a closed class beside its code, and the register's kinds are held by a check

| Tags                           | Status | Depends on |
| ------------------------------ | ------ | ---------- |
| FE, BE, Ops, Docs, gate, tests | Open   | —          |

**A code today fuses two facts, what went wrong and what kind of thing that is, and only the first
is machine-readable.** `docs/logging/error-codes.md` fixes the grammar `<AREA>-<SUBJECT>-<NNN>`,
`scripts/checks/docs_gate/error_codes.py` holds every row to the two source trees in both
directions, and a refusal answered to a caller carries its code in the body and on its log line.
What no consumer can read is the class: whether a caller's precondition failed, an argument was
invalid, the caller was unauthenticated, nothing was found, the service was unavailable or the
server broke. The frontend therefore words every backend code by hand at three sites per refusal
(`.claude/rules/cross-surface.md`'s trap), and a code either site forgets falls through to
`fl_frontend/src/shared/utils/actionError.ts`'s 409 fallback, which tells the admin an equivalent
entry already exists whatever happened. Mature registers carry both: Google's API error model pairs
a canonical status from a closed list with an open `reason`, Stripe pairs a `type` from five with
an open `code`, and RFC 9457 carries `status` beside a `type` that resolves to documentation.

**The register's kinds are a convention no check reads.** A `REQ` row carries an HTTP status and
reaches a response body; `DB`, `SRV`, `SRV-BOOT` and `FE` rows are log events an operator acts on;
the page says so in prose since the grammar was written, and `error_codes.py` reads the shape
alone, so a `REQ` row with no status or an `FE` row claiming one is a page defect the gate cannot
see. Ordered on 2026-09-07 as the mature end state, with the grammar and the retired-codes list
landed first.

**Done when** a closed class of at most eight values travels beside `error_code` in the response
body and on every failure line, declared once per surface and compared by the logging suites the
way L2's key order is; the register carries a kind column the docs gate enforces (a response row
owes a status, a log-only row a severity and the operator's action); the frontend's refusal
registers fall back by class rather than to one 409 message, the hand-written sentences staying
for the codes that deserve one; and `docs/logging/spec.md` L2 records the envelope's new key,
which is an order change on both surfaces and lands in one commit with both suites.

**The trap:** the envelope's key order is asserted as a literal list in `fl_backend/tests/core/test_logging.py`
and `fl_frontend/src/core/logFormat.test.ts`, and `.claude/rules/cross-surface.md`'s **openapi**
clause keeps the two packages from sharing a declaration, so the class enumeration is spelled once
per surface with a comparator, the shape `scripts/checks/check_log_quoting_class.py` already takes.

### `m4m3-hxmj` · The shared editor shell's widest layout step has never been rendered

| Tags     | Status | Depends on |
| -------- | ------ | ---------- |
| FE, Docs | Open   | —          |

**`fl_frontend/src/shared/components/ui/EditFormLayout.tsx :: EditFormLayout` declares a layout step
at the `2xl` breakpoint that nothing has ever exercised**, and every entity editor renders through
it. What has been rendered is the single column below `xl` and the grid inside `xl`, where it
resolves to `minmax(0px, 1fr) 340px` with the rail sticky at 24px. Past `2xl` — 96rem in the
installed Tailwind 4.3.3, the theme declaring no breakpoint of its own — the rail becomes 380px and
the gap widens, and nobody has looked at it.

**Read from the source, the step moves width the wrong way.** The rail gains 40px and the gap gains
8px, and both come out of the form column, so crossing that breakpoint narrows the fields by 48px
while the viewport grows. Whether the wrapper is at `--container-page`'s cap or short of it does not
change the transfer, only the widths either side of it. That arithmetic is derived from the class
list and the token rather than measured in a browser, and confirming it is the work's first step.

**The question is which way the step goes, not merely whether it is tested.** Either the wider rail
earns the width it takes at that size and the step stays, or it is a default nobody chose and the
shell keeps a single grid past `xl`. Both are cheap; neither is answerable without rendering it.

**Where it has to be rendered, and why that is not free.** Every editor sits behind the admin
sign-in, and the sidemenu takes its share of the viewport before the shell sees any of it, so the
breakpoint and the space the shell actually gets are different numbers.
[`docs/_auditing/lessons.md`](../_auditing/lessons.md) §6 records that a session cannot sign in, so
the honest scope is a look at one editor past 96rem, in a real browser, by somebody who can.

### `nadg-bnjb` · Every admin write states its success twice, and the second sentence cannot render

| Tags                               | Status | Depends on |
| ---------------------------------- | ------ | ---------- |
| FE, auth, spiele, spielorte, teams | Open   | —          |

Lands with: `njhn-pmtn`

**Twenty distinct German sentences stand ready for a success that will never render one of them —
24 occurrences across 23 files under `fl_frontend/src`, measured 2026-08-26.** Behind each of them
is an action whose terminal return sets `message`, and each of them writes a fallback beside the
value that always arrives.

Three shapes:

- **A fallback under a `success` guard**, twelve of them: `res.message ?? "Spielort reaktiviert"` and
  its like, in the tables and views that reactivate a row and in the two panels that add one to a
  season — for instance
  `fl_frontend/src/features/spielorte/components/collections/AdminSpielorteTable.tsx :: handleReactivate`
  and
  `fl_frontend/src/features/teams/components/forms/AdminTeamEditForm/FormSaisonSection.tsx :: handleEnterSaison`.
- **A `successMessage` prop**, nine of them.
  `fl_frontend/src/shared/components/ui/EntityForm.tsx :: EntityForm` and
  `fl_frontend/src/shared/components/ui/ConfirmDeleteModal.tsx :: ConfirmDeleteModal` each raise
  `res.message || successMessage`, and the prop is required — so every create form and every
  retirement dialog supplies a sentence it cannot show.
- **Three one-offs**: the match editor's undo toast, the sign-in panel's confirmation, and
  `fl_frontend/src/shared/hooks/useSignOut.ts :: useSignOut`, whose one supplier is `signOutAction`.
  The sign-in one is the sharpest — `fl_frontend/src/features/auth/actions.ts :: neutralResult`
  composes the neutral sentence deliberately, and
  `fl_frontend/src/features/auth/components/forms/SignInForm.tsx :: SignInForm` writes the same
  sentence out again as the fallback beneath it.

**Why the runtime always wins.** `fl_frontend/src/shared/utils/adminMutation.ts :: runAdminMutation`
answers a thrown error through `toActionErrorResult`, which sets `success: false`; a `success` of
true is therefore always the action's own terminal return, and at every site above, that return sets
its `message`. The match editor is the case that looks like an exception and is not:
`fl_frontend/src/features/spiele/actions.ts :: patchAdminSpielDataAction` composes its message
through `fl_frontend/src/features/spiele/utils.ts :: formatSpielUpdateMessage`, whose first sentence
is unconditional, so the empty string that would let its `||` through cannot be produced.

**Nine of the twenty say something different from what renders**, which is what makes this more than
dead weight. `successMessage="Spielort stillgelegt"` stands where the action sends `"Spielort
stillgelegt. Seine Spiele bleiben erhalten."`; `"Team aufgenommen"` where the season is named;
`"Gespeichert"` where the row's own verb is; and the match editor's `"Die Spieldaten wurden
aktualisiert."` where the same sentence arrives without the full stop and with the fan-out behind
it. So a copy pass can correct the wrong string, watch nothing change, and leave the rendered
sentence standing.

**Done is the type moving first.** `fl_frontend/src/shared/types/types.ts :: FormState` types
`message` as optional, so the checker requires each fallback and cannot be shown that none is
reachable — the same wall `njhn-pmtn` meets on `error`. Narrowing `FormState` into a union whose
succeeding member requires its `message` turns every fallback into a compile error rather than a
judgement per site, and the two shared components go with it: `successMessage` stops being required,
or stops existing.

**What must survive the sweep.** The undo toasts' fallbacks read the same way and are live:
`fl_frontend/src/shared/utils/undoDispatch.ts :: offerUndo` renders `message ?? fallback`, and the
`message` the entity editors pass is `undefined` on an ordinary save, so there the fallback is the
ordinary case. **Reading the `??` alone does not separate the two.**

### `nbcn-zvdk` · The panel a triage decision is taken from is rendered by no test

| Tags                                    | Status  | Depends on |
| --------------------------------------- | ------- | ---------- |
| FE, BE, Docs, tests, admin, bewerbungen | Decided | —          |

**`fl_frontend/src/features/bewerbungen/components/views/BewerbungAngabenPanel.tsx` renders
everything one school submitted, and no case anywhere renders it.**
`fl_frontend/src/features/bewerbungen/components/views/AdminBewerbungView.tsx` is its one importer,
and `fl_frontend/src/app/admin/bewerbungen/[bewerbung_id]/page.tsx` serves that. The single test file
touching the panel, `fl_frontend/src/features/bewerbungen/routes.test.ts`, reads it as source text
through the TypeScript syntax tree, and everything it asks is about where the applicant's wished
opponent lands and whether the file writes raw markup.

**How a component is held is settled, and this panel is inside what that reaches.**
`docs/frontend/spec.md` §1.9 puts
a claim about what a component renders against the markup it renders, and
`.claude/rules/frontend.md`'s **tests** clause refuses asserting over source text what a render can
show. The panel is none of the shapes that section lists as beyond a render, so what is open here is
the work rather than the question.

**Three branches the panel takes on stored data are held by nothing.**

- **The club link is guarded on `bewerbung.team_id` and never on the school arm beside it.** An
  acceptance writes that id onto the application
  (`fl_backend/app/api/bewerbungen/admin_router.py :: accept_and_enter_the_school`), so a decided
  new-school application carries a school and a club at once, and a guard reading the arm drops the
  link on exactly the applications that have one to offer. The constraint stands as a comment at the
  line.
- **The `mailto:` and `tel:` hrefs**, the second built off the stored telephone with its whitespace
  stripped, so the dialler takes the number and the text keeps the punctuation a school typed.
- **A fact row's empty value**, where a `null` is a school that answered nothing rather than one that
  answered zero, and takes the panel's one empty grade.

**Done when** the panel is rendered through
`fl_frontend/src/shared/testing/renderTest.ts :: renderMarkup` and each of those three is asserted
against the markup that comes back. **The entry is the panel's absent render coverage and not any one
of the three**: each is what a first pass covers, and filing them one at a time buys a case per
branch and leaves the next one unheld. **Its `Hint` renders as a popover**, so the wording behind
that press is one of §1.9's overlay bodies and out of reach; every other block here stands in the
resting markup.

### `nce5-j467` · A comment claims two files hold the same pattern, and nothing holds them to it

| Tags          | Status | Depends on |
| ------------- | ------ | ---------- |
| FE, BE, tests | Open   | —          |

**The two ends of the wire are resolved against each other in exactly one place, and patterns are
outside it on purpose.** `fl_frontend/src/core/apiContract.test.ts` converts every exported Zod
schema to JSON Schema, pairs it with its component in the committed `fl_backend/openapi.json`, and
compares presence, required, nullable, primitive type and enum members;
`fl_frontend/src/core/apiContract.test.ts :: FieldFacts` states the boundary in terms, that patterns,
lengths, bounds and messages are deliberately not compared because the two sides diverge there by
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
class — a literal space on one side against `\s` on the other, which in JavaScript absorbs a trailing
newline so `$` still matches — with the frontend the looser end, so the failure mode was a form
accepting a value the API answers with a 422 that nothing in the interface can explain rather than a
bad value being stored. **It survived a review, a commit body asserting the two were identical, and a
contract test that does not look at patterns.** The phone pair's blast radius is nil, since no
referee holds a phone number at all, which is exactly what would make a recurrence invisible.

**`hausnummer` is a second hand-mirrored pair, and it does not share that mercy.**
`fl_backend/app/shared/schemas/addresses.py :: HAUSNUMMER_PATTERN` and
`fl_frontend/src/shared/schemas.ts :: HAUSNUMMER_REGEX` are the two ends, each named on its own side
so the read model and the payload cannot drift within a side, and nothing compares them across the
wire. The alphabets agree today, `\d` inside a JavaScript class being `[0-9]`, but every club, venue
and referee form carries a house number, so a divergence here is visible to an admin on the first
address they type. **The prose record is weaker here than for the phone pair**: the mirroring comment
names `custom.py`, where these two ends live in `addresses.py`, so a reader following that comment
never arrives at them.

**Done when** one of three answers is taken, and they are not equivalent. **Check the declared
pairs** — a list of `(python symbol, typescript symbol)` pairs whose patterns must be byte-identical,
compared in the frontend suite that already reads across the boundary; it says nothing about the
pairs not on the list, which is what keeps it inside that boundary. **Drop the claim** — delete the
mirroring sentence, let the two ends diverge like every other validation policy, and accept the 422
as the contract; cheapest, and it gives up the one property that makes the frontend message
trustworthy. **Generate one end from the other** — refused for the mirror as a whole, and refusing it
for one constant is the same argument at a smaller scale.

### `njhn-pmtn` · Every call site writes a fallback for a failure message that always arrives

| Tags     | Status | Depends on |
| -------- | ------ | ---------- |
| FE, Docs | Open   | —          |

Lands with: `nadg-bnjb`

**Forty consumer sites under `fl_frontend/src`, across 28 files, spell `res.error ?? …` or
`res.error || …` for a value that always arrives** (measured 2026-08-26).
`fl_frontend/src/shared/types/types.ts :: FormState` types `error` as optional, so the checker
requires each one; whether any can run is a runtime contract rather than a type claim, and the
contract holds. `fl_frontend/src/shared/utils/adminMutation.ts :: runAdminMutation` answers a thrown
error with `fl_frontend/src/shared/utils/actionError.ts :: toActionErrorResult`, whose every branch
sets `error`, and every failing return under `fl_frontend/src` carries an `error` beside it.

**Seventeen of those sites fall back to a sentence of their own rather than to the shared one**, in
eight files, and one family inside them is a second sentence with no home: the undo's outcome
`"Die Änderung steht weiterhin."` stands 20 times across 14 files (measured 2026-09-03) — the five
undo route handlers, the five slice `actions.test.ts` files reading them, `undoDispatch.ts` with its
test, `undoRoute.ts` and the public-route test — and no module owns it. **No page-owned editor
carries it**, which is worth saying because that is where a reader looks first. §1.12 of
[`docs/frontend/spec.md`](../frontend/spec.md) is where a refusal's vocabulary is fixed and it names
the two homes a new failure message is written from —
`fl_frontend/src/shared/utils/refusal.ts :: buildRefusal` for a refusal that can name a cause, and
`:: UNKNOWN_REFUSAL` for one that cannot.

**The type has moved half the way.** `fl_frontend/src/shared/types/types.ts :: ActionResult` is a
union now and `:: ActionFailure` is its failing member, so the shape this entry asked for exists.
`error` stays optional on that member, which is what keeps every fallback a judgement call rather
than a compile error. **Done is requiring it there**, which turns the rest into a mechanical sweep;
short of that, deleting one is an argument to be had at every site.

**What makes it more than deleting a token.** `fl_frontend/src/shared/components/ui/EntityForm.tsx`
and `fl_frontend/src/shared/components/ui/ConfirmDeleteModal.tsx` reach the sentence through
`res.error || res.message || …`, and their `res` comes from a caller-supplied function rather than
from an action — so the narrowing has to reach the props those shared components declare, not the
actions alone. And the seventeen own sentences are a copy decision each: **a fallback that is dead
weight and a fallback that is the only sentence naming what did not happen read identically at the
`??`.**

**Not decided:** whether the shared sentence should stay generic at all. `toActionErrorResult`
states its own reason for one — the diagnosis is already in the server log, and what an admin needs
is whether retrying can help.

### `pa6f-ksu4` · A season id that is no year is refused nowhere, and first noticed by an hourly sweep failure

| Tags                               | Status | Depends on |
| ---------------------------------- | ------ | ---------- |
| BE, DB, Docs, bewerbungen, saisons | Open   | —          |

**The id a season is created with is held to a width and never to a shape.**
`fl_backend/app/api/saisons/schemas.py :: FLPostSaisonPayload` is the one create payload carrying an
id, stripped and bounded to `fl_backend/app/shared/schemas/bounds.py :: SAISON_ID_LENGTH` characters
— which is a count of characters and not of digits — and
`fl_backend/app/api/saisons/admin_router.py :: post_saison` stores what that payload accepts.
`docs/backend/spec.md :: I5` states that width and nothing narrower, and the `saisons` validator in
`fl_backend/app/core/constraints.py` declares `_id` a bare string with neither length nor pattern. A
label that is not a year therefore reaches the collection by the front door, and every reader needing
a year from it has to cope.

**The retention sweep is where such an id is noticed, hourly and long after it was typed.**
`fl_backend/app/api/bewerbungen/services.py :: next_saison_id` reads a season id as a year to name
the season following it, which the accepted-application erasure and the contact block's clock both
depend on; an id it cannot read is refused rather than answered, so
`fl_backend/app/api/bewerbungen/sweep_router.py`'s pass for that season fails and the caller records
`FE-SWEEP-001` (`docs/logging/error-codes.md`), leaving the other seasons to run and retrying next
pass. That is the right thing for a sweep to do with an id it cannot trust, and the wrong place to
learn of it: whoever typed the id is long gone, the failure repeats every pass until somebody reads a
log, and the two clocks that season owes stand still meanwhile.

**The refusal that suggests itself first is already refused.**
`.claude/rules/backend.md :: db`, the clause `widen one past types and enums`, bars taking a `$jsonSchema` validator
past types and enums, so a pattern on `saisons._id` is not available and naming it as the fix sends
the next reader at a ratified clause. The write path is where a shape rule can live: the create
payload already strips the value and measures it, and a season id is read as a year everywhere it is
read at all.

**Done when** `fl_backend/app/api/saisons/admin_router.py :: post_saison` refuses an id that is no
year, declared on `fl_backend/app/api/saisons/schemas.py :: FLPostSaisonPayload` where the width
already sits, with a case pinning that refusal — `.claude/rules/backend.md`'s `db` clause read first,
so the repair is not looked for in the validator.

### `pb66-krbw` · A fixture carries one date, and a play window cannot be expressed

| Tags           | Status | Depends on |
| -------------- | ------ | ---------- |
| FE, BE, spiele | Open   | —          |

**A fixture's `datum` is a single day, so a match scheduled across a window cannot be recorded as
one** (my item, 2026-08-02). Implementing ranges is heavy in my scoping: it would change the match
editor's form
(`fl_frontend/src/features/spiele/components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm.tsx :: AdminEditSpielDataForm`),
the schemas, and possibly logic and UI elements **across the board**.

**The Zod mirror is not a fourth place to keep in step by hand:** it is checked against the
published document, so one that falls behind `datum`'s new shape is a gate failure naming the field.

**Touchpoints to scope against when it is worked:** `datum` in each schema mirror and in the stored
documents; `computeSpielStatus`'s date comparisons and `formatSpielDisplay`'s labels, each in
`fl_frontend/src/features/spiele/utils.ts`, and the card layouts over them; the `datum` sort on
`GET /spiele` (`fl_backend/app/api/spiele/services.py :: build_spiele_sort`); `searchable_datum` in
the Spielsuche; and the `ausstehend` semantics, **where a filter selects and a label partitions** — a
range makes the ausstehend/heute/vergangen ternary genuinely harder, and the intent (a fixture whose
play window includes today is found by the upcoming filter and labelled `heute`) is what the range
arithmetic has to preserve. Working it re-derives both definitions under ranges.

### `pw5c-zps5` · A referee gets no consent record, where a contact person confirms their own

| Tags                                                   | Status | Depends on |
| ------------------------------------------------------ | ------ | ---------- |
| FE, BE, DB, Docs, meta, schiedsrichter, spieler, teams | Open   | —          |

**A referee's row holds a contact block and a school, and no record of anybody agreeing to either.**
`fl_backend/app/api/schiedsrichter/schemas.py :: _SchiedsrichterWritable` declares `kontakt` and
`schule` and no consent field, and the `schiedsrichter` collection's validator declares none either;
a referee is entered by an administrator through
`fl_frontend/src/features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormKontaktSection.tsx`
and is asked nothing. A team's contact person holds the opposite: a record on
`fl_backend/app/api/teams/schemas.py :: FLKontaktKenntnisnahme` that only that person's own emailed
link can stamp.

**Ruled: referees get a consent record on the same terms as contact persons**
(`docs/datenschutz.md` §2). The two roles hold the same categories about the same pupils — a
telephone number, an email address and a school — so the asymmetry is in the mechanism rather than in
the sensitivity.

**Why it matters.** The privacy notice describes one rule for how the league obtains permission to
hold contact details, and that rule is true of a contact seat and false of a referee, with no field
on the referee to say which. `READ-CONTACT-001` keeps the block admin-tier, so nothing is published:
what is missing is the record, not a guard.

**Three things that shape the work.** The confirmation flow is built on an application — a token
block on the `bewerbungen` collection, a public router that resolves it, and a mail fan-out over
three seats — so reaching a referee is a second collection, a second write path and a second message
rather than a parameter, which is why this is an entry and not a fold-in. The vocabulary is a choice
between the two that exist and never a third: `FLKontaktKenntnisnahme` says only that details may be
held and used, `fl_backend/app/api/spieler/schemas.py :: FLEinwilligung` says what may be published,
and a referee is a pupil whose name is published on every fixture they officiate. And a referee's
removal is an anonymisation rather than a deletion, so whoever adds the record decides whether it
survives one.

**Done when** a referee has a consent record they gave themselves, its validator copy moved in the
same commit as the model, the admin editor rendering that record rather than offering it, and the
notice's referee publication row moved off the legitimate interest it rests on
(`fl_frontend/src/features/meta/components/views/DatenschutzView.tsx`) to the consent the flow
collects.

### `qg8u-tbd6` · One test module is named for a function and holds the cases of two others

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| FE, Docs, tests | Open   | —          |

**`fl_frontend/src/shared/hooks/focusFirstRefusal.test.ts` is named for one export of
`fl_frontend/src/shared/hooks/useServerFieldErrors.ts`**, covers that module's other exports beside
it, and then covers `fl_frontend/src/shared/hooks/useDraftFieldErrors.ts` as well — which already
has `fl_frontend/src/shared/hooks/useDraftFieldErrors.test.ts` of its own.

**Colocation is what says where a module's tests are** ([`docs/frontend/spec.md`](../frontend/spec.md)
§1.9), and here it says the wrong thing twice: a session changing `useServerFieldErrors.ts` finds no
test file beside it and reads that as untested, and one changing `useDraftFieldErrors.ts` finds one
of its two files and stops.

**Done when** each module's cases sit in the file named for it.

### `qstz-dwrj` · Only the match editor tells an admin which empty field somebody is waiting on

| Tags                        | Status | Depends on |
| --------------------------- | ------ | ---------- |
| FE, BE, Docs, admin, spiele | Open   | —          |

**The Fehlt and Offen markers exist on the match editor alone, and putting them on the other entity editors is
a domain question before it is a UI one.**
`fl_frontend/src/features/spiele/components/forms/AdminEditSpielDataForm/ExpectedMarker.tsx :: ExpectedMarker`
renders a marker only where a field is empty **and** a triage category is waiting on it. Those categories are
`fl_frontend/src/features/spiele/types.ts :: ActionRequiredCategory`, each classifies a fixture, and
`fl_frontend/src/features/admin/utils.ts :: ACTION_REQUIRED_LABELS` is where each is spelled out with the
urgency it carries.

**The frontend half is already built.**
`fl_frontend/src/shared/components/ui/FieldLabel.tsx :: FieldLabel` takes an `extraMarker`, every
editor's label goes through it, and §1.14 of [`docs/frontend/spec.md`](../frontend/spec.md) records
the match editor as the one composer filling that slot — stating in terms that the rows behind it
are a concept no other entity has.

**What cannot be borrowed is the meaning.** For a club, a venue, a referee, a player, a squad row, a
matchday and a season, somebody has to say what "the competition is waiting on this field" means,
and whether an empty field there stops anything at all. **A marker that fires on emptiness alone is a
different feature wearing the same disc**, and it would say Fehlt about a description nobody needs.

**And the backend has nothing equivalent to read.**
`fl_backend/app/api/spiele/admin_router.py :: get_spiele_action_required` is the only route
answering "what needs attention", and its qualifying set is a fixture's. A marker on a club's editor
either derives its answer in the browser from what that page already holds, or asks for a route per
entity — and which of those it is decides whether this is a page change or a contract change.

**Nothing is wrong today**: the markers are absent rather than misleading, and every other editor
already says what it needs through its required fields and the rail's Hinweise. What it waits on is
a product ruling per entity, and that cost does not grow while it waits.

### `qw6j-scru` · Two colour swatches and one library attribute are what a fix has to reach before `style-src 'self'` can ship

| Tags                                                                  | Status | Depends on |
| --------------------------------------------------------------------- | ------ | ---------- |
| FE, Ops, Docs, gate, edge, admin, auth, bewerbungen, spieltage, teams | Open   | —          |

**`nginx/prod.conf` and `nginx/local.conf` both send `style-src 'self' 'unsafe-inline'`, and my
ruling of 2026-09-07 is `style-src 'self'` with nothing put in its place** — no nonce, no
`style-src-attr`, and no component-library switch. Each file declares the whole policy three times,
because `add_header` in a location replaces the inherited set
([`docs/ops/spec.md`](../ops/spec.md) §1.4).

**The population that directive governs is narrower than the application.** CSP judges a `style`
attribute in served HTML and a `<style>` element; a property written on an element's `style` object
is a CSSOM write and is governed by neither (MDN's `style-src` page, read 2026-09-07 — that source
moves without us). React emits a `style="…"` attribute only from its server renderer and applies the
same prop through the CSSOM on the client, so
`fl_frontend/src/shared/components/ui/FilterPanel.tsx`'s `--filter-*` properties,
`fl_frontend/src/core/providers/AppToaster.tsx`'s timer duration, and every overlay position
react-aria resolves are outside the policy once hydration has run.

**Inside it are two attributes this repository writes and one the library writes.** Both swatches
render `style={{ backgroundColor: trikotFarbeHex(…) }}` —
`fl_frontend/src/features/bewerbungen/components/views/BewerbungAngabenPanel.tsx` for the wish and
`fl_frontend/src/features/teams/components/forms/TrikotFarbeSelect.tsx` for the assignment — and
`fl_frontend/src/features/teams/constants.ts :: TRIKOT_FARBE_OPTIONS` closes the colour set with its
hex, so a class per colour or a data attribute the stylesheet keys on carries the fill with no
attribute at all. The library's is `--scroll-shadow-size`, which
`@heroui/react`'s `ScrollShadow` sets through a style prop.

**`ScrollShadow` is reached two ways, and the second is why the prerender's count understates the
work.** `fl_frontend/src/shared/components/ui/FilterLeiste.tsx` renders it directly, and HeroUI's
`Tabs` renders one internally, which puts it under
`fl_frontend/src/features/auth/components/forms/SignInForm.tsx`,
`fl_frontend/src/features/spieltage/components/views/SpielplanView.tsx` and
`fl_frontend/src/features/admin/components/views/AdminSpieleActionRequiredView.tsx` besides. A
2026-09-07 build's forty prerendered pages carry exactly one inline style attribute outside
`_global-error`, and it is the sign-in page's — but a prerender is not the population: every page
that streams one of those five components server-renders the attribute too, and a `"use client"`
directive does not keep a component off the server render. So this is a restyle of one component
rather than of one page, and the count to trust is the source's rather than the build's.

**Two residues stay, and each is accepted rather than covered.** Next's own `_global-error` carries
both an attribute and a `<style>` element, and renders unstyled under the strict policy — on a page
that is already the failure of everything above it. react-aria's `usePreventScroll` prepends a
`<style>` element carrying `overscroll-behavior: contain` behind a modal on iOS, which the policy
refuses while the `touchmove` guard beside it still runs; `style-src-elem` and `style-src-attr` are
the directives that would speak to that element alone, and neither is in the ruling.

**A component-library switch was studied for this and declined.** Every candidate positions its
overlays by writing to an element's `style` object — Floating UI under Base UI, Radix and Mantine,
Zag's positioner under Ark and Chakra, react-aria's own `useOverlayPosition` under HeroUI — so the
route CSP does not govern is the route all of them take, while what a strict policy refuses is two
attributes written here and one library attribute a restyle removes anyway. A switch moves none of
the three, and one candidate moves the policy backwards. `6m3r-xpcu` holds the switch on its own
criteria, and the one CSP fact it carries is Mantine's, stated there. (Read 2026-09-07 from MDN,
from react-dom's `setValueForStyle` and from each project's own documentation; all of that moves
without us.)

**Done when** the swatches and the `ScrollShadow` attribute are gone;
`Content-Security-Policy-Report-Only: style-src 'self'` has been served from `nginx/prod.conf`
beside the enforcing header for a week, its `report-to` naming an ingest route of this application
that writes each violation report as one line under the envelope, and the reports read; and the
enforcing policy has then been switched with `scripts/checks/check_csp_identity.py` green.

**The Report-Only phase is the rollout a tightened policy gets everywhere, and my ruling of
2026-09-07 clears its two obstacles here.**
[`.claude/rules/cross-surface.md`](../../.claude/rules/cross-surface.md)'s `csp` clause forbids a
second _enforcing_ policy, so a Report-Only header may stand beside the one that enforces; and
`scripts/checks/check_csp_identity.py` reads `Content-Security-Policy-Report-Only` as a declaration
of the header it watches, its `:: DECLARING_RE` matching up to the hyphen while `:: POLICY_RE`
cannot take a quoted policy out of that line, so the check learns to hold the enforcing copies to
each other and to accept one Report-Only header per file, reporting its policy beside them.
`:: blocks` is the second site it has to learn, and the sharper one: it counts every line
`:: DECLARING_RE` matches toward a block's `policies`, and `:: dropped` fails a block that sets a
header while that count is zero — so a block restating the Report-Only header alone would pass as
having put a policy back while serving none. The ingest route takes the shape of
`fl_frontend/src/app/api/client-error/route.ts`: public and unauthenticated, since a browser posts a
report with no session, and metered at the edge by an exact-match location of its own, which
`scripts/checks/check_public_routes.py` fails until that location exists.

**What the change makes untrue.** [`docs/ops/spec.md`](../ops/spec.md) §1.4 states that several
components set a runtime-computed inline `style` attribute, and offers the `style-src-attr` pair as
the narrowing with `_global-error` as its whole cost. The same section states that
`scripts/checks/check_csp_identity.py` holds each file's three declarations to each other and fails
any further block that sets a header without restating the policy — an accounting the Report-Only
phase changes at both ends, since the file then carries a fourth declaring line that restates
neither header. The policy row, that paragraph and that sentence move in the same commit (CUR-2),
the code being the higher source (PRE-1).

**Not verified.** No Report-Only header has been served and no page opened in a browser, so nothing
here establishes that an SSR'd attribute the parser refused stays unapplied after hydration, or that
every overlay still positions under the strict policy; both are read off the react-dom and react-aria
sources. The five `ScrollShadow` call sites are a source search rather than a measurement of what
each page actually streams.

### `skyx-nrgh` · A refusal composes a repair the product refuses to perform

| Tags                         | Status | Depends on |
| ---------------------------- | ------ | ---------- |
| FE, BE, Docs, tests, saisons | Open   | —          |

**`REQ-RULES-011` names an undraw whose window is narrower than the refusal's own.**
`fl_backend/app/api/saisons/services.py :: find_rules_refusal` composes a repair per moved field, and the one
for `number_of_groups` and `teams_per_group` tells an admin to undraw the Spielplan, change the entries, then
draw it again. `fl_backend/app/api/saisons/services.py :: find_undraw_refusal` permits that undraw only while
the season is `future` and no fixture carries anything recorded against it; every other season is answered
`REQ-SPIELPLAN-006`. **The refusal itself is under no such window** —
`fl_backend/tests/api/test_rules_refusal.py :: TestADrawnSeasonKeepsTheShapeItWasDrawnFrom` pins it holding
whatever the season is doing — so on a running season, and on a planned one carrying a result, the repair
names a write nothing will perform. `REQ-RULES-012`'s own window sits inside that set and is not the size of
it: a played knockout fixture is a recorded one, and so is a called-off group fixture in a season nobody has
activated.

**What an admin meets is a closed control rather than a second refusal.**
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/blockedReasons.ts :: spielplanUndrawBlockedReason`
mirrors the same window and answers _"Zurücknehmen lässt sich der Spielplan nur, solange die Saison geplant
ist."_, which contradicts the sentence that sent them there. [`docs/frontend/spec.md`](../frontend/spec.md)'s
copy standard exempts the continuation of a repair a refusal has already started, on the ground that a loop
broken at its second step leaves an admin exactly where the refusal sent them; **this is that loop broken at
its second step.**

**Ruled: narrow the refusal's sentence to the window in which the undraw it recommends is possible**
(`docs/datenschutz.md` §10, 2026-09-02). A season past that window is told plainly that the two
numbers are fixed for the rest of its life. **Widening the undraw instead is the rejected half** — a
season that has drawn and recorded nothing being arguably still in setup whatever `status` says is a
domain call about what an `active` season may become, and the ruling does not take it.

**The claim is repeated where it is not owned**, so the narrowing moves those with it:
[`docs/domain.md`](../domain.md)'s reading of what an undraw opens,
[`docs/logging/error-codes.md`](../logging/error-codes.md)'s draw-freeze paragraph and
[`docs/frontend/spec.md`](../frontend/spec.md)'s undraw loop each state it as the way back from a
group shape guessed wrong — true in the planning window it was written for, and in no other.

**The German is a hand-written second copy** (`fl_frontend/src/features/saisons/actions.ts`, its
`REQ-RULES-011` arm), so a repair that stops at the backend leaves an admin reading the old
instruction.

### `suuz-dged` · Frontend test modules hook their whole process, so the runner's one-process mode is closed and nothing says so

| Tags                | Status | Depends on |
| ------------------- | ------ | ---------- |
| FE, tests, versions | Open   | —          |

**`fl_frontend/package.json`'s `test` script runs Node's own test runner, which gives every test file
its own process**, and the suite counted 116 modules on 2026-09-02. The installed Node offers
`--test-isolation=none`, which runs the whole suite in one process instead — **the one lever on this
scope that removes work rather than moving it**.

**The modules that stand a double in for another module make that mode unsafe, and they do it
deliberately.** Each calls `registerHooks` from `node:module` to answer a `resolve` or a `load` for
the whole process, standing a double in for a module the code under test imports —
`fl_frontend/src/core/mail.test.ts` is the clearest, replacing `fl_frontend/src/core/config.ts` and
`fl_frontend/src/core/logging.ts` because the test script stands that config's gate down without
supplying a provider key, while the send is asserted by the header that key spells. That module also
replaces `globalThis.fetch` outright. **A hook registered for the process is
registered for every file in it**, so under one process those doubles reach modules that never asked
for them, and the replaced `fetch` is every other test's `fetch` too. **The per-test-file recorder
globals are not the obstacle**: each carries a name of its own, so no two collide.

**Done when** one of two things is chosen. Either those modules are reshaped so that a double is
installed and removed around the module that needs it — **which is a different testing style, not a
smaller one** — or the mode stays closed and a sentence somewhere says why, so the next session
reading `--test-isolation` in Node's help does not spend an afternoon discovering it. **Choosing the
second is a real answer**, and it is the cheaper one; what is wrong today is that neither has been
chosen and nothing records the constraint. What it costs is unmeasured and measuring it is half the
work — each module pays a process start, the alias hook's registration and its own TypeScript load,
all but one of which would go, and the suite already runs while the flag is one word.

### `t3xf-s5hy` · The confirm-panel sweep discovers its roster by the hook a panel calls, so a hand-rolled one is never a subject

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| FE, Docs, tests | Open   | —          |

**The roster is discovered rather than typed, and discovered by the property the cases go on to
assert.** `fl_frontend/src/shared/components/ui/confirmPanel.test.ts :: panelsUnder` walks the
feature tree and keeps a `.tsx` file whose source contains a call to
`fl_frontend/src/shared/hooks/useTwoPressConfirm.ts :: useTwoPressConfirm`; every case then holds
that roster to the shared reveal, the shared armed fill and the shared rows. A panel that escalates
a press from state it arms itself matches no case, because it is not in the population the cases
read — it drops out of the listing rather than failing it, which is the failure
`docs/_standard/standard.md :: PRE-4` names when a check derives its subjects from the property it
asserts.

**The defence the file already carries answers the other half of the problem.** Its own note says a
roster counted against its own length can never report an omission, and that is right: a floor over
the roster's size is what discovery replaces. What discovery does not buy is independence, and the
two listings the sweep requires to agree are both filtered out of that same roster, so they agree by
construction wherever the discriminator is what went missing.

**What a second route would have to key on is the panel, not the hook.** A confirm panel is a
component that renders a destructive or confirming control behind a press the reader has to repeat —
a shape reachable from the control and its copy rather than from an import, so a file that reaches
the same behaviour another way is a subject that fails rather than a subject that is absent. Naming
that shape is the work; keeping the hook as a discriminator beside it is what makes the pair
independent rather than a rename.

**Done when** the roster comes from what a panel is rather than from what it imports, with a case
proving that a panel arming its own state is refused — planted in its real position and driven red
before it is relied on.

**What is read and what is not** (COR-9). The discovery, the discriminator and the cases that consume
the roster were read off the file. No planted panel was driven against the sweep, so that a
hand-rolled one passes silently is derived from the roster's construction rather than observed.

### `tbh5-u4c3` · The browser's own chrome takes no colour from the season scheme

| Tags      | Status | Depends on |
| --------- | ------ | ---------- |
| FE, tests | Open   | —          |

**No `<meta name="theme-color">` reaches the document head.** `fl_frontend/src/app/manifest.ts`
declares `theme_color`, which paints an installed app's chrome and its splash, and a browser tab
visiting the site reads none of it: on a phone the address bar keeps the browser's default while the
page under it is the season scheme's.

**Why it matters.** This is the one brand surface a visitor sees before the page paints, and the
brand refresh reached every other one. It is also the surface where a wrong answer is most visible,
which is why it is filed rather than guessed at.

**The decision it needs.** Two defensible answers, and they look different. Matching the page's own
ground per scheme — `--bg-base`, near-white and near-black — makes the chrome continue the page, and
is what most mature product sites ship. Matching the manifest's brand fill paints the bar Moselgrün
on every phone, which is louder and agrees with the installed app. Next takes both through a
`viewport` export with a `prefers-color-scheme` media pair.

**Done when** the head carries the colour, whichever answer is taken, and it is pinned to the scheme
by the same route `fl_frontend/src/app/brandAssets.test.ts` pins the manifest — parsed from the
stylesheet rather than restated.

### `tutf-44dk` · Three non-text pairs sit under 3:1 in the dark theme, and no row measures one

| Tags          | Status | Depends on |
| ------------- | ------ | ---------- |
| FE, Ops, gate | Open   | —          |

**`scripts/checks/docs_gate/scheme.py :: PAIRS` measures text against its ground and nothing
else, so three pairs that carry meaning without carrying text are unmeasured and each falls under
WCAG's 3:1 floor for a user-interface component in the dark theme.** `fl_frontend/src/shared/components/ui/FilterPanel.tsx`'s selected row is
carried by its fill; `border-border` parts a box from the page it sits on
(`fl_frontend/src/shared/components/ui/card.ts :: card`); and a list box's focus ring marks which
option the keyboard is on.

**Why it matters.** Each is the only signal for the state it carries. A selection nobody can see is a
control whose state is unknowable without moving it, and a focus ring nobody can see makes the
keyboard route through a form unusable while the mouse route is fine — which is why it survives every
sighted pass.

**The trap.** Raising all three is not one change. A border at the 3:1 floor is a hairline that reads
as a rule rather than as an edge, and the sheet's own depth rule says the hairline is what parts a box
from a near-black page — so the border may be a deliberate exception rather than a defect, and the
first move is deciding which of the three are components and which are decoration. WCAG exempts pure
decoration from 1.4.11, and it does not exempt a state.

**Done when** each of the three is either measured by a `PAIRS` row that passes, or recorded as
decoration with the argument in the commit that records it.

### `uayf-u7g4` · The crawler policy is split between robots.txt and Cloudflare, and neither knows about the other

| Tags                | Status   | Depends on |
| ------------------- | -------- | ---------- |
| FE, Ops, Docs, edge | Standing | —          |

**Found 2026-08-01 while diagnosing a missing WhatsApp link preview.**
`fl_frontend/src/app/robots.ts` disallows a named list of AI crawlers, `meta-externalagent` among
them, and **that file is a request**: robots.txt is advisory and a crawler chooses whether to obey
it. Cloudflare is separately enforcing something stronger — measured against the live site on
2026-08-01, `WhatsApp/2.x`, `facebookexternalhit/1.1` and `Twitterbot/1.0` each collected 200 for a
page and for an image while `meta-externalagent/1.1` collected 403 for both, the 403 carrying
`Server: cloudflare` and a `CF-RAY` where `nginx/prod.conf` contains no user-agent or `deny` rules.
**The block is an edge setting, made in a dashboard this repository does not configure and does not
record, and it is invisible from the codebase.**

**Why it matters, and why it is not urgent.** Link previews on Meta's products are fetched by
`facebookexternalhit`, which is served normally, so nothing is broken today. The risk is
consolidation: if preview fetching ever moves behind `meta-externalagent`, every WhatsApp and
Facebook preview for this site stops working, the failure is silent, and nothing in the repository
would explain it.

**What a rework has to decide rather than assume:** whether the AI opt-out belongs in robots.txt, at
the edge, or both — and if both, which one is the source of truth when they disagree, since they
already disagree in kind, one asking and one enforcing; whether blocking an agent Meta also uses for
product features is the intended trade, the opt-out having been aimed at training rather than at
previews; and whether the edge configuration should be recorded here at all, given
[`docs/ops/overview.md`](../ops/overview.md) states that this repository does not configure
Cloudflare — a setting that can break a user-visible feature and leaves no trace in the repo being
the argument for writing it down somewhere.

**Trigger to revisit:** any Cloudflare bot-protection change, or a report of broken previews.
Re-running the measurement takes one `curl` per agent and distinguishes an edge block from a markup
problem immediately.

### `v7bs-d859` · The frontend keeps a visual system that no document states

| Tags     | Status | Depends on |
| -------- | ------ | ---------- |
| FE, Docs | Open   | —          |

**`docs/frontend/spec.md` states no type scale, no colour role and no spacing rhythm.** The system
lives in `fl_frontend/src/app/globals.css` and the recipes under
`fl_frontend/src/shared/components/ui/`, so a session designing anything learns it by reading them or
does not learn it. What that sheet does state on this surface — `:: I43`, `:: I44`, `:: I78`,
`:: I79`, `:: I81` and `:: 1.12 The copy rules` — are the copy and link rules, and they match the
files.

**The visual conventions are kept by imitation and read by nothing.** Prose is `font-medium` and a
bold run is a label, a pill, a button, a `<dt>` or a reader's own value; a decorative glyph is
`aria-hidden` beside the words carrying the fact and never stands alone
(`fl_frontend/src/shared/components/ui/Callout.tsx`); a panel's standing rule is a reveal hint beside
its heading rather than a paragraph closing its body
(`fl_frontend/src/shared/components/ui/formPanel.ts :: heading`); the corner ladder steps down one
level per nesting, 3xl hero to md pill (`fl_frontend/src/shared/components/ui/badges.ts`); the social
marks wear the ground's foreground and never brand
(`fl_frontend/src/shared/components/layout/footer/Footer.tsx`). Each holds across at least three
files, no gate reads any of them, and a design approved against none of them breaks one without
anybody seeing it.

**Writing the page against today's palette would date it before it is read**, the colour roles being
the half most likely to move. That is what the work waits on, rather than a reason to leave the
conventions underived.

**Done when** a page a session meets before it designs anything carries the type scale, the weight
rule, the spacing and radius ladders, the colour roles and the component grammar, and the conventions
above are stated there rather than kept by imitation.

### `v9tn-3hce` · The log answers what broke and hardly what happened

| Tags         | Status | Depends on |
| ------------ | ------ | ---------- |
| FE, BE, Docs | Open   | —          |

**The plumbing is complete and the coverage is of failures alone.** One envelope with an asserted
field set on three surfaces, a trace id minted at the edge and re-spanned at every hop, an access
line at two of the three hops, a code on every failure line and an `aktionen` row for every write:
where a line exists it is a good line. A survey on 2026-09-07 found eleven backend call sites in
three modules and twenty frontend calls in thirteen files, and against what a service is expected to
log, these gaps:

- **No request line on the frontend hop.** nginx and the backend each write one per request; a page
  render, a server action and a route handler write none, so a page view is one edge line and one
  backend line with the middle silent. `fl_frontend/src/shared/utils/traceScope.ts :: runWithIncomingTrace`
  is the one seam every dynamic path passes and both ids are in hand there.
- **A refusal the frontend maps is never logged.** Every feature action catches inside
  `runAdminMutation`'s callback and returns a form state, so a 409 the admin sees leaves no line; the
  three refusals the frontend answers on its own authority (cross-origin, the ingest route's 403 and 422) log nothing either.
- **A domain transition is an `aktionen` row and an anonymous `POST` in the stream.** A season
  activated, a Spielplan drawn, a result recorded, an application accepted: no module under the
  backend's api package writes a line, and the audit row is not in the stream, so a transition cannot
  be read beside the failures around it without leaving the log; the row's `trace_id` is the join
  key that makes a line cheap.
- **External calls log their refusals and never their outcomes.** No line says a mail was sent, a
  sign-in succeeded or a session was created; Auth.js has no `events` block; the database logs its
  boot and nothing after.
- **The retention sweep writes no start, end or counts**, so an hour in which the timer did not fire
  reads like a pass that mailed nobody; neither service writes a line at readiness or shutdown, and
  the frontend does not record whether the sweep armed.
- **Severity means different things on the two hops.** The backend classifies by who acts, every
  caller-fixable status at WARNING and a 503 among them; the frontend classifies by surprise, an
  unmapped ordinary 409 at ERROR and a single visitor's browser crash above a backend 503. `LogMeta`
  extends an open record, so a fourth frontend path inherits no bound where the backend's
  `STRUCTURED_EXTRAS` bounds every line.

Ordered on 2026-09-07: "proper logging at all spots where it is necessary".

**Done when** `docs/logging/spec.md` states which events each surface logs and at which severity,
the ladder meaning one thing on both hops; the frontend writes its request line at the trace seam;
a mapped refusal, a domain transition, a sent mail, a sign-in and a sweep pass each write the line
the sheet names, with the code the register holds; and the frontend's extras are bounded the way
the backend's are. Each line is proved by the surface's own suite the way the failure lines are.

**The trap:** `.claude/rules/cross-surface.md`'s **logging** clause forbids a line outside the
envelope, and the `aktionen` collection deliberately stores the values the stream may never carry
(`fl_backend/app/core/recording.py`), so a transition line names ids and never the values the row
holds.

### `vgk8-btxt` · What decides whether a module belongs in `core` or in `shared` is written nowhere

| Tags     | Status | Depends on |
| -------- | ------ | ---------- |
| FE, Docs | Open   | —          |

**One rule holds the two folders apart, and it is a direction rather than a membership test.**
`docs/frontend/spec.md :: I9` and `docs/frontend/overview.md :: How it is organised` fix that
`fl_frontend/src/core` imports neither `fl_frontend/src/shared` nor `fl_frontend/src/features`, and
that `fl_frontend/src/shared` does not import `fl_frontend/src/features`, enforced by ESLint. Every
module importing nothing above it satisfies both readings, so which of the two folders a new module
goes in is settled by whoever writes it.

**The two have drifted apart in kind while the rule stayed a direction.**
`fl_frontend/src/core/einwilligung.ts`, `fl_frontend/src/core/mail.ts` and
`fl_frontend/src/core/logging.ts` sit beside `fl_frontend/src/shared/utils/refusal.ts` and
`fl_frontend/src/shared/components/ui/ConfirmReveal.tsx` — one set is what the server process does,
the other what a rendered page is built from. That distinction is real and is stated on neither page,
so a reader deriving the rule from the import direction alone arrives somewhere else.

**A reorganisation is its own pull request, and is bounded before it starts.**
`.claude/CLAUDE.md :: structure` refuses a barrel file, an unrequired default export and a second
nesting level, so grouping either folder into subfolders is not the cheap half of this; and every
module moved is an import path rewritten at each call site, which makes the diff wide and the review
shallow exactly where a mistake is a runtime failure. **Naming the rule is separable from acting on
it**, and is the half worth doing first: a rule that answers where a module goes stops the drift
without moving a file.

**Done when** the rule says what belongs in each folder rather than only what may import what,
written where a session adding a module reads it —
`docs/frontend/overview.md :: How it is organised` — with `docs/frontend/spec.md :: I9` keeping the
direction it already holds.

### `vspa-r35v` · One commit imports a frontend module the commit after it adds

| Tags                         | Status   | Depends on |
| ---------------------------- | -------- | ---------- |
| FE, Docs, ci, tests, saisons | Standing | —          |

**`fl_frontend/src/features/saisons/actions.test.ts` imports
`fl_frontend/src/core/refusalRegister.ts`, and one commit on `main` holds that test file without
the module**, the commit directly after it being the one that adds the module.
`git log -S refusalRegister -- fl_frontend/` names the pair, which is how this entry has to be
read: COR-6 keeps a hash out of the corpus because this history has been rewritten before and can
be again, so a hash written here would go dead with nothing saying so. TypeScript answers that specifier with `TS2307: Cannot find module
'../../core/refusalRegister.ts'`, reproduced 2026-08-26 under the resolution options
`fl_frontend/tsconfig.json` sets, and both frontend commands reach it. **Not verified by checkout** —
the tree at that commit was read rather than built, so that both commands fail there is taken from
the absent module and the diagnostic, neither having been run at it.

**One commit and one specifier, measured rather than assumed (2026-08-26).** Every relative and
`@/`-aliased specifier in each `.ts` and `.tsx` file under `fl_frontend/src` was resolved against its
own commit's tree, across a run of consecutive commits — 1850 specifiers at the last of them. That
one commit is the only one carrying an unresolved specifier, and that import is the only one it
carries.

**Nothing is red, and a red build is not the symptom to look for.**
`.github/workflows/verify.yml` triggers on `pull_request` and on a push to `main`. Both judge a
tip — the pull request's merge result, and `main` after the merge commit — and neither checks out a
commit in between, so no CI run visits it. **What it costs is a `git bisect` over the frontend**,
which lands there and answers with a failure unrelated to whatever is being hunted;
[`docs/_git/spec.md`](../_git/spec.md) §1.4 permits merge commits alone, so the commit reaches `main`
verbatim and this does not age out.

**Recognise it and skip it, which is the whole of the action.** git's documented shape for a revision
that cannot be built is exit code 125 from a `git bisect run` script, marking it untestable. The
residual is the one the manual names — skipping a commit adjacent to the culprit leaves git unable to
say which of them was first bad — and this commit's entire frontend delta being one test file is what
settles that by reading the diff. **`.git-blame-ignore-revs` does not reach it**: that file feeds
`blame.ignoreRevsFile` and moves line attribution, where the attribution here is right and is
nobody's complaint. git offers no in-repository list a bisect consults, so this entry is the whole of
the durable warning — and a bisect stands at a detached `HEAD`, so
`git show main:docs/_roadmap/items.md` is what reads this page from wherever it has stopped.

**Rewriting the history is the repair, and it was declined.** Carrying
`fl_frontend/src/core/refusalRegister.ts` one commit earlier means rewriting a pushed branch with a
pull request open against it, which moves every line a review comment is anchored to; weighed against
a bisect that skips one commit, the gap was taken — **so this entry records a decision rather than an
outstanding repair**, and the window in which the fix was cheap closed at the push.

**Trigger to revisit:** a second commit reaching `main` in this shape. One is a skip; a pattern is
the argument for a per-commit resolution check, and the sweep above is what it would be built from.

### `w2c2-xc9j` · One tag strip repeats until it is done, and every other reader of markup as text makes a single pass

| Tags               | Status | Depends on |
| ------------------ | ------ | ---------- |
| FE, tests, saisons | Open   | —          |

**`fl_frontend/src/shared/testing/renderTest.ts :: textOf` repeats its replacement until the string
stops moving, and every other reader of markup as text in the estate makes one pass.** One pass over
`<a<b>>` leaves `<a` standing for the caller to read as text, which is the shape
`js/incomplete-multi-character-sanitization` names. The single-pass readers are
`fl_frontend/src/core/authEmail.test.ts :: readable`,
`fl_frontend/src/core/bewerbungEmail.test.ts :: readable`,
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/spielplanReplace.test.ts :: gelesen`
and
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/teamErsatz.test.ts :: gelesen`.

**No residue reaches any of them, and that is not what this asks about.** Each is handed markup its
own module rendered or built, and the email shell escapes every interpolation through
`fl_frontend/src/core/emailShell.ts :: escapeHtml` — read off the call sites rather than exercised,
so an input that defeats one of them is not established either way. What the estate holds is one
operation written in more than one shape, with nothing in the tree saying which is the answer, so
the next reader copies whichever they open first.

**One helper for all of them would be wrong.** The `readable` helpers strip `<style>` blocks and
decode entities around the tag pass, so that shape is theirs. Each `gelesen` helper is `textOf`
followed by a whitespace collapse, and can delegate.

**Done when** no reader of markup as text stops after a single pass: the helpers whose shape the
harness already serves delegate to it, and the ones it does not repeat their own strip until the
string stops moving.

### `w4tm-9khd` · A sweep reads a JSX opening tag by its first angle bracket, so attribute order decides its population

| Tags               | Status | Depends on |
| ------------------ | ------ | ---------- |
| FE, tests, spieler | Open   | —          |

**`fl_frontend/src/core/schemaGerman.test.ts :: requiredNamesIn` cuts each candidate at
`indexOf(">")` and reads the mark and the field name out of what is left.** Anything standing between
the `<` and the tag's real close therefore truncates the read, and a JSX attribute value is allowed to
contain a `>` — an arrow function most commonly. The sweep exits 0 either way, so what is lost is a
schema's assertion that it refuses an empty value, not a test.

**Today it holds by attribute order alone.**
`fl_frontend/src/features/spieler/components/forms/AdminCreateSpielerForm.tsx` renders a control whose
`onChange={(key) => …}` sits after `isRequired` and `name`, so the cut lands past both. Moving that
attribute above them — a reformat, an alphabetisation, a prettier setting — drops the field from the
population and takes every schema asserted through it. Nothing forbids the move and no check sees it.

**Why a comment cannot be the answer.** The same reader is what
`fl_frontend/src/shared/components/ui/SaisonSelect.tsx` keeps a literal `isRequired` for, and the note
explaining that had to be moved above its own tag for exactly this reason: written inside the tag, one
`>` in the sentence disarmed the sweep the sentence was defending. A convention that cannot be stated
inside the construct it governs is one the next reader breaks.

**Done when** the reader finds a tag's real close rather than its first `>` — comments and attribute
values skipped, so attribute order carries nothing — and has been driven against a control whose
arrow function is written first.

### `z82x-us4y` · A contract sweep's caller set is every file naming the client, its own tests included

| Tags          | Status | Depends on |
| ------------- | ------ | ---------- |
| FE, BE, tests | Open   | —          |

Lands with: `f38s-y3hj`

**`fl_frontend/src/core/apiRequests.test.ts` builds its caller set by walking the source tree for
every `.ts` and `.tsx` whose text names the client**, and nothing in that walk decides a test file.
Several of the files it takes are tests, and the sweep is green only because each of them names the
client inside a string or a comment rather than calling it. Every comparison the module makes
against `fl_backend/openapi.json` reads that one set.

**A fixture calling the real client against an unpublished path would fail as though production
had**, naming a test file to a reader who then goes looking for a broken route — and a fixture
written to exercise a refusal is exactly the shape that calls an unpublished path on purpose.

**Done when** the walk decides the test files for both suffixes it collects. Deciding one suffix
where the walk takes two leaves a `.test.tsx` in the set and reads, from the code, as though the
question had been settled.

### `z8nf-7nzd` · `typing` imports instead of `collections.abc`

| Tags               | Status  | Depends on |
| ------------------ | ------- | ---------- |
| BE, Docs, versions | Decided | —          |

Several backend modules import `Mapping`, `Sequence`, `Optional` and `Callable` from `typing` —
aliases deprecated since Python 3.9, on a project running far newer. **Deliberately not fixed
piecemeal:** modernising one module while the rest keep the old spelling is worse than uniformity.
The decision is to enable ruff's `UP` rules and migrate in one pass, which is why
`fl_backend/pyproject.toml`'s ruff selection leaves that family out.
[`docs/_auditing/prompts/backend/4-architecture.md`](../_auditing/prompts/backend/4-architecture.md)
carries the typing check that owns the migration.

### `zp46-yt3p` · No exact placing is available above the certainty walk's fixture limit

| Tags                     | Status   | Depends on |
| ------------------------ | -------- | ---------- |
| BE, Docs, saisons, teams | Standing | —          |

**Not a defect, and what is accepted is incompleteness rather than silence.**
`fl_backend/app/api/teams/services.py :: _decide_one_gruppe` enumerates every ending of a group's
outstanding fixtures — a call-off among them — and seeds a placing only where the same club holds it
under all of them. That enumeration is bounded per group by `:: CERTAINTY_FIXTURE_LIMIT`, and above
the bound `:: _separated_placings` answers instead, from a per-club interval that is SOUND and
INCOMPLETE: it never seeds a placing the group could still change, and it declines some the exact
walk would have settled. **Every legal group size is answered.** What a decline costs is a bracket
slot left unseeded until the group settles further, and a placing that is merely undecided is
deliberately reported to nobody (invariant I24c).

**Raising the bound is not the fix.** Each fixture past it multiplies the enumeration by the ending
alphabet, and the walk runs once per referenced group inside `PATCH /spiele/{spiel_id}`'s
transaction, whose lifetime is bounded. The walk deduplicates by the points table each ending
produces together with the clubs that ending leaves able to place, and stops the moment no placing
survives every table — so the ranking work is bounded by the distinct tables, while the enumeration
itself is not pruned, which is what the bound guards.

**What the incompleteness costs is bounded in the direction that matters.** A declined placing is a
slot nobody seeds; a wrongly seeded one is a club written into a knockout fixture the group can still
overturn, which every surface then agrees with. The interval test can only make the first mistake.

**Nor is a cleverer algorithm the fix, and the reason was settled on 2026-08-06.** The question this
walk answers — is a team's placing the same however the remaining fixtures go — is the complement of
the classical sports elimination problem. That problem has an efficient exact solution by network
flow **only under a win/draw scheme where a match distributes a fixed number of points**; under the
three-points-for-a-win rule a win creates a point that a draw does not, and deciding elimination
becomes NP-complete (Bernholt, Gülich, Hofmeister and Schmitt, _Football Elimination Is Hard to
Decide Under the 3-Point-Rule_, 1999). Season 2026 scores 3/1/0 through `FLSaisonRules`, and
`win_points` is configurable per season, so the hard case is the one this system has to serve.
**There is therefore no polynomial exact replacement to write.** The approximation was taken, in the
sound direction, which is why no placing it seeds is overturned — and it is what leaves the
incompleteness above the bound as the accepted cost rather than a defect to close.

**The textbook fallback is a person, and this system deliberately does not have one.** Established
platforms do not infer finality at all: a group's standing becomes available to seed the next stage
only when the organiser **validates** it, and validation also locks the group's matches. So the cheap
way to recover a declined placing is an explicit "this group is final" control feeding the same
`DecidedStanding`, not a faster walk.

**Not established:** whether the exact walk is exact against SCORELINES. It hypothesises points and
fixtures left, never goals, so a band holding a club that could still settle is never broken — which
is `docs/backend/spec.md :: I24a`'s second clause rather than a gap above the bound. Settling it needs
a ground-truth oracle over scorelines.

**Trigger to revisit:** any change to how groups are sized, since
`fl_backend/app/api/saisons/schemas.py :: TeamsPerGroup` bounds what the interval test is quadratic
in.
