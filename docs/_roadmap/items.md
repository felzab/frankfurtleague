# Open items

**Purpose:** everything open on the product, the toolchain, the gate and the documentation corpus —
each entry carrying the analysis its decision needs. How an entry is authored and closed is
[`protocol.md`](protocol.md)'s.

| Section                                               | Answers                                                  |
| ----------------------------------------------------- | -------------------------------------------------------- |
| [What every entry carries](#what-every-entry-carries) | Which fields an entry states, and what each one may hold |
| [The items](#the-items)                               | Each entry in full                                       |

## What every entry carries

An entry is a ``### `<token>` · <the claim>`` heading, then one table of the two fields below, then
the analysis, and it says what is wrong, why it matters and what done looks like. Analysis stays
only where it changes the approach — a rejected alternative written as a present constraint, or a
trap the implementer would otherwise walk into. Everything else goes to the body of the commit that
files the entry, which `git log -S` reaches.

| Field          | Holds                                                              |
| -------------- | ------------------------------------------------------------------ |
| **Status**     | One value from the closed set [`protocol.md`](protocol.md) derives |
| **Depends on** | The token of an entry here that blocks this one, or an em dash     |

**A token is eight characters from `abcdefghjkmnpqrstuvwxyz23456789`, hyphenated after the fourth** —
no `i`, `l`, `o`, `0` or `1`, because a token is read aloud and typed into a commit trailer.
It is generated at random when the entry is filed rather than allocated from a sequence, checked for
collision with one `git grep`, and carries no order and no meaning. It is never reused, and a
closing commit's trailer names it.

**A status is derived, never chosen**, by the first matching row of
[`protocol.md`](protocol.md) — which is also where each value's meaning is fixed. A closure
re-derives every entry's, not only its own, because `Blocked` is a claim about another entry.

**An entry may carry one `Lands with:` line** naming the tokens it shares a pass with. It is deleted
when any member of that batch lands, so it is either current or gone. Relatedness by subject is
never written there: the paths two entries name already answer it.

Some entries are seeded into an audit pass under `docs/_auditing/prompts/` as one of its starting
checks. Some are issue-shaped feature work parked here at my direction, so that one place holds what
is outstanding; everything else belongs here only while the reasoning, rather than the work, is the
deliverable.

## The items

### `32bs-nhzd` · Every write is recorded, and nothing restores one past the editor's fifteen seconds

| Status  | Depends on |
| ------- | ---------- |
| Skipped | —          |

**The recording exists and the restore over it does not.** Every write funnels through
`fl_backend/app/core/crud.py` and is recorded with the actor, the request, the collection, the
document and the image the write replaced (`fl_backend/app/core/recording.py`); `/bereich/admin/aktionen`
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

### `4ad2-vz8k` · The test client reaches anyio through a deprecated alias, and no line in this repository declares anyio

| Status   | Depends on |
| -------- | ---------- |
| Standing | —          |

**Importing starlette's test client emits one `DeprecationWarning` naming `anyio.abc.BlockingPortal`,
and the import is what emits it rather than any test.** That module binds its portal-factory type at
module level from the alias, and the installed anyio serves the name through a deprecation hook that
warns and redirects to `anyio.from_thread.BlockingPortal`. `from __future__ import annotations` at the
top of the starlette module does not defer the access — it defers annotations, and this is a plain
assignment — which is the reading most likely to talk somebody out of checking. Verified 2026-09-07:
one warning, raised from that assignment. Both packages move without us.

**What the removal of that alias costs is a collection error in every module under
`fl_backend/tests/` that imports `TestClient` from `fastapi.testclient`**, the same starlette
module. The failure would land where a module is collected rather than in an assertion anybody can
read as a product defect — the default backend tier turning red at once, naming a package this
repository never asked for.

**Only starlette is declared, and by a floor rather than a pin.** `fl_backend/pyproject.toml` names
no anyio, which arrives as a transitive dependency in `fl_backend/uv.lock`, so the `uv` ecosystem in
`.github/dependabot.yml` can propose only starlette by name. The starlette release that stops
touching the alias would be proposed by name; the anyio release that removes it is proposed by
nothing, and reaches the tree inside another bump's lockfile resolution.

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

| Status   | Depends on |
| -------- | ---------- |
| Standing | —          |

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

**`eslint.org/docs/latest` serves v10**, so for 9.39.5 it fails `.claude/CLAUDE.md` §4's test of a
reference — official **and** current, with the installed version in it as a documented release —
and nothing in the reading marks the gap. **An eslint API claim here has to come from a
version-pinned page or from the installed package under `fl_frontend/node_modules`, and has to say
which.**

**Trigger to revisit:** an `eslint-plugin-jsx-a11y` release whose peer range admits eslint 10, under
an `eslint-config-next` whose bundled `eslint-plugin-import` and `eslint-plugin-react` admit it too.

**Not verified:** which v10 changes bite here once the set moves — the migration guide was not read
against the configuration, no move shipping while the walk holds it, and a plugin that does move may
carry a changed rule default under it, which [`docs/frontend/spec.md`](../frontend/spec.md) is where
it lands. The move also re-answers the cache key and threading decision
[`docs/ops/spec.md`](../ops/spec.md) §1.6 records.

### `6aqh-cw5k` · Moving to pnpm 12 silences the frontend's security alerts until GitHub's graph reads the lockfile's second document

| Status   | Depends on |
| -------- | ---------- |
| Standing | —          |

**pnpm 12 writes `fl_frontend/pnpm-lock.yaml` as two YAML documents, and GitHub's dependency graph
reads only the first.** With `packageManager` in `fl_frontend/package.json` naming a pnpm 12 release,
pnpm records that pin in a leading document (`packageManagerDependencies`) and writes the ordinary
lockfile after it. The graph Dependabot's alerts are raised from parses the leading document alone,
so it holds pnpm's own packages and none of the frontend's: no alert opens for `fl_frontend`, alerts
already open close as fixed, and no security update is proposed. That is the route
`.github/dependabot.yml` names for security updates and
[`docs/_git/spec.md`](../_git/spec.md#16-repository-settings) switches on; the gate's
`pnpm audit:prod` only warns. The fault is GitHub's, dependabot-core issue 15904
(https://github.com/dependabot/dependabot-core/issues/15904), open when read on 2026-09-24.
Dependabot's version-update grapher already reads the last document, which changes nothing here: the
alerts come from the graph, a separate parser.

**pnpm stays on its 11 line until that issue is fixed**, as I ruled on 2026-09-24 — the pin in
`fl_frontend/package.json` and `fl_frontend/Dockerfile`'s `PNPM_VERSION`.

**Done when** the move to pnpm 12 has landed and `gh api repos/felzab/frankfurtleague/dependency-graph/sbom`
counts the frontend's packages whole after it, the count matching one taken before the move rather
than the pin's handful.

**The move commits the leading document pnpm writes, or every fresh checkout rewrites the lockfile.**
The first pnpm call finding the pin's record missing writes it, `pnpm --version` included, and the
gate's scopes starting at once race to rename the file. The document is additive: nothing in the
ordinary lockfile is re-resolved.

**`pmOnFail: ignore` in `fl_frontend/pnpm-workspace.yaml` keeps the lockfile one document, and is
refused**: pnpm then stops switching to the pinned release, so a local run is pinned by nothing.

### `6m3r-xpcu` · Every replacement for the component library is either a restyle of the foundation it already stands on or a full rewrite

| Status | Depends on |
| ------ | ---------- |
| Open   | —          |

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

### `8wd7-ff49` · A guardian's provenance stays in the consent vocabulary, and a pupil's birthdate is not yet required

| Status | Depends on |
| ------ | ---------- |
| Open   | —          |

**The admission writes the pupil's own record.** A confirmed registration's record reaches the person
the admission creates whole; onto a person the league already holds, it renews the record, and each
choice only where the registration set it later, so a choice the person moved since stands
(`fl_backend/app/api/registrierungen/services.py :: compose_person_update`,
`docs/backend/spec.md :: I867`). The publication gate reads this field
(`docs/backend/spec.md :: READ-PUPIL-003`).

**What is left is a value no route writes.** The rows carrying `erteilt_von` as `erziehungsberechtigt`
are ones an earlier manual write left, and nothing distinguishes them from a record a guardian
actually filed. `fl_backend/tests/core/test_consent_writers.py` holds the guardian's provenance to
having no writer while the vocabulary still admits it.

**The writer is ruled.** `docs/datenschutz.md` §2 settles it: everyone signs up for themselves
through the website and gives their own consent there, from 16, and an administrator may neither
create a player nor assume, enter or transcribe a consent on anybody's behalf. So the vocabulary has
a person's own consent and a carried-over record to express and nothing else — `bestandsuebernahme`
already marks the second, and `erziehungsberechtigt` stays in the enum for the rows that carry it,
which the once-only reset of this season's pupil rows removes (`docs/datenschutz.md` §3).

**Done when** the enum has lost `erziehungsberechtigt` once the reset removed every row carrying it,
and a pupil's birthdate is required on the person from then on, `fl_backend/app/core/domain.py ::
UNENFORCED` carrying the state that ends there. The notice's referee publication row is
`pw5c-zps5`'s.

### `dgdv-27yw` · No rule engine reads this repository's sources, and two spellings its own readers refuse wait on a parse across the language boundary

| Status | Depends on |
| ------ | ---------- |
| Open   | —          |

**Every class of hand-written source reader has been measured against the rule engines, and none
carries it** (decided 2026-09-23). The three named sweeps were expressed in each candidate or shown to
resist it — `fl_backend/tests/core/test_write_shapes.py` for single-language work,
`fl_frontend/src/shared/schemas.test.ts` for a value copied by hand between two languages, and
`scripts/checks/docs_gate/checks.py` for rules over prose. A Python sweep resolves a call against the
application's runtime objects and across modules, which an engine states neither of; a cross-language
sweep compares a runtime value with a source value, so an engine reaches only its extraction half; and
the prose rules that resolve against the tree are the gate's own whichever engine parses the page.

**Two spellings are still read wrong, and each fails loud rather than passing a defect:**

- **The backend's domain pattern spelled over two lines, or as a plain string with its escape
  doubled.** The value is unchanged, and `fl_frontend/src/shared/schemas.test.ts`, which reads it,
  refuses both spellings.

The cost of each is a false red somebody rewrites around. Both need a parse across the language
boundary — Python's `ast` spawned from the frontend's unit tests, a new precondition on its test run,
or ast-grep on each side, which is a new dependency on each — so none is built until I rule on it.

**Five sweep readers lean on where the formatter breaks lines rather than on a parse**, so each is
correct only for source `ruff format` wrote, and a formatter setting that moves a break is a change to
them: `fl_frontend/src/features/saisons/recordedFactMirror.test.ts`,
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/FormRegelnSection.test.ts`,
`fl_frontend/src/features/saisons/actions.test.ts`, `fl_frontend/src/features/spieltage/actions.test.ts` and
`fl_frontend/src/shared/components/ui/tabIndicator.test.ts`.

**Done when** each class's verdict is recorded at COR-14's rung — the header of
`fl_backend/tests/core/app_source.py`, the readers in `scripts/checks/docs_gate/kernel.py`, and
`fl_frontend/src/shared/schemas.test.ts` for the cross-language reads — and each of the two
spellings is either read correctly, its parser arriving as a pin in `fl_frontend/package.json` or
`fl_backend/pyproject.toml` that states which gate scope and which job in
`.github/workflows/verify.yml` runs it, or accepted as a loud false red by my ruling, the acceptance
written at the reader's line. Every property asserted today is still asserted and still driven red
afterwards, and an answer resting on practice outside this repository cites a public repository a
reader can open.

### `f3ar-m4qf` · Setting up a season is a hand-run sequence, and a squad-number clash is stored once raised

| Status | Depends on |
| ------ | ---------- |
| Open   | —          |

**My item, 2026-08-13.** The Saison create form becomes a guided workflow that takes an admin through
a whole new season — its dates, which clubs play it, which clubs are new, and the rules it runs
under — and the season is then built behind that flow, as automatically as it can be. Beside it, an
admin page of the school and team representatives: each is told their team is in the new season and
given a link or a code to paste into that team's group chat. The link leads to a page, also new,
where the players of that team enter themselves with their position, squad number and the rest — a
returning player recognised rather than duplicated, a number clash raised rather than stored. The
Saison page and its editor change with it.

**The representatives' page, the link, the page it opens and the team's admission are built.** `/bereich/admin/kontakte` lists the representatives a season holds. An accepted application tells
its own contacts (`fl_frontend/src/features/bewerbungen/notifications.ts :: sendBewerbungMail`); what
is still owed is that message for a team entered by hand. How a link is minted, mailed, replaced and
shut is the contract of [`docs/backend/spec.md`](../backend/spec.md) I277 to I282 and I336. A link names the team
and the season and nobody in them. A registration a pupil submits through it and confirms at their
own link then waits in `registrierungen` as `eingereicht` until a seat holder of the team admits or
declines it (`fl_backend/app/api/registrierungen/person_router.py`). The admission writes the pupil
into the person their address resolves to, or the one addressless namesake the team confirms, rather
than a second one ([`docs/backend/spec.md`](../backend/spec.md) I951, I952). The team's pending read
marks a squad number the live squad already wears, and the admission stores it all the same. **The wait is bounded**: an
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
| Keeping a raised squad-number clash from being stored       | —                            | Yes              |
| Rework of the Saison page and its editor                    | whichever of the above lands | Yes              |

**The message a team entered by hand is owed carries no link.** Both invite presses mail a link only
to a seat whose own person confirmed it, a link being a credential — the club panel's through
`fl_frontend/src/features/einladungen/empfaenger.ts :: bestaetigteEmpfaenger`, the season's through
`fl_backend/app/api/einladungen/services.py :: bestaetigte_empfaenger`. A seat an administrator enters
on a team's season row is stored unconfirmed and confirms through a link of its own, which the
contacts save mints and `fl_backend/app/api/teams/admin_router.py :: einladen_kontakt` mints again, so
the invite reaches such a team once one of its people has answered and not before. Whatever the
message this part adds is sent to, it cannot carry the invite to an address nobody confirmed. What a
failed notification does is fixed already — no failure to deliver a decision's
message retracts the decision ([`docs/frontend/spec.md`](../frontend/spec.md) I39).

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
is a panel an admin presses on `/bereich/admin/saisons/[saison_id]` once the clubs are in
(`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/FormSpielplanSection.tsx`),
which is the hand-run sequence this entry is about rather than a flow.

**Ending the flow by making the season live is the one thing it must not do.**
`POST /saisons/{saison_id}/activate` is the only code path in the system that writes `status`, a
created season is always `future`, and creating and activating are two steps **on purpose** — a
single "create it and make it live" call turns a typo in a four-character season id into a silent
rollover of the running season, produced by a form field. A guided workflow that finishes by making
the season current is exactly that call with a wizard in front of it. The flow ends at a season that
is ready and `future`; the rollover stays the panel on `/bereich/admin/saisons/[saison_id]`, where the
outgoing season's unfinished fixtures are listed rather than counted.

**A matchday follows from the rules rather than from a person, which is what makes generating a
season a consequence rather than a feature.** A phase takes exactly the matchdays its rules imply —
one per round, so a knockout round is one matchday and not several — and `position` and
`saison_phase` are the draw's, on no payload afterwards. `/bereich/admin/spieltage` lists what the draw
wrote, and a matchday's own editor sets the span the draw leaves null. What remains of the
structural half is therefore the flow that collects the rules, not a second writer of anything:
`spiele.spieltag_id` still has no fixture-level create or delete, and nothing needs one — both
operations that remove a season's matchdays, a confirmed replace and the undraw, remove its fixtures
in the same transaction, so the reference cannot dangle (`fl_backend/app/core/domain.py :: REFERENCES`).

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
one row carrying their name and a record they confirmed (`fl_backend/app/api/registrierungen/services.py :: seite_of`),
which presents a match and resolves none. `ist_nachnominiert` is the field that already records a squad entry arriving after the season
began, derived at the squad row's create from whether the first matchday's `beginn` has come rather than asked
(`fl_backend/app/api/spieltage/crud.py :: nachnominierung_laeuft_in`), and a registration admitted
into a running season is precisely that case: the admission derives the marker on the squad row it
writes.

**A shared squad number is reported and never refused, so the admission inherits a question rather
than a pattern.** A shared shirt is a permitted state on every write path, the admission's included
(`fl_backend/app/core/domain.py :: UNENFORCED`), and a registration judges `nummer` on its format
alone. Only the team's own reads mark the clash; the administrator's squad editor raises no banner
about a number
(`fl_frontend/src/features/spieler/components/forms/AdminSpielerEditForm/banners.ts :: buildSpielerBanners`).
A whole team registering itself multiplies those writes, so whether a player admitted from a
registration may take a shirt somebody in the squad already wears — and who is told — is a product
call this entry owns, and no surface answers it first.

**What the Saison page and its editor inherit.** The create form is a dialog today
(`fl_frontend/src/features/saisons/components/modals/AdminCreateSaisonModal.tsx` over
`fl_frontend/src/features/saisons/components/forms/AdminCreateSaisonForm.tsx`), and what happens
when a form outgrows one is already fixed: it becomes a page at its own route, with panels per
section, a field judged when it is left, one save bar, a discard guard and an undo route handler. A
flow that also picks clubs and creates them passes that threshold by a distance, so the guided
workflow is a page rather than a larger modal, and the pattern to copy is on
`/bereich/admin/saisons/[saison_id]` —
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm.tsx` and
the panels beside it, the Spielplan draw among them. The editor is where a wrong answer from the
flow is corrected, so every field the flow collects has to be editable afterwards, and the narrowing
refusals `find_rules_refusal` performs are what the flow has to state while a value is still being
chosen, and building this flow before that offer means building the offer twice.

**Where a representative's contact is kept is fixed, and the flow inherits it rather than choosing
it.** The block is embedded rather than given a collection of its own: on the `saison_teams`
junction (`fl_backend/app/api/teams/schemas.py :: FLSaisonTeamKontakte`) and on an application row,
both validated through one sub-schema (`fl_backend/app/core/constraints.py :: _KONTAKTE_PROPERTIES`),
so a role added to the block reaches both collections in the commit that adds it. `/bereich/admin/kontakte`
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

### `f8sh-mbgg` · The site's whole design is redone in one pass, and the frontend's deduplication and cleanup ride in it

| Status | Depends on |
| ------ | ---------- |
| Open   | —          |

**My item, 2026-09-23.** A later session redoes the design and the UI and UX of the whole site, to
make it more professional and better, and takes the frontend's deduplication, the deletion of
whatever is unnecessary and its general cleanup with it rather than beside it. What a sweep of the
frontend found is below; the intent is wider than those findings, and the session is judged against
the intent.

**Two page shells are assembled by hand on every page that has one, and each has one reason to
change.** jscpd over the frontend's production sources, run on this tree on 2026-09-23:

- **The entity editor.** Every editor that renders `ConfirmSaveModal` wraps its own sections in the
  same frame — `DraftStatusProvider` around the form, `EditFormLayout` and its rail,
  `FormActionBar`, `ConfirmDiscardModal` and `ConfirmSaveModal` — about 40 to 76 duplicated lines
  per pair of editors. The parts are shared already ([`docs/frontend/spec.md`](../frontend/spec.md)
  §1.14), so what repeats is their assembly.
- **The admin table.** Every `Admin*Table.tsx` under `fl_frontend/src/features` builds the same
  frame around its columns — a card per row below `md`, a `Table` inside a card above it, and the
  shared empty row and empty card — about 27 duplicated lines each.

**Sweeps read each of those pages as source, and they move in the same change as the shell.**
`fl_frontend/src/features/admin/editorWiring.test.ts` finds the editors by the text
`<ConfirmSaveModal` in their files, and `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`
finds the tables by the shared emptiness beside a react-aria table and renders each one to read its
column arithmetic. Each holds a roster to what it finds, so a shell moved into one shared component turns
it red; the repair re-aims it at the shared component and keeps asserting what it asserted per page,
because a case is cut only where a surviving one still fails for the same regression
(`.claude/CLAUDE.md` §3).

**Two smaller duplications sit on pages the redesign reaches, each shaped and none built:**

- **The confirmation pages' scope picker and answer handling.** The pupil's page and the referee's,
  `fl_frontend/src/features/registrierungen/components/views/SpielerBestaetigungView.tsx` and
  `fl_frontend/src/features/schiedsrichter/components/views/SchiedsrichterBestaetigungView.tsx`,
  share 113 lines over ten spans — the `ToggleButtonGroup` over the stamped `umfang` options, and
  the arms for an unclear answer, a dead link and a refused submission — and each shares 53 or 60
  more with the contact seat's page, `fl_frontend/src/features/bewerbungen/components/views/BestaetigungView.tsx`.
  The shape is one picker taking its options, its value and its setter, and one answer handler.
  **The options are passed, never derived**: `umfang` holds different values on a pupil and on a
  contact seat, so a picker reading one model's vocabulary is wrong on the other with no type
  refusing it (`docs/glossary.md :: Einwilligung`). None was built because each page's copy and
  payload differ, and the three are read side by side before one shape is chosen.
- **The error boundaries' retry.** `fl_frontend/src/shared/components/ui/Error.tsx` and
  `fl_frontend/src/features/dashboard/components/ui/DashboardErrorBoundary.tsx` wire the same
  refresh-then-reset retry, and the argument for it is written at `Error.tsx` alone. The shape is
  one hook.

**A test double is copied, and this pass takes it as the frontend's cleanup rather than a page's:**

- **`aRequest`**, spelled in each route test under `fl_frontend/src/app/api/` that declares one, in
  three variants — throwing on an absent body, not throwing, and taking headers alone. One helper,
  with the throwing and the non-throwing variants kept apart until each caller is read.

**What the redesign reopens from what that sweep kept, and what it does not:**

- **The panel recipe.** jscpd pairs sections across the editors' panels on their imports and their
  panel header alone; `fl_frontend/src/shared/components/ui/formPanel.ts` and
  `fl_frontend/src/shared/components/ui/PanelHeading.tsx` already carry what they share, and each
  section's fields are its own. A new panel look changes the recipe, never a section.
- **The match details dialog's own blur layer.**
  `fl_frontend/src/features/spiele/components/modals/SpielDetailsModal.tsx` carries a copy of the
  blur beside `fl_frontend/src/shared/components/ui/ModalShell.tsx` on purpose, as the comment at the
  line says, so a new dialog treatment reaches both.
- **Not reopened: the three match cards.** `.claude/rules/frontend.md`'s `spiele` clause forbids
  merging the `SpielCard` variants and [`docs/frontend/spec.md`](../frontend/spec.md) §1.6 records
  why, so the redesign restyles all three and keeps them three.

**What holds through the redesign:**

- **Consistency over any locally better shape.** One mechanism, declared once as a token and
  consumed everywhere, beats a value that looks better on one page, and a real exception is ratified
  in prose where the next sweep finds it. The grammar the redesign replaces is
  [`docs/frontend/spec.md`](../frontend/spec.md) §1.16 to §1.21, over the tokens in
  `fl_frontend/src/app/globals.css`, and the checks holding it — the gap ban and the two hover bans
  in `fl_frontend/eslint.config.mjs :: SOURCE_BANS` among them — change with their rule rather than
  being deleted. **No page leads its neighbours**: a page on the new grammar beside
  pages on the old reads as a defect, so a new rule reaches every page it governs in the change that
  introduces it.
- **Every string a visitor reads or navigates by is mine.** A heading, a label, a button or a
  sentence the redesign changes is proposed to me and never shipped unasked, under
  [`docs/frontend/spec.md`](../frontend/spec.md) §1.12, where a sentence I dictated outranks the rule
  generalised from it.
- **I judge the result on the local stack.** A direction is shown to me as its current and proposed
  values side by side before I choose it, and a finished surface is served by
  `scripts/ops/local.sh` and read there — never on a dev server, which exercises neither the
  standalone build nor nginx.
- **The ratified clauses stay.** Every line of `.claude/rules/frontend.md` and of
  `.claude/CLAUDE.md` §7 is a decision rather than a cleanup target — the styling and motion clauses
  above all, which read most like leftovers — and changes only on an instruction of mine naming it.
- **No new inline `style` attribute.** Each one a server render emits is one more for `qw6j-scru`
  to remove before `style-src 'self'` can ship, and that entry's swatches and `ScrollShadow` are
  surfaces this pass restyles anyway.

**What I saw in the team area on the local stack on 2026-10-04, each the redesign's to answer:**

- **The team area reads as another site beside the admin area.** A team's landing,
  `fl_frontend/src/features/funktionen/components/views/TeamStartView.tsx`, is lines of plain text
  where the admin area sets the same kind of content in cards and tables.
- **A team's lists have no search and no filter.** The squad,
  `fl_frontend/src/features/spieler/components/collections/KaderList.tsx`, and the pending
  registrations,
  `fl_frontend/src/features/registrierungen/components/collections/RegistrierungenList.tsx`, carry
  neither, where every admin list has `fl_frontend/src/shared/components/ui/AdminCrudSearch.tsx`.
- **The team's side menu shows its season as a chip where the admin area offers a selector**:
  `fl_frontend/src/features/funktionen/components/ui/SaisonChipSlot.tsx` against
  `fl_frontend/src/features/saisons/components/ui/SaisonSelector.tsx`. My proposal is the same
  selector in both, offering a seat holder only the seasons they hold a seat in.
- **The season is a path segment in the team area and a query parameter in the admin area.** The
  path holds today for two reasons. One team can hold seats in two seasons and a seat holder sees
  only their own seat's season, so the season is part of which place an address names. And the
  team area's layout checks the seat once for every page beneath it
  (`fl_frontend/src/app/bereich/team/[team_id]/[saison_id]/layout.tsx`), which a query parameter
  cannot feed: a Next.js layout does not rerender on navigation and so cannot read search params
  (`fl_frontend/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md`).
  The redesign chooses one convention for both areas knowingly, with both reasons in front of it.
- **A lone pupil or referee record lands on a chooser of one card, where a lone team seat goes
  straight on.** `fl_frontend/src/app/bereich/(persoenlich)/page.tsx :: PersoenlichStartPage`
  skips the chooser for one team alone, because every person lands on a page named „Übersicht“ and
  only a team's own landing is one (`docs/frontend/spec.md :: I466`). I lean towards showing the
  chooser only where there are several places, which moves I466 with it; that is not yet decided.

**Undecided, and it needs a ruling before the redesign starts: whether `6m3r-xpcu`'s replacement of
the component library lands in the same pass.** Its leading candidate replaces HeroUI's styled layer
and moves the HeroUI half of `fl_frontend/src/app/globals.css` into owned component files, which is
the layer a redesign restyles, so taking the two one after the other writes that layer twice; its
closing judgement, mine over the local stack, is this entry's too. Beside it, `qstz-dwrj` stays
skipped through the redesign and the editor shell keeps the slot it would fill,
`fl_frontend/src/shared/components/ui/FieldLabel.tsx :: FieldLabel`'s `extraMarker`; and
`f3ar-m4qf`'s guided season flow copies the season editor's page pattern, so whichever of the two
lands second is built on the other's shell.

**Done when** the site stands on one new grammar recorded in
[`docs/frontend/spec.md`](../frontend/spec.md), every page on it; each finding above is merged,
deleted or ruled kept, a kept one at the line or the rule that says why; each team-area observation
is answered on the surface it names; and I have judged the whole site over the local stack.

**Not verified.** The pairs are jscpd's matches over a snapshot of this working tree taken
2026-09-23 and were not re-read against later edits; nothing above is prototyped, and none of the
sweep's findings has been seen in a browser. The team-area observations were seen there, and each
was checked against the source named beside it. The spans of every pair, the knip run and the whole of what the sweep kept
are in the body of the commit that filed this entry.

### `gzn4-secx` · A page is tested through a hand-built copy of React's server renderer, where Next recommends end-to-end tests

| Status | Depends on |
| ------ | ---------- |
| Open   | —          |

**My ruling, 2026-09-25:** "Keep until E2E" — the page harness and the tests calling it stay until
end-to-end tests replace them.

**The harness is the suite's most exposed code to an upgrade.**
`fl_frontend/src/shared/testing/pageHarness.ts` walks a page's tree as React's server renderer
would, by hand: it tells a client module by a regular expression over its source, doubles
`next/server` and the API client, and builds every read's answer out of Zod's internal schema
definitions. A React, Next or Zod release can move any of the three underneath it. Next's testing
guide, read 2026-09-25 for the release installed here and moving without us: "we recommend using
**End-to-End Testing** over **Unit Testing** for `async` components"
(https://nextjs.org/docs/app/guides/testing).

**What the harness guards today**, each of which an end-to-end case asserts before the unit case
guarding it goes:

- every admin page reads the season the header shows, awaits `connection()` before its first read,
  throws nothing but a redirect or a not-found, and sends the admin to the season list where the
  league holds none (`fl_frontend/src/app/bereich/admin/omittedSaison.test.ts`)
- a list route's loading fallback draws the search row and trigger box its page draws
  (`fl_frontend/src/features/admin/crudLoadingTriggers.test.ts`,
  `fl_frontend/src/shared/components/ui/AdminCrudView.test.ts`)
- every 404 answers the one not-found metadata — on the root boundary, on each catch-all, and
  wherever a page's generated metadata misses (`fl_frontend/src/app/notFound.test.ts`)
- a season-scoped public page's canonical names the season its address names, and the bare path
  for the running one (`fl_frontend/src/app/dashboard/seasonCanonical.test.ts`)
- which reads a page makes and in what order against `connection()`, a public page's noindex
  metadata, and its 404 for a season nobody knows
  (`fl_frontend/src/features/bewerbungen/routes.test.ts`,
  `fl_frontend/src/features/schiedsrichter/routes.test.ts`)

**Every other file calling it mixes page cases with view cases**, and
`git grep -l pageHarness -- fl_frontend` selects them. A case about what the page does — a malformed
id answered with a 404 before any read, the rows a page hands its view — moves to the end-to-end
run; a case about the view renders that view with the props the page would hand it, and needs no
harness at all. `fl_frontend/src/shared/testing/pageHarness.test.ts` tests the walk itself and goes
with it.

**Four things the adopting change meets first:**

- **No CI job serves the application.** The ops scope parses the compose files and runs nginx alone
  (`nginx/edge_test.sh`), and the images job builds both images and runs neither, so the end-to-end
  job builds, serves and seeds its own stack, and lands with its measured cost in
  `.github/gate-wall-clock.tsv`.
- **Its data is its own.** `./scripts/ops/local.sh --seed` restores a copy of production, which a CI
  runner never holds.
- **The admin pages sit behind a stored grant and a passkey**: only a session a passkey made, for
  an address holding a grant in `berechtigungen`, reaches them
  (`fl_frontend/src/core/auth.ts :: isAdminSession`), and a session a mailed code made never does.
  So the run seeds the grant and signs in with a passkey the browser under test holds, and
  `.claude/CLAUDE.md` §3 refuses a testing-only way past either in production code.
- **The `connection()` order's symptom is a failed image build**, the builder reaching no backend
  (`docs/frontend/spec.md :: I6`), and never anything a browser shows. Which run replaces the walk's
  is settled before that case goes.

**The cost is a dependency and a CI job**, adopted under `.claude/CLAUDE.md` §4's comparison rule,
whose record is the adopting commit's body: Next's guide sets up both Cypress and Playwright for
end-to-end testing, and the option needing no dependency is the harness this entry retires.

**Done when** Playwright runs the pages above against the local stack in CI, every behaviour listed
asserted there, and the harness and every page case calling it are deleted —
`git grep -l pageHarness -- fl_frontend` printing nothing.

### `h7h5-rzy4` · Every landing is an „Übersicht“ that shows what comes next, the administrator's included

| Status  | Depends on |
| ------- | ---------- |
| Skipped | —          |

**A person's and a team's landing are named „Übersicht“ and hold only a way on.** The person landing
`/bereich` lists the places a person's Funktionen lead to
(`fl_frontend/src/features/funktionen/components/views/FunktionenView.tsx`), and a team's landing names
the team and the person's seats there (`TeamStartView.tsx` beside it). Neither shows what the person
acts on next: the coming fixture, an answer awaited, a registration waiting for approval. An
administrator signs in to `/bereich` as well, „Verwaltung“ one click away; the administration's own
landing, the triage page, keeps its name and view.

Ordered on 2026-09-26: "maybe the Übersicht should be an actual overview or like a custom dashboard?
If the custom dashboard and admins also havin a Übersicht page is too much to do right now, please
file a roadmap entry and just make sure all other user types land on Übersicht".

**Done when** each Funktion's landing shows the few things that Funktion acts on next, read through
reads its own pages already make, and I have ruled whether the administrator gets an
„Übersicht“ beside the triage page or instead of it.

**The trap:** the sidemenu's Funktion switcher lists the same places as the person landing, through one
builder (`fl_frontend/src/features/funktionen/utils.ts :: funktionOrteOf` and `zeilenOf`); a dashboard
keeps that list rather than growing a second one.

### `k4wq-8mvr` · Every failure carries a closed class beside its code, and the register's kinds are held by a check

| Status | Depends on |
| ------ | ---------- |
| Open   | —          |

**A code today fuses two facts, what went wrong and what kind of thing that is, and only the first
is machine-readable.** `docs/logging/error-codes.md` fixes the grammar `<AREA>-<SUBJECT>-<NNN>`,
`scripts/checks/docs_gate/error_codes.py` holds every row to the two source trees in both
directions, and a refusal answered to a caller carries its code in the body and on its log line.
What no consumer can read is the class: whether a caller's precondition failed, an argument was
invalid, the caller was unauthenticated, nothing was found, the service was unavailable or the
server broke. The frontend therefore words every backend code by hand at three sites per refusal
(`.claude/rules/cross-surface.md`'s trap), and a code either site forgets falls through to
`fl_frontend/src/shared/utils/actionError.ts`'s shared fallback, which names no reason and sends the
admin to a retry the same rule refuses again. Mature registers carry both: Google's API error model pairs
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
registers fall back by class rather than to one fallback message, the hand-written sentences staying
for the codes that deserve one; and `docs/logging/spec.md` L2 records the envelope's new key,
which is an order change on both surfaces and lands in one commit with both suites.

**The trap:** the envelope's key order is asserted as a literal list in `fl_backend/tests/core/test_logging.py`
and `fl_frontend/src/core/logFormat.test.ts`, and `.claude/rules/cross-surface.md`'s **openapi**
clause keeps the two packages from sharing a declaration, so the class enumeration is spelled once
per surface with a comparator, the shape `scripts/checks/check_log_quoting_class.py` already takes.

### `kcbz-wwup` · The season-wide invitation send mails one team after another, so a slow provider can leave a season half-invited

| Status   | Depends on |
| -------- | ---------- |
| Standing | —          |

**The one send that mails every team does it in series**
(`fl_frontend/src/features/einladungen/actions.ts :: postEinladungVersandAction`), under the request
deadline (`fl_frontend/src/core/requestScope.ts :: REQUEST_DEADLINE_MS`). A provider slow enough to
spend that deadline cuts the rest, and the admin is told the outcome is unclear; pressing again mints
and mails a fresh link for every team without a delivery record, so a team whose cut message did
arrive gets a second one, and the first link stops opening.

**The trigger:** a season-wide send that ends unclear. **Done when** the send goes out through Resend's
batch endpoint, one call for the season, each message keeping its own delivery record and a refused
mailbox costing only itself (I69).

**The trap:** the batch endpoint's documented mode fails the whole call when one message is invalid;
the per-message mode that keeps I69 appears in Resend's official Node SDK but not in its documentation,
so its response shape is checked once against the live API before anything rests on it.

### `pb66-krbw` · A fixture carries one date, and a play window cannot be expressed

| Status  | Depends on |
| ------- | ---------- |
| Skipped | —          |

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

| Status | Depends on |
| ------ | ---------- |
| Open   | —          |

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

| Status  | Depends on |
| ------- | ---------- |
| Skipped | —          |

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

### `qw6j-scru` · `style-src 'self'` waits on two swatches, a library attribute and two library stylesheets, and its Report-Only rollout narrows `script-src-attr` and `img-src` beside it

| Status | Depends on |
| ------ | ---------- |
| Open   | —          |

**`nginx/shared/security_headers.conf` sends `style-src 'self' 'unsafe-inline'` from both edges,
and my ruling of 2026-09-07 is `style-src 'self'` with nothing put in its place** — no nonce, no
`style-src-attr`, and no component-library switch. The policy is written there once and included
wherever a block sets a header of its own, because `add_header` in a location replaces the
inherited set ([`docs/ops/spec.md`](../ops/spec.md) §1.4).

**My ruling of 2026-09-25 on `script-src`, "Keep it, narrow it":** the one enforced policy keeps
`'unsafe-inline'` there, for the reason and until the trigger
[`docs/ops/spec.md`](../ops/spec.md) §1.4 records, and the rollout this entry carries narrows the
policy around it — `script-src-attr 'none'`, and `img-src` cut to what is used.

**The population that directive governs is narrower than the application.** CSP judges a `style`
attribute in served HTML and a `<style>` element; a property written on an element's `style` object
is a CSSOM write and is governed by neither (MDN's `style-src` page, read 2026-09-07 — that source
moves without us). React emits a `style="…"` attribute only from its server renderer and applies the
same prop through the CSSOM on the client, so
`fl_frontend/src/shared/components/ui/FilterPanel.tsx`'s `--filter-*` properties,
`fl_frontend/src/core/providers/AppToaster.tsx`'s timer duration, and every overlay position
react-aria resolves are outside the policy once hydration has run.

**Inside it are two attributes this repository writes, one the library writes, and two stylesheets
libraries inject.** Both swatches render `style={{ backgroundColor: trikotFarbeHex(…) }}` —
`fl_frontend/src/features/bewerbungen/components/views/BewerbungAngabenPanel.tsx` for the wish and
`fl_frontend/src/features/teams/components/forms/TrikotFarbeSelect.tsx` for the assignment — and
`fl_frontend/src/features/teams/constants.ts :: TRIKOT_FARBE_OPTIONS` closes the colour set with its
hex, so a class per colour or a data attribute the stylesheet keys on carries the fill with no
attribute at all. The library's attribute is `--scroll-shadow-size`, which `@heroui/react`'s
`ScrollShadow` sets through a style prop.

**`ScrollShadow` is reached two ways, and the second is why the prerender's count understates the
work.** `fl_frontend/src/shared/components/ui/FilterLeiste.tsx` renders it directly, and HeroUI's
`Tabs` renders one internally, which puts it under
`fl_frontend/src/features/spieltage/components/views/SpielplanView.tsx` and
`fl_frontend/src/features/admin/components/views/AdminSpieleActionRequiredView.tsx` besides. A
2026-09-07 build's forty prerendered pages carried exactly one inline style attribute outside
`_global-error`, on a page rendering `Tabs` — but a prerender is not the population: every page
that streams one of those four components server-renders the attribute too, and a `"use client"`
directive does not keep a component off the server render. So this is a restyle of one component
rather than of one page, and the count to trust is the source's rather than the build's.

**react-aria's `usePress` stylesheet is not a residue: refusing it is the touch regression of
2026-08-31.** `usePress` prepends `<style id="react-aria-pressable-style">`, giving every element
carrying `data-react-aria-pressable` `touch-action: pan-x pan-y pinch-zoom`, and stamps a nonce on
it only where the document offers one (the installed `react-aria`'s
`dist/private/interactions/usePress.mjs`, read 2026-09-25 and moving without us). Under
`style-src 'self'` the element stays in the DOM with no sheet, nothing renders differently and
nothing goes red, while on a touch device every pressable falls back to `touch-action: auto` —
nineteen elements on the home page, measured on the local stack 2026-08-31. A hash of the rule is
invalidated by the library's next release and `style-src-attr` cannot reach an element, so neither
repairs it; how the rule reaches every pressable once the element is refused is what the fix answers
before `style-src 'self'` is served at all.

**`input-otp`'s stylesheet is the second, and refusing it shows the code field's own input.**
`@heroui/react`'s `InputOTP`, which `fl_frontend/src/features/auth/components/forms/CodeStep.tsx`
renders, sits on `input-otp` 1.5.0, which creates a `<style>` element and fills it through
`insertRule`, reading a nonce only where one is passed in (the installed `input-otp`'s
`dist/index.mjs`, read 2026-09-26). Its rules make the real input's text and selection transparent
under the six slots, so refused, the typed digits show a second time behind them, and nothing goes
red.

**Two residues stay, and each is accepted rather than covered.** Next's own `_global-error` carries
both an attribute and a `<style>` element, and renders unstyled under the strict policy — on a page
that is already the failure of everything above it. react-aria's `usePreventScroll` prepends a
`<style>` element carrying `overscroll-behavior: contain` behind a modal on iOS, which the policy
refuses while the `touchmove` guard beside it still runs; `style-src-elem` and `style-src-attr` are
the directives that would speak to that element alone, and neither is in the ruling.

**`script-src-attr 'none'` refuses the payload an injection keeps.** An `innerHTML` write runs no
`<script>` it inserts but does run an `onerror=` attribute (MDN's `innerHTML` page, read 2026-09-25,
moving without us), and on a page holding a token that handler is what would read it. The
directive refuses every inline event handler and leaves inline `<script>` elements, Next's
hydration scripts among them, to `script-src`. React attaches its handlers as listeners and renders
none as an attribute; what the week of reports watches for is markup Cloudflare injects, which no
file here shows.

**`img-src 'self' data: https:` is the policy's widest exfiltration channel, and nothing here uses
two of its three sources.** A source search on 2026-09-25 finds no `<img>` and no `next/image` in
`fl_frontend/src`, HeroUI's `Avatar` rendering its fallback alone, and no `data:` image in this
repository's stylesheets or HeroUI's; an image request is how an injected payload carries a token
off a page. The Report-Only header therefore carries `img-src 'self'`, and the reports say whether
anything the search cannot see needs `data:` back.

**A component-library switch was studied for this and declined.** Every candidate positions its
overlays by writing to an element's `style` object — Floating UI under Base UI, Radix and Mantine,
Zag's positioner under Ark and Chakra, react-aria's own `useOverlayPosition` under HeroUI — so the
route CSP does not govern is the route all of them take, while what a strict policy refuses is two
attributes written here and one library attribute a restyle removes anyway. A switch moves none of
the three attributes, and one candidate moves the policy backwards. `6m3r-xpcu` holds the switch on its own
criteria, and the one CSP fact it carries is Mantine's, stated there. (Read 2026-09-07 from MDN,
from react-dom's `setValueForStyle` and from each project's own documentation; all of that moves
without us.)

**Done when** the swatches and the `ScrollShadow` attribute are gone, the `usePress` rule reaches
every pressable element with the injected element refused, and `input-otp`'s rules hide the code
field's own input with its injected element refused; a `Content-Security-Policy-Report-Only`
header carrying `style-src 'self'`, `script-src-attr 'none'` and `img-src 'self'` has been served
from `nginx/shared/security_headers.conf` beside the enforcing header, its `report-to` and its
`report-uri` both naming an ingest route of this application that writes each violation report as
one line under the envelope; and each directive has moved into the enforcing policy after its own
week of reports, read, with the edge's header check green on every location.

**The Report-Only phase is the rollout a tightened policy gets everywhere, and my ruling of
2026-09-07 clears its two obstacles here.**
[`.claude/rules/cross-surface.md`](../../.claude/rules/cross-surface.md)'s `csp` clause forbids a
second _enforcing_ policy, so a Report-Only header may stand beside the one that enforces; and
`nginx/edge_test.sh` reads its `:: SECURITY_HEADERS` off `nginx/shared/security_headers.conf`,
name and value, so the Report-Only header is written into that file in the commit that serves it,
or no location is held to sending it. The ingest route takes the shape of
`fl_frontend/src/app/api/client-error/route.ts`: public and unauthenticated, since a browser posts a
report with no session, and metered at the edge by an exact-match location of its own, which
`scripts/checks/check_public_routes.py` fails until that location exists. **`report-uri` stands
beside `report-to`** because Firefox reads `report-to` only from release 149 (MDN's
browser-compat-data, read 2026-09-25, moving without us), and `fl_frontend/package.json`'s
`browserslist` reaches further back than that.

**What the change makes untrue.** [`docs/ops/spec.md`](../ops/spec.md) §1.4 states that several
components set a runtime-computed inline `style` attribute, and offers the `style-src-attr` pair as
the narrowing with `_global-error` as its whole cost. The same section states that the policy is
written once, which the Report-Only phase makes two policies in one file, and names what the rest of
the policy blocks, which each directive reaching enforcement widens. The policy row, those
paragraphs and that sentence move in the same commit (CUR-2), the code being the higher source
(PRE-1).

**Not verified.** No Report-Only header has been served and no page opened in a browser, so nothing
here establishes that an SSR'd attribute the parser refused stays unapplied after hydration, that
every overlay still positions under the strict policy, or that nothing sets an inline handler or
loads a `data:` image at runtime; the first two are read off the react-dom and react-aria sources,
the `usePress` element off the installed module. The four `ScrollShadow` call sites and the image
consumers are a source search rather than a measurement of what each page actually streams.

### `scfh-f6gw` · Every privacy decision the sign-up programme took is reviewed once, and a German brief puts the open questions to a Datenschutzexperte

| Status | Depends on |
| ------ | ---------- |
| Open   | —          |

**My item, 2026-09-24**, in my words: "a quick roadmap entry to go over all datenschutz related
decisions again and compile a nice and comprehensive brief for a datenschutzexperte in german. But
that should run after this whole programme is done so it stays a roadmap entry". The programme is
the one building the pupil sign-up and the admin panels, and this runs after its last session and
never inside it: a decision a later session of it takes would otherwise be missing from the review.

**One review of every privacy decision, then one brief.** The review reads each ruling
[`docs/datenschutz.md`](../datenschutz.md) records against the tree as it then stands, and against
the published notice, `fl_frontend/src/features/meta/components/views/DatenschutzView.tsx`, so the
brief quotes what ships rather than what a ruling once said. The brief is written in German for a
Datenschutzexperte, and for each open question it states what ships today and what each possible
answer would change on the site, in the notice and in the stored data.

**The questions are every entry
[`docs/datenschutz.md` §11](../datenschutz.md#11-open-and-owed-a-decision) lists as open when the
review runs, and those my checklist of 2026-09-24 named**, which the brief covers whether or not §11
still carries them:

- a pupil's own consent at sixteen and seventeen, with no guardian asked;
- the media consent narrowed to images in which the person can be identified;
- a referee's record, which carries no end date;
- the basis of a referee's fee, and whether the word „Honorar“ fits it;
- Cloudflare's challenge on `/bewerbung/*`, set without consent, against § 25 TDDDG;
- the refusals the code takes alone, against Art. 22;
- how the refusal of an address that is not plain ASCII is classified;
- Art. 14 (5) (b) for the referees standing today;
- joint control over the Instagram account, and which Meta company provides Instagram in the EU;
- the board's full names in the Impressum, under § 18 MStV and § 5 DDG;
- the ban list's key, which cannot be rotated without losing every ban it keys;
- the date WhatsApp Ireland's privacy policy was last read for
  [section 7](../datenschutz.md#7-processors-and-third-parties);
- whether pupils whose records were erased are owed a message saying so;
- how long an erased person's consent acts may stand as proof, EDPB Guidelines 05/2020 paragraph
  107's question of legal claims;
- MongoDB's support access to the hosted database, and which Google company provides Gmail in the
  EEA;
- the pending appeal in Latombe (C-703/25 P) and what it would mean for the transfers section 7
  names.

**Done when** the brief exists and each of its questions carries the Datenschutzexperte's answer or
a ruling of mine.

### `u6v9-zgt3` · Of two administrators editing one record, the later save wins and neither is told

| Status | Depends on |
| ------ | ---------- |
| Open   | —          |

**Every admin editor but the contacts editor saves its whole field set over whatever the record
holds now.** Its PATCH sets the payload wholesale, and nothing compares what the editor was served
with what the row holds when the save lands: of two administrators with one record open, the earlier
save is lost and the later one reports success. The population is every `@router.patch` in
`fl_backend/app/api/*/admin_router.py`, no admin router declaring a PUT:

| Endpoint                                                                    | Editor                                                                                                                                 | Guarded against a stale copy today                        |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `fl_backend/app/api/spielorte/admin_router.py :: patch_spielort`            | `fl_frontend/src/features/spielorte/components/forms/AdminSpielortEditForm/AdminSpielortEditForm.tsx`                                  | Nothing                                                   |
| `fl_backend/app/api/teams/admin_router.py :: patch_team`                    | `fl_frontend/src/features/teams/components/forms/AdminTeamEditForm/AdminTeamEditForm.tsx`                                              | Nothing                                                   |
| `fl_backend/app/api/teams/admin_router.py :: patch_saison_team`             | The same form, the club's season row                                                                                                   | Nothing                                                   |
| `fl_backend/app/api/teams/admin_router.py :: patch_saison_team_kontakte`    | `fl_frontend/src/features/kontakte/components/forms/AdminKontakteEditForm/AdminKontakteEditForm.tsx`                                   | `kontakte_stand`, refused `REQ-KONTAKT-001`               |
| `fl_backend/app/api/saisons/admin_router.py :: patch_saison`                | `fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm.tsx`                                        | Nothing                                                   |
| `fl_backend/app/api/schiedsrichter/admin_router.py :: patch_schiedsrichter` | `fl_frontend/src/features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm.tsx`                 | Nothing; the address is judged against the row, below     |
| `fl_backend/app/api/spieler/admin_router.py :: patch_spieler`               | `fl_frontend/src/features/spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm.tsx`                                      | Nothing                                                   |
| `fl_backend/app/api/spieler/admin_router.py :: patch_saison_spieler`        | The same form, the player's squad row                                                                                                  | Nothing                                                   |
| `fl_backend/app/api/spieltage/admin_router.py :: patch_spieltag`            | `fl_frontend/src/features/spieltage/components/forms/AdminSpieltagEditForm/AdminSpieltagEditForm.tsx`                                  | Nothing                                                   |
| `fl_backend/app/api/spiele/admin_router.py :: patch_spiel_data`             | `fl_frontend/src/features/spiele/components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm.tsx`, its save and its dry-run preview | Nothing                                                   |
| `fl_backend/app/api/spiele/admin_router.py :: patch_spiele_paarungen`       | That editor's undo, `fl_frontend/src/app/api/admin/spiele/undo/route.ts`                                                               | Fields beyond the Paarung merged; the Paarung overwritten |
| `fl_backend/app/api/berechtigungen/admin_router.py :: patch_berechtigung`   | `fl_frontend/src/features/berechtigungen/components/forms/AdminBerechtigungStufePanel.tsx`                                             | Outside the population, below                             |

**The referee's address is judged against the stored record, which is no guard against a stale
copy.** A confirmed referee's typed address becomes a pending change their new mailbox confirms, and
an unconfirmed referee's corrected address retires their link and mints another, each behind the
step-up confirmation (`fl_backend/app/api/schiedsrichter/services.py :: compose_korrektur_update`).
Both compare the payload with the row, so an editor still showing an address a rival has since
corrected reads as a change back to it — a link minted to that mailbox again, or a pending change
opened for it — and every other field of that save lands whole.

**Every editor's undo is a second stale write.** Each undo under `fl_frontend/src/app/api/admin/`
replays the save's earlier image through a PATCH, so an undo pressed after a rival's save
reverts the rival's too. The contacts undo sends the token of the image its save left and is refused
where a rival has moved the block since (`fl_frontend/src/app/api/admin/kontakte/undo/route.ts`).
The fixture undo reads every field its save left standing off the document
(`fl_backend/app/api/spiele/schemas.py :: FLPatchSpielPaarungPayload`), and still writes the
Paarung back, so a result a rival entered on one of its fixtures meanwhile is reverted.

**The tier change is outside the population.** `verwaltung` holds one of two values, the panel
offers only the one the row does not show, and naming the tier a grant already holds writes nothing,
so a stale page can repeat a change and never revert one.

**Two stands already refuse a stale copy, and both answer 409.** The contacts save carries
`fl_backend/app/api/teams/schemas.py :: kontakte_stand_of`, a digest of the block derived on every
read and stored nowhere, and judges it inside the save's transaction
(`fl_backend/app/api/teams/services.py :: find_kontakte_precondition_refusal`). A person's consent
press on their account page carries `nachweis_stand`, refused `REQ-EINWILLIGUNG-003` under one code
across every consent PATCH (`fl_backend/app/api/konto/services.py :: find_nachweis_stand_refusal`).
Those presses are a person's own and not an editor of this entry's.

**The standard is the conditional write, and these sources state it, each read on 2026-10-06 and
each moving without us:**

- RFC 9110, https://www.rfc-editor.org/rfc/rfc9110.html — §13.1.1 puts `If-Match` on state-changing
  methods "to prevent the 'lost update' problem", and §15.5.13 answers 412 Precondition Failed where a
  condition in the request header fields is false.
- RFC 6585 §3, https://www.rfc-editor.org/rfc/rfc6585.html — 428 Precondition Required, whose
  "typical use is to avoid the 'lost update' problem".
- MDN, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-Match — `If-Match`
  checks that an upload "will not override another change", answering 412 where it does not match.
- MongoDB, "Atomicity and Transactions",
  https://www.mongodb.com/docs/manual/core/write-operations-atomicity/ — "include the expected current
  value in the update filter".

Ordered on 2026-10-06; the design below is the one I was shown.

**Done when** every editor in the table but the tier change is served a stand on its read, sends it
back on its save, on its undo and on the fixture editor's preview, and is refused where the record
has moved, judged inside the save's transaction; each editor words that refusal as someone else
having changed this record since it was opened, to be reloaded, and keeps the typed input on screen;
and one digest and one comparison serve them all, the contacts editor's included.

**What the design holds, each a constraint on whoever builds it:**

- **A stand digests exactly the fields its payload carries, in the payload's own shape, and is
  stored nowhere**, as `kontakte_stand_of` is. A version stored on the record has to be moved by
  every writer of it and costs a migration; a digest of the whole document lets a fan-out — a club,
  venue or referee rename writing its name into season rows and fixtures — refuse an editor whose
  payload never carries that name. So the season row keeps two stands, its own save's and the
  contacts save's.
- **The comparison reads the record in the save's own session.** Read outside it, a rival committing
  between the judgement and the write lands unrefused; read inside it, the rival conflicts on the
  document and `with_transaction`'s retry judges again on what the winner left, as
  `patch_saison_team_kontakte` does. A derived digest cannot sit in MongoDB's update filter, so this
  read is what stands in for it; `patch_spielort`, `patch_team` and `patch_spieler` read nothing in
  the session today.
- **The stand travels in the read's body whatever carries it back.** An editor is drawn from a read
  that is not the resource its save names — the contacts editor from the club's memberships read
  (`fl_frontend/src/app/bereich/admin/teams/[team_id]/page.tsx`) — so a response `ETag` could carry
  no stand per row.
- **An undo replays with the stand of the image its save left**, as the contacts undo does, so an
  undo after a rival's save is refused rather than reverting it.

**Open, each settled by the building session and put to me:**

- **The carrier and the status are one choice.** A body field is this repository's precedent, and a
  precondition in the body is a 409, RFC 9110 defining 412 for conditions in the header fields. The
  `If-Match` header is HTTP's own carrier, answering 412, and 428 where a save omits it; a body field
  is required with no default and its omission is the payload's 422, as `kontakte_stand`'s is.
- **The refusal code's family**: one code across every editor, as `REQ-EINWILLIGUNG-003` spans the
  consent presses, or one per area as `REQ-KONTAKT-001` is — and, with one shared code, whether
  `REQ-KONTAKT-001` retires into it. Whichever it is, each is a rule
  `fl_backend/app/core/domain.py :: RULES` declares, as both stands' codes are.
- **Whether a seat holder's squad edit takes the stand.**
  `fl_backend/app/api/spieler/person_router.py :: patch_kader_zeile` rewrites `nummer`, `position`,
  `stufe` and `rolle` on the row `patch_saison_spieler` writes, so the admin save's stand refuses a copy a seat holder has moved,
  while the seat holder's own save still overwrites an administrator's.

**Cost, estimated and not measured:** one programme session with a backend lane and a frontend lane.
Per endpoint, a computed field on the read model, a payload field, the in-session comparison, and
tests for the refusal and for a rival committing mid-save; per editor, the schema field, the refusal
sentence, and the stand on its undo. The fixture editor costs most, its save, preview and undo
sharing one endpoint. Nothing on this page waits on this entry.

### `v9tn-3hce` · The log answers what broke and hardly what happened

| Status | Depends on |
| ------ | ---------- |
| Open   | —          |

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
