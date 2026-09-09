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

| Token       | Item                                                                                                                          | Tags                                                                        | Status   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| `32bs-nhzd` | Every write is recorded, and nothing restores one past the editor's fifteen seconds                                           | FE, BE, DB, Docs, spiele                                                    | Skipped  |
| `3s6w-kndn` | A local gate run's wall clock is the scripts suite or the frontend build, and the one lever left is inside the scripts scope  | Ops, Docs, gate, ci, tests                                                  | Open     |
| `4ad2-vz8k` | The test client reaches anyio through a deprecated alias, and no line in this repository declares either package              | BE, ci, tests, versions                                                     | Standing |
| `645h-nj9q` | The linter runs a version past its end of life, and the documentation for it describes another                                | FE, Docs, versions                                                          | Standing |
| `6m3r-xpcu` | Every replacement for the component library is either a restyle of the foundation it already stands on or a full rewrite      | FE, Docs, versions                                                          | Open     |
| `8wd7-ff49` | The consent field has a schema and a ruled writer, and no flow that writes it                                                 | FE, BE, Docs, meta, spieler                                                 | Blocked  |
| `dgdv-27yw` | Ninety-four test files parse source by hand, and no rule engine has been measured against one                                 | FE, BE, Ops, Docs, gate, ci, tests, versions                                | Open     |
| `ex2m-qjkg` | The shape offer mirrors four backend numbers with nothing comparing them, and no panel is handed the occupancy its rules read | FE, BE, Docs, tests, saisons, spiele, teams                                 | Open     |
| `f3ar-m4qf` | Setting up a season is a hand-run sequence, and only an admin can enter a squad                                               | FE, BE, DB, Ops, Docs, edge, bewerbungen, kontakte, saisons, spieler, teams | Skipped  |
| `huzh-hdfx` | A never-clause bounds what a stylesheet may say about a toast, and the stylesheet says more                                   | FE, Docs                                                                    | Open     |
| `k4wq-8mvr` | Every failure carries a closed class beside its code, and the register's kinds are held by a check                            | FE, BE, Ops, Docs, gate, tests                                              | Open     |
| `m4m3-hxmj` | The shared editor shell's widest layout step has never been rendered                                                          | FE, Docs                                                                    | Open     |
| `nadg-bnjb` | Every admin write states its success twice, and the second sentence cannot render                                             | FE, auth, spiele, spielorte, teams                                          | Open     |
| `pb66-krbw` | A fixture carries one date, and a play window cannot be expressed                                                             | FE, BE, spiele                                                              | Skipped  |
| `pw5c-zps5` | A referee gets no consent record, where a contact person confirms their own                                                   | FE, BE, DB, Docs, meta, schiedsrichter, spieler, teams                      | Open     |
| `qstz-dwrj` | Only the match editor tells an admin which empty field somebody is waiting on                                                 | FE, BE, Docs, admin, spiele                                                 | Skipped  |
| `qw6j-scru` | Two colour swatches and one library attribute are what a fix has to reach before `style-src 'self'` can ship                  | FE, Ops, Docs, gate, edge, admin, auth, bewerbungen, spieltage, teams       | Open     |
| `suuz-dged` | Frontend test modules hook their whole process, so the runner's one-process mode is closed and nothing says so                | FE, tests, versions                                                         | Open     |
| `v7bs-d859` | The frontend keeps a visual system that no document states                                                                    | FE, Docs                                                                    | Open     |
| `v9tn-3hce` | The log answers what broke and hardly what happened                                                                           | FE, BE, Docs                                                                | Open     |

## The items

### `32bs-nhzd` · Every write is recorded, and nothing restores one past the editor's fifteen seconds

| Tags                     | Status  | Depends on |
| ------------------------ | ------- | ---------- |
| FE, BE, DB, Docs, spiele | Skipped | —          |

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
(`.github/gate-wall-clock.tsv`), its span attributed there to the gate step rather than to the setup
around it (`:: reference stands where it does`). The tail the 2026-08-26 profile
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

### `dgdv-27yw` · Ninety-four test files parse source by hand, and no rule engine has been measured against one

| Tags                                         | Status | Depends on |
| -------------------------------------------- | ------ | ---------- |
| FE, BE, Ops, Docs, gate, ci, tests, versions | Open   | —          |

**Eleven modules under `fl_backend/tests/` parse Python with `ast`, and 83 files under
`fl_frontend/src/` read source text; the files holding them run 6,208 and 25,007 lines.** Those
figures are the files whole rather than the sweep parts alone, so they bound the subject rather than
measure it. Beside them `scripts/checks/` is 11,055 lines across 21 modules and `scripts/tests/`
16,251 across 39. What each of them asserts is a contract nothing else holds; what each of them
contains is a parser written again.

**The walk is repo-agnostic and the property never is, and that split decides every option below.**
Resolving a call, reading a decorator, following an import and finding a JSX tag's real close are
generic work; "a read inside a transaction carries its session" is ours and no purchased tool knows
it. The repository has already begun separating the two — `fl_backend/tests/core/app_source.py` is
shared by five modules — and that helper imports `fl_backend/app/core/collections.py`, so even the
factored walker is coupled to the domain it walks. **A defect in one of these readers is a defect in the walk and
never in the property it asserts** — a JSX opening tag cut at the first `>`, a computed `name` left
unresolved, a strip stopping one pass short of its fixpoint. That is where the cost is.

**Thirty-five of these files cross the language boundary** — 27 under `fl_frontend/src/` read Python,
8 under `fl_backend/tests/` read TypeScript — so a custom ESLint rule and a Python linter plugin
between them reach the majority and cannot touch this third at all. Only an engine parsing both
languages under one rule, or an artefact both sides derive from, does. **The second of those is
already refused**: `.claude/rules/cross-surface.md`'s **openapi** clause forbids generating the Zod
mirror, so a proposal to generate both ends of a contract is settled before it is written.

**Whether the generic half leaves the repository is decided by CUR-2, not by how generic it is.**
`scripts/checks/docs_gate/kernel.py` is 1,334 lines of machinery against `checks.py`'s 2,539 of our
own rules, which is the one clean seam in the tree. Moving the kernel to its own package puts a
documented claim and the checker enforcing it in two repositories, and `docs/_standard/standard.md ::
CUR-2` requires them to move in one commit — "not the same branch eventually, not a follow-up".
`.claude/CLAUDE.md` §7's **docs gate** clauses bound the shape further.

**Done when** three named sweeps of different shape have been expressed in each candidate mechanism
or shown to resist it — `fl_backend/tests/core/test_write_shapes.py` for single-language work,
`fl_frontend/src/shared/schemas.test.ts` for a value copied by hand between two languages, and
`scripts/checks/docs_gate/checks.py` for rules over prose that no code linter addresses — and each
class has a verdict recorded at COR-14's rung. Two bounds hold whatever the verdict: every property
asserted today is still asserted and still driven red afterwards, and a candidate arriving as a pin
in `fl_frontend/package.json` or `fl_backend/pyproject.toml` states which gate scope and which job in
`.github/workflows/verify.yml` runs it. Where an answer rests on practice outside this repository it
cites a public repository a reader can open, never a claim about what is usual.

### `ex2m-qjkg` · The shape offer mirrors four backend numbers with nothing comparing them, and no panel is handed the occupancy its rules read

| Tags                                        | Status | Depends on |
| ------------------------------------------- | ------ | ---------- |
| FE, BE, Docs, tests, saisons, spiele, teams | Open   | —          |

**The offer both shape selects are built from is a mirror of backend numbers that no check compares.**
`fl_frontend/src/features/saisons/shapeOffer.ts` derives every row it opens from its own
`:: MIN_TEAMS_PER_GROUP` and `:: MAX_TEAMS_PER_GROUP`, from
`fl_frontend/src/features/saisons/schemas.ts :: MAX_QUALIFIERS` and from
`fl_frontend/src/features/teams/constants.ts :: GRUPPEN_OPTIONS`, each written beside a comment naming
the Python it mirrors. `fl_backend/tests/shared/test_frontend_mirrors.py :: MIRRORED_BOUNDS` names none
of the four, and `.claude/rules/cross-surface.md` holds the Zod mirror to presence, required, nullable,
type and enum, so `fl_frontend/src/core/apiContract.test.ts` compares no numeric bound either. **A
ceiling moved on the Python side leaves the offer disagreeing with the write path and the whole gate
green** — the **saisons** clause in `.claude/rules/cross-surface.md` bars offering what the write path
refuses, and this is the direction nothing watches.

**The offer's own guard is the strongest pairing reachable without parsing Python, and that is the
limit.** `fl_frontend/src/features/saisons/shapeOffer.test.ts` holds every open row and every closed one
to `fl_frontend/src/features/saisons/schemas.ts :: FLPostSaisonPayloadSchema` in both directions — but
that schema is one of the mirrors in question, so the two agree by construction whatever the backend
says. `fl_frontend/src/features/saisons/recordedFactMirror.test.ts` is the precedent for reading the
Python side instead.

**No panel is handed the season's occupancy, so the rules that read it can only refuse a submit.**
`REQ-RULES-002`, `REQ-RULES-003` and `REQ-RULES-006` weigh the season's own group fill and fixtures, and
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/FormRegelnSection.tsx` and
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/FormSpielplanSection.tsx` receive
freeze flags and fixture counts alone. `REQ-SPIELPLAN-004` demands that every offered group hold exactly
`teams_per_group` after a redraw, so the redraw panel could offer only shapes whose group count times
team count equals the clubs already entered — the one panel where a wrong guess costs a failed draw
rather than a refused save. Threading the fill counts in is cheaper than it sounds: `REQ-RULES-011`
freezes all three shape fields absolutely once a fixture exists, so the only editable case is an undrawn
season, where occupancy is the sole remaining stored constraint.

**No backend rule is removed, and this is written down so a later session does not reach for one.** A
derived offer eliminates a round trip, never a rule: a stale tab holds an offer built from rules that
have since changed, and the API is reachable without the form. Where a rule should genuinely stop
holding, `fl_backend/app/core/domain.py :: UNENFORCED` is the mechanism and deletion is not.

**No layout is sized per group, which is what keeps the widest legal season a design question rather
than a breakage.** Every grid in `fl_frontend/src` is card responsiveness, no tab strip or filter row
carries one entry per group, and no table has a column per group. Nothing on the frontend sorts group
names either, so the byte-order hazard `docs/backend/spec.md :: I54` guards against does not reach this.
The standings page stacks one card per group and grows.

**Done when** the four numbers are compared against the declarations that fix them —
`fl_backend/app/api/spiele/schemas.py :: MAX_QUALIFIERS`,
`fl_backend/app/api/teams/schemas.py :: MAX_NUMBER_OF_GROUPS` and
`fl_backend/app/api/saisons/schemas.py :: TeamsPerGroup`'s two bounds — by a check that reads the
Python, `fl_backend/tests/shared/test_frontend_mirrors.py :: MIRRORED_BOUNDS` being the mechanism
already built for exactly that pairing; and both shape panels are handed the season's group fill, so
`REQ-RULES-002`, `REQ-RULES-003` and `REQ-SPIELPLAN-004` close a row instead of refusing a submit.

**Not verified.** No admin session is available to the sessions that read this, so every claim here
about a control is read off source. What `shapeOffer.test.ts` executes is the offer against the Zod
payload; nothing was seen rendering.

### `f3ar-m4qf` · Setting up a season is a hand-run sequence, and only an admin can enter a squad

| Tags                                                                        | Status  | Depends on |
| --------------------------------------------------------------------------- | ------- | ---------- |
| FE, BE, DB, Ops, Docs, edge, bewerbungen, kontakte, saisons, spieler, teams | Skipped | —          |

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

**What must survive the sweep.** The undo toasts' fallbacks read the same way and are live:
`fl_frontend/src/shared/utils/undoDispatch.ts :: offerUndo` renders `message ?? fallback`, and the
`message` the entity editors pass is `undefined` on an ordinary save, so there the fallback is the
ordinary case. **Reading the `??` alone does not separate the two.**

### `pb66-krbw` · A fixture carries one date, and a play window cannot be expressed

| Tags           | Status  | Depends on |
| -------------- | ------- | ---------- |
| FE, BE, spiele | Skipped | —          |

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

### `qstz-dwrj` · Only the match editor tells an admin which empty field somebody is waiting on

| Tags                        | Status  | Depends on |
| --------------------------- | ------- | ---------- |
| FE, BE, Docs, admin, spiele | Skipped | —          |

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
