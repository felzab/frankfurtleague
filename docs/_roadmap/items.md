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
beside it, being a script the gate probes rather than a page. `DB` and `versions` are the two a path
need not produce — a collection name and a manifest are named in prose — so either may stand where
no path derives it, and neither may be missing where one does.

**A slice matches a whole path segment and never a substring**, because German compounds a term into
a longer word meaning something else: `spiele` sits inside `spieler`, and both are live slices with
large trees, so a substring match tags every `spieler` path as the most-used slice in the repository.
The segment matches anywhere in a path rather than under the two roots alone, so
`fl_frontend/src/app/admin/aktionen/` earns `aktionen` from the route tree as well as from the
feature package. The set is whatever `scripts/checks/docs_gate/checks.py :: slice_names` walks off the
two roots, so a package under either one is a slice whether or not the other holds its twin. **An entry
naming no path carries no tag**, and that is a finding
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

| Token       | Item                                                                                                                                       | Tags                                                                                                      | Status   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | -------- |
| `32bs-nhzd` | Every write is recorded, and nothing restores one past the editor's fifteen seconds                                                        | FE, BE, DB, Docs, spiele                                                                                  | Skipped  |
| `3s6w-kndn` | A local gate run's wall clock is three sections trading the tail, and the scripts suite's split has not been read against the run's spread | Ops, Docs, gate, ci, tests                                                                                | Open     |
| `4ad2-vz8k` | The test client reaches anyio through a deprecated alias, and no line in this repository declares either package                           | BE, ci, tests, versions                                                                                   | Standing |
| `645h-nj9q` | The linter runs a version past its end of life, and the documentation for it describes another                                             | FE, Docs, versions                                                                                        | Standing |
| `6m3r-xpcu` | Every replacement for the component library is either a restyle of the foundation it already stands on or a full rewrite                   | FE, Docs, versions                                                                                        | Open     |
| `8wd7-ff49` | The consent field has a schema and a ruled writer, and no flow that writes it                                                              | BE, DB, Docs, tests, registrierungen                                                                      | Blocked  |
| `dgdv-27yw` | No rule engine reads this repository's sources, and four spellings its own readers refuse wait on a parser nobody has declared             | FE, BE, Ops, gate, ci, tests, versions, saisons, spieltage                                                | Open     |
| `f3ar-m4qf` | Setting up a season is a hand-run sequence, and only an admin can enter a squad                                                            | FE, BE, DB, Docs, bewerbungen, einladungen, kontakte, registrierungen, saisons, spieler, spieltage, teams | Open     |
| `k4wq-8mvr` | Every failure carries a closed class beside its code, and the register's kinds are held by a check                                         | FE, BE, Ops, Docs, gate, tests                                                                            | Open     |
| `pb66-krbw` | A fixture carries one date, and a play window cannot be expressed                                                                          | FE, BE, spiele                                                                                            | Skipped  |
| `pw5c-zps5` | A referee's consent record is collected, and the notice still publishes their name on another basis                                        | FE, BE, meta, schiedsrichter                                                                              | Open     |
| `qstz-dwrj` | Only the match editor tells an admin which empty field somebody is waiting on                                                              | FE, BE, Docs, admin, spiele                                                                               | Skipped  |
| `qw6j-scru` | Two colour swatches and one library attribute are what a fix has to reach before `style-src 'self'` can ship                               | FE, Ops, Docs, gate, edge, admin, auth, bewerbungen, spieltage, teams                                     | Open     |
| `v9tn-3hce` | The log answers what broke and hardly what happened                                                                                        | FE, BE, Docs                                                                                              | Open     |

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

### `3s6w-kndn` · A local gate run's wall clock is three sections trading the tail, and the scripts suite's split has not been read against the run's spread

| Tags                       | Status | Depends on |
| -------------------------- | ------ | ---------- |
| Ops, Docs, gate, ci, tests | Open   | —          |

**The profile re-taken on 2026-09-22, two full-form runs on the idle 16-core machine:** the runs took
224.4 and 206.3 seconds, and three sections close last and trade the tail —
`frontend` at 221 and 197, `scripts` at 204 and 202, `format` at 183 and 168 — beside `backend` at 101
and 88, `images` at 83 and 55, `db` at 81 and 61, `ops` at 54 and 43 and `docs` at 37 and 38. On one
loaded run, every scope's worker started within 70 milliseconds of the others and a tool was at work
five to six seconds after its worker, so no scope starts late and the wall is contention.

**Lever 1, the distributed database tier, is taken and measured.** On the idle machine, each width a
pair of runs within a fifth of a second of each other, the tier took 30.1 seconds at two workers,
24.0 at three, 21.0 at four, 18.5 at six and 19.2/19.4 at eight, against 48 to 49 at one worker over five
runs of which no pair converged, so the distribution took thirty seconds off the tier and the cap
and floor `scripts/gate/verify.sh :: GATE_WIDTH_DB_PYTEST` and `:: GATE_WIDTH_DB_PYTEST_FLOOR`
carry sit on those readings. Whether the shared server becomes the
new tail past eight, and whether `WriteConflict` appears at a wider width, is unmeasured and
belongs inside the width question.

**Lever 2, the documentation gate's net split into modules a worker each can draw, is taken, and
its effect on the suite is read on the idle machine; on a whole run's spread it is not.** The gate's
fixture costs 1.34 seconds a build (`scripts/tests/test_check_docs.py :: _load`, memoised in
`:: _STATE`), so the build was never the cost; `.github/gate-wall-clock.tsv`'s `scripts` paragraph
carries what was, and the measurement taken under load, whose raw walls overlap. On the idle machine
on 2026-09-23 the suite at eight workers took 93.0 and 89.7 seconds before the split (729 cases, on `main`) and 67.0 and 67.2
seconds after it (773 cases). The tail is now `scripts/tests/test_gate_forms.py`, which xdist's
`loadfile` order dispatches last.

**Lever 3, distributing the default tier, is rejected against this profile.** The section running
it closes inside the scripts section, and a tier with no database and no container spends a real
fraction of itself in interpreter startup, which a worker pays again per process.
`.claude/CLAUDE.md` §7's `tests` clause closes the other obvious answer to any tail: no db-marked
test leaves the gate.

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

**Done when** the split's effect has been read on the idle machine in interleaved pairs of the whole
suite at eight workers, every figure carrying its spread and its run count, and the worst run after it
beats the best before it — the split then stands as taken — or it does not, and the split is
rejected against that reading.

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

| Tags                                 | Status  | Depends on  |
| ------------------------------------ | ------- | ----------- |
| BE, DB, Docs, tests, registrierungen | Blocked | `f3ar-m4qf` |

**The flow it waits on is an admission, which is not built.** The `Depends on` beside it names
`f3ar-m4qf`, whose part "Admitting a confirmed registration into its squad" is the writer this entry
asks for. The block stands while that entry is on the page and that part is still in it, and an admission
landing lifts it whatever else `f3ar-m4qf` still holds.

**`spieler.einwilligung` has a schema and a gate reading it, and no route writes it.**
`fl_backend/app/core/domain.py :: FIELD_POLICIES` says so of the field, a manual database edit being
its only writer today, so every record stored there is one an earlier write left; the rows carrying
`erteilt_von` as `erziehungsberechtigt` are those, and nothing distinguishes them from a record a
guardian actually filed. A pupil's own consent is collected — the registration's confirmation
composes it, the birthdate beside it, on the registration
(`fl_backend/app/api/registrierungen/services.py :: compose_confirmation_update`) — and nothing copies
it onto this field yet. The publication gate reads this field (`docs/backend/spec.md :: READ-PUPIL-003`),
so it publishes the rows standing today on the records they carry, and nobody a registration
collected. `fl_backend/tests/core/test_consent_writers.py` holds the guardian's provenance to having no
writer while the vocabulary still admits it.

**The writer is ruled.** `docs/datenschutz.md` §2 settles it: everyone signs up for themselves
through the website and gives their own consent there, from 16, and an administrator may neither
create a player nor assume, enter or transcribe a consent on anybody's behalf. So the vocabulary has
a person's own consent and a carried-over record to express and nothing else — `bestandsuebernahme`
already marks the second, and `erziehungsberechtigt` stays in the enum for the rows that carry it,
which the once-only reset of this season's pupil rows removes (`docs/datenschutz.md` §3).

**Undecided, and the admission needs it: where a returning pupil's renewed consent lands.** A pupil
the league already holds who registers again confirms a fresh record on the new registration, under
the text version current that day. `FIELD_POLICIES` marks `spieler.einwilligung` immutable, written
once at the person's creation, so an admission matching an existing person cannot copy that record
onto them as the field stands; whether the person keeps the record they gave first, takes the fresh
one, or keeps both is the ruling.

**Done when** an admission writes a confirmed registration's own record onto the person it creates,
the enum has lost `erziehungsberechtigt` once the reset removed every row carrying it, and a pupil's
birthdate is required on the person from then on, `fl_backend/app/core/domain.py :: UNENFORCED`
carrying the state that ends there. The notice's referee publication row is `pw5c-zps5`'s.

### `dgdv-27yw` · No rule engine reads this repository's sources, and four spellings its own readers refuse wait on a parser nobody has declared

| Tags                                                       | Status | Depends on |
| ---------------------------------------------------------- | ------ | ---------- |
| FE, BE, Ops, gate, ci, tests, versions, saisons, spieltage | Open   | —          |

**Every class of hand-written source reader has been measured against the rule engines, and none
carries it** (decided 2026-09-23). The three named sweeps were expressed in each candidate or shown to
resist it — `fl_backend/tests/core/test_write_shapes.py` for single-language work,
`fl_frontend/src/shared/schemas.test.ts` for a value copied by hand between two languages, and
`scripts/checks/docs_gate/checks.py` for rules over prose. A Python sweep resolves a call against the
application's runtime objects and across modules, which an engine states neither of; a cross-language
sweep compares a runtime value with a source value, so an engine reaches only its extraction half; and
the prose rules that resolve against the tree are the gate's own whichever engine parses the page.

**Four spellings are still read wrong, and each fails loud rather than passing a defect:**

- **An indented code block read as prose.** `owner-voice` reports a phrase inside one. A correct test
  knows the list item around the block, which is block parsing; `markdown-it-py` is installed in the
  dev environment through another package and declared by nothing, so the repair is declaring it in
  `fl_backend/pyproject.toml`'s `dev` group and moving the kernel's Markdown readers onto its tokens.
- **The backend's domain pattern spelled over two lines, or as a plain string with its escape
  doubled.** The value is unchanged, and `fl_frontend/src/shared/schemas.test.ts`, which reads it,
  refuses both spellings.
- **A refusal's sentence moved into a named constant inside its switch arm.**
  `fl_backend/tests/api/test_rules_refusal_mirror.py` cuts the arm at the next `case "` and refuses
  what it finds there.

The cost of each is a false red somebody rewrites around. The last two need a parse across the
language boundary — Python's `ast` spawned from the frontend's unit tests, a new precondition on its
test run, or ast-grep on each side, which is a new dependency on each — so none is built until I rule
on it.

**Five sweep readers lean on where the formatter breaks lines rather than on a parse**, so each is
correct only for source `ruff format` wrote, and a formatter setting that moves a break is a change to
them: `fl_frontend/src/features/saisons/recordedFactMirror.test.ts`,
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/FormRegelnSection.test.ts`,
`fl_frontend/src/features/spieltage/actions.test.ts`,
`fl_frontend/src/shared/components/ui/tabIndicator.test.ts` and
`fl_frontend/src/shared/testing/refusalRegister.ts`.

**Done when** each class's verdict is recorded at COR-14's rung — the header of
`fl_backend/tests/core/app_source.py`, the readers in `scripts/checks/docs_gate/kernel.py`, and
`fl_frontend/src/shared/testing/refusalRegister.ts` for the cross-language reads — and each of the four
spellings is either read correctly, its parser arriving as a pin in `fl_frontend/package.json` or
`fl_backend/pyproject.toml` that states which gate scope and which job in
`.github/workflows/verify.yml` runs it, or accepted as a loud false red by my ruling, the acceptance
written at the reader's line. Every property asserted today is still asserted and still driven red
afterwards, and an answer resting on practice outside this repository cites a public repository a
reader can open.

### `f3ar-m4qf` · Setting up a season is a hand-run sequence, and only an admin can enter a squad

| Tags                                                                                                      | Status | Depends on |
| --------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| FE, BE, DB, Docs, bewerbungen, einladungen, kontakte, registrierungen, saisons, spieler, spieltage, teams | Open   | —          |

**My item, 2026-08-13.** The Saison create form becomes a guided workflow that takes an admin through
a whole new season — its dates, which clubs play it, which clubs are new, and the rules it runs
under — and the season is then built behind that flow, as automatically as it can be. Beside it, an
admin page of the school and team representatives: each is told their team is in the new season and
given a link or a code to paste into that team's group chat. The link leads to a page, also new,
where the players of that team enter themselves with their position, squad number and the rest — a
returning player recognised rather than duplicated, a number clash raised rather than stored. The
Saison page and its editor change with it.

**The representatives' page, the link and the page it opens are built; nothing admits what that page
collects.** `/admin/kontakte` lists the representatives a season holds. An accepted application tells
its own contacts (`fl_frontend/src/features/bewerbungen/notifications.ts :: sendBewerbungMail`); what
is still owed is that message for a team entered by hand. How a link is minted, mailed, replaced and
shut is the contract of [`docs/backend/spec.md`](../backend/spec.md) I277 to I282 and I336. A link names the team
and the season and nobody in them. A registration a pupil submits through it and confirms at their
own link then waits in `registrierungen` as `eingereicht`: `fl_backend/app/api/registrierungen/router.py` lists
the rows and no route admits or declines one, so every `saison_spieler` row is still one an
administrator wrote, and a registered pupil is on no squad list. **The wait is bounded**: an
unconfirmed registration is erased the day after its link's deadline, and one still `eingereicht` when
its season turns `past` is erased whatever the pupil answered
([`docs/backend/spec.md`](../backend/spec.md) I290, I292), so an admission has until its season ends
to take one.

**It is a programme, and its parts are not one change.**

| Part                                                        | Needs first                  | Could ship alone |
| ----------------------------------------------------------- | ---------------------------- | ---------------- |
| The guided creation flow, as a page over the create payload | —                            | Yes              |
| Drawing the season from that flow rather than by hand       | the flow                     | No               |
| Telling a representative entered by hand their team is in   | —                            | Yes              |
| Admitting a confirmed registration into its squad           | —                            | Yes              |
| Recognising a returning player                              | the admission                | No               |
| Raising a squad-number clash                                | the admission                | No               |
| Rework of the Saison page and its editor                    | whichever of the above lands | Yes              |

**The invite's mail is not the message a team entered by hand is owed.** Both presses mail a link only to a
seat whose own person confirmed it, a link being a credential — the club panel's through
`fl_frontend/src/features/einladungen/empfaenger.ts :: bestaetigteEmpfaenger`, the season's through
`fl_backend/app/api/einladungen/services.py :: bestaetigte_empfaenger`. A seat entered on the junction is stored unconfirmed
(`fl_backend/app/api/teams/services.py :: UNCONFIRMED_HERKUNFT`) and only an application's own link confirms
one, so a team entered by hand is mailed its link by neither press, and its administrator hands the link over
by other means. The message this part adds cannot carry the link to an address nobody confirmed. What a
failed notification does is fixed already — no failure to deliver a decision's message retracts the decision
([`docs/frontend/spec.md`](../frontend/spec.md) I39).

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
`spiele.spieltag_id` still has no fixture-level create or delete, and nothing needs one — both
operations that remove a season's matchdays, a confirmed replace and the undraw, remove its fixtures
in the same transaction, so the reference cannot dangle (`fl_backend/app/core/domain.py :: REFERENCES`).

**No public write inserts a person into the league, and the admission will be the first write that
does.** The application form's `POST /bewerbungen` stores what a school submitted, decided by nobody
until the triage reaches it ([`docs/backend/spec.md`](../backend/spec.md) §1.1), and
`POST /registrierungen` stores what a pupil submitted through a team's link, decided by nobody yet; each
confirmation page writes one person's own answer into the record that named them, authorised by an emailed
token rather than by a session. **An admission would be the decision standing between a stranger's
submission and a public squad list**, and the first write to put a squad row and the person behind it
from text nobody in the league typed.

**Recognising a returning player has a shape already, and the tempting version of it is refused.**
`spieler` holds the person and the `saison_spieler` junction holds everything a squad list shows;
`uniq_spieler_id_saison_id` gives a person one row per season, so bringing back somebody who already
has a retired row for that season is `POST /spieler/{spieler_id}/saisons/{saison_id}/reactivate` and
never a second create. Making a create idempotent on a natural key was rejected because a two-letter
shorthand cannot distinguish the same club returning from a different one wanting those letters, and
getting it wrong repoints history silently. **A typed name is a weaker key than a shorthand**, so the
same argument binds harder here: matching on a name has to propose a candidate rather than resolve
one, and the resolution belongs to somebody who can be wrong out loud. The confirmation page shows a
returning pupil their stored birthdate and consent only where its bounded read at their address finds exactly
one row carrying their name (`fl_backend/app/api/registrierungen/services.py :: sole_person`), which presents
a match and resolves none. `ist_nachnominiert` is the field that already records a squad entry arriving after the season
began, derived at the squad row's create from whether the first matchday's `beginn` has come rather than asked
(`fl_backend/app/api/spieltage/crud.py :: nachnominierung_laeuft_in`), and a registration admitted
into a running season is precisely that case: the marker belongs to the squad row an admission would
write.

**Nothing refuses a shared squad number and nothing reports one, so an admission inherits a question
rather than a pattern.** A shared shirt is a permitted state on every write path
(`fl_backend/app/core/domain.py :: UNENFORCED`), and a registration judges `nummer` on its format
alone. The squad editor's rail raises no banner about a number
(`fl_frontend/src/features/spieler/components/forms/AdminSpielerEditForm/banners.ts :: buildSpielerBanners`);
the editor's save routes through a confirmation for any banner above `info`
(`fl_frontend/src/shared/components/ui/railBanner.ts :: resolveBlockingBanners`), and the only one it
raises is `spieler.team-changed` — a transfer rather than a shirt. A whole team registering itself
multiplies those writes, so whether a player admitted from a registration may take a shirt somebody in
the squad already wears — and who is told — is a product call this entry owns, and no admin surface answers it first.

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
chosen, and building this flow before that offer means building the offer twice.

**Where a representative's contact is kept is fixed, and the flow inherits it rather than choosing
it.** The block is embedded rather than given a collection of its own: on the `saison_teams`
junction (`fl_backend/app/api/teams/schemas.py :: FLSaisonTeamKontakte`) and on an application row,
both validated through one sub-schema (`fl_backend/app/core/constraints.py :: _KONTAKTE_PROPERTIES`),
so a role added to the block reaches both collections in the commit that adds it. `/admin/kontakte`
reads the junction's copy, and `fl_backend/app/api/kontakte/admin_router.py :: erase_kontaktperson`
is the one route that removes a person from either.

**Undecided, and it needs a ruling before the flow enters a club: whether the flow may enter a club
it has just created.** No junction row is ever removed — `saison_teams` has a POST, a PATCH and a
replace, and no DELETE — but a club does leave a season two ways, and the WRONG club is the
repairable one: `POST /teams/{team_id}/saisons/{saison_id}/replace` hands the row to the club that
should have been entered, reseeding its identity copy and carrying the change into the season's
fixtures, refused in a `past` season and once any of those fixtures has left a record
(`REQ-REPLACE-001`, `-002`). What it does not reach is the club too MANY: a replacement brings one
club in for one going out, and refuses a club the season already holds (`-003`), so a wizard that
enters a club nobody should have entered still ends in an `austritt` — a public record with a reason
on it, which is a heavy consequence for a step in a flow designed to be fast.

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

### `pw5c-zps5` · A referee's consent record is collected, and the notice still publishes their name on another basis

| Tags                         | Status | Depends on |
| ---------------------------- | ------ | ---------- |
| FE, BE, meta, schiedsrichter | Open   | —          |

**A referee's own consent record is stored, and the published notice still rests their name on a
different basis.** `fl_backend/app/api/schiedsrichter/schemas.py :: FLSchiedsrichter` carries
`einwilligung`, the `schiedsrichter` collection's validator declares it, and
`POST /schiedsrichter/bestaetigung` is the only writer: the person answers their own emailed link,
choosing whether their name is published and whether photographs, videos and interviews may be. The
notice's publication table still gives a referee's name the legitimate-interest basis
(`fl_frontend/src/features/meta/components/views/DatenschutzView.tsx :: VEROEFFENTLICHT`), which
is the basis the record replaces.

**Why the two halves are not one change.** Moving the notice's basis to consent is a claim that the
consent decides what is published, and nothing reads the record yet: the fixture list serves every
referee's name as before. A notice promising a gate that does not exist is worse than one naming the
old basis honestly, so the sentence moves when the read does and not before.

**What the reader of this entry must not do.** The record is not missing and is not to be built
again: a second write path for it would collect a person's answer twice and leave two records to
disagree. The work here is a text and the read it describes.

**Done when** the fixture read decides a referee's published name from their own record, and the
notice's publication row rests on that consent rather than on legitimate interest.

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
  sign-in succeeded or a session was created; the sign-in configuration logs no success; the database logs its
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
