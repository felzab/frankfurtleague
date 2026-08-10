# The domain model

**Verified against:** `75826c9`, 2026-08-10

**What the league's data is, what depends on what, when each thing may be edited, and what a write has to do
about its neighbours.**

**The authority is `fl_backend/app/core/domain.py`, not this page.** That module states the model as data —
the aggregates, the references, the field policies, the refusal rules and the deliberate absences — and
`fl_backend/tests/core/test_domain.py` resolves every symbol it names against the code on every test run.
This page is the reader's path through those tables: the shape, the readings that catch people out, and what
a table cannot carry. It does not repeat what a table already says, because the copy would be the half
nothing checks.

**Nothing here runs.** Each rule is enforced at the endpoint that owns the write, by a pure function, and
that is deliberate rather than incidental
([ADR-0053](_decisions/0053-the-domain-model-is-declared-and-conformance-checked.md)).

**If you read one section, read [Aggregates](#aggregates).** Several of the boundaries are counter-intuitive
and every one of those mistakes is expensive.

| Section                                                                       | Answers                                                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [The facts that shape everything else](#the-facts-that-shape-everything-else) | What to hold in your head before anything else here makes sense        |
| [Aggregates](#aggregates)                                                     | Which collections are held true together, and which only point         |
| [What depends on what](#what-depends-on-what)                                 | What a rename reaches, what a retirement leaves alone                  |
| [When a field may be edited](#when-a-field-may-be-edited)                     | Which fields freeze, which narrow, which are on no payload at all      |
| [What a write must do](#what-a-write-must-do)                                 | The refusals, the order they run in, and what they hand back           |
| [What is deliberately not enforced](#what-is-deliberately-not-enforced)       | The states the system permits, and where each is reported              |
| [Where each layer enforces what](#where-each-layer-enforces-what)             | Why a rule lives in the validator, the model, the endpoint or the page |
| [Keeping this true](#keeping-this-true)                                       | What a change to the model obliges you to change with it               |

---

## The facts that shape everything else

| Fact                                                         | Consequence                                                                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| A `Team` and a `Spieler` document are **season-independent** | Everything season-scoped about a club or a squad lives on the `saison_teams` and `saison_spieler` junctions |
| A season's `rules` **decide the shape of the competition**   | Narrowing one below what already exists strands data, and is refused                                        |
| A **match write is a season write**                          | Entering a result resolves the whole bracket in the same transaction                                        |
| Retirement is **a date, never a delete**                     | `inactive_since` is a date string; nothing in this system hard-deletes a row                                |

The German vocabulary is load-bearing and is defined in [`glossary.md`](glossary.md). Read that first if
`Spieltag`, `Spiel` and `Saison` are not yet distinct in your head.

---

## Aggregates

An **aggregate** is a consistency boundary: a root collection plus the collections whose invariants are
checked against that root. Membership turns on one question — _does a rule hold this collection and the root
true together?_ — and **not** on whether one document points at another. `domain.py :: AGGREGATES` is the
list, each entry stating the invariant that binds it.

### The ones that surprise everybody

**`spiele` is one aggregate per SEASON, not per match.** Entering a result resolves the season's bracket in
the same transaction and rewrites fixtures the request never named
([ADR-0034](_decisions/0034-a-result-entry-resolves-the-whole-bracket.md)). So the consistency boundary of a
match write is _every fixture in that season_: `PATCH /spiele/{spiel_id}` looks like a single-document write
and is not one. Every rule on this aggregate needs more than the fixture the request names — the matchday it
sits in, the other fixtures sharing its venue, or the season's whole bracket.

**`teams` is NOT inside `Saison`.** A club exists independently of any season, and what belongs to a season
is the junction row. The practical test: a club's name, address and website are on `teams`; its group and
its disqualification are on `saison_teams`; its league table is on neither, because it is derived from the
matches ([ADR-0019](_decisions/0019-team-statistics-are-derived-from-spiele.md)).

**`spieltage` is its own aggregate even though `spiele` points at it.** Nothing holds a matchday and its
fixtures true together: the matchday's position and its expected match count are each derived from elsewhere
(ADR-0051, [ADR-0052](_decisions/0052-a-seasons-schedule-is-derived-from-its-rules.md)), and retiring one
leaves its matches untouched. A reference is not a boundary.

---

## What depends on what

`domain.py :: REFERENCES` carries every cross-collection reference, with a **referential action** for a
target that changes, one for a target that goes away, and the reason for each. The vocabulary is SQL's,
because it is precise and because **MongoDB enforces none of it** — naming the intended behaviour is the
only way the intention is written down at all.

### The fan-outs, and what they deliberately leave alone

A match embeds a **display copy** of its team, venue and referee beside the id, so a card renders without a
join. Renaming the target therefore has to reach every match that embeds it, and each write path does
exactly that. What none of them touches is the point:

- a venue's **`mietpreis`** and a referee's **`payment`** do not fan out. They record what _this fixture_
  cost, so rewriting them would rewrite history
  ([ADR-0021](_decisions/0021-store-what-was-true-then-derive-what-is-true-now.md), rule 2).
- a **disqualification** is not embedded at all. It is joined from the junction on every read, so entering
  one reaches every surface at once instead of needing a fan-out.

### Retirement never cascades

Retiring a club, a person, a squad row or a matchday touches nothing that points at it. A played fixture's
embedded team name is what that fixture said at the time; a squad row for a retired club still resolves and
the admin list renders it.

Retirement is _refused_ only where it would take something live down with it — a club still entered in a
running or planned season, a matchday whose result the retirement would unpublish, a venue or a referee an
unplayed fixture still needs. The `REQ-RETIRE-*` rows of `domain.py :: RULES` are every retirement refusal
there is.

### There is no delete

No endpoint removes a `saisons`, `saison_teams` or `spiele` document, and each absence is its own decision
rather than one oversight: removing a season orphans every `saison_id` in the database and a team leaves a
season only by disqualification ([ADR-0026](_decisions/0026-one-active-season-and-one-path-to-it.md)), while
a season's fixtures are created once, then cancelled or moved
([ADR-0037](_decisions/0037-a-seasons-fixtures-are-created-once.md)).

---

## When a field may be edited

`domain.py :: FIELD_POLICIES` answers this per field, for every field whose answer is not plainly "whenever
you like", and `domain.py :: Editability` defines the values it answers with.

**`COMPOSED` versus `DERIVED` is not a hair-split.** `spiele.ergebnis` is never accepted from a client and
_is_ stored, composed server-side so the string cannot disagree with the goals it formats.
`spieltage.anzahl_spiele` is on no document at all.
`fl_backend/tests/core/test_domain.py :: test_a_derived_field_is_on_no_document` asserts the difference
against the `$jsonSchema` validators, so the labels mean something rather than reading as synonyms.

### A season's rules are the interesting case

The fields of `rules` do not behave alike, and `FIELD_POLICIES` says which behaves how. Some freeze once the
season is `past`, because the league table is scored from them on every read and nothing records what it
said before. Some may never narrow below what already exists, because the data below would be stranded.
`erlaubte_stufen` narrows freely even on a finished season, because it bounds what a **form offers** rather
than what a stored squad row holds ([ADR-0048](_decisions/0048-position-and-stufe-are-closed-sets.md)).

**The freeze compares values, not the endpoint.** A date-only edit resubmits the whole `rules` object
unchanged and passes, which is precisely what keeps the dates repairable. The season's `start_date` and
`end_date` sit on the season document rather than inside `rules`, and stay editable on a finished season —
correcting a mistyped date changes nothing anybody competed for — provided the new span still covers every
live matchday (`REQ-DATE-004`).

---

## What a write must do

`domain.py :: RULES` lists every refusal a write path performs, with its code, the operations that perform
it, the symbol that implements it and the test that covers it. What the table cannot show is what those
symbols have in common:

- each is a **pure function** — no I/O, so every one of them is tested without a database, in the default
  tier
- each is called by **the endpoint that owns the write**, never by a shared evaluator
- each refusal reaches the client as a **code** it maps to German, with an English `detail` that goes only
  to the log ([`logging/error-codes.md`](logging/error-codes.md))

**A rule's return type is not uniform, so read the signature before assuming one.** Most hand back
`(error_code, detail)` or `None`; some return a `WriteRefusal`; some return the detail alone, with the code
supplied at the call site; and `judge_spieltag_occupancy` returns a `SpieltagVerdict` that carries a refusal
beside the moves it plans. A uniform `is_valid(operation) -> bool` cannot express that last outcome, which is
why there is no central evaluator (ADR-0053).

**`RULES` is not the whole list of what a match write does.** The bracket resolution backs no row in it and
**rewrites** fixtures the request never named (ADR-0034).

### The checks run in the order somebody can act on

Within a rules edit the freeze is reported first, and the check that has to compute the season's whole
schedule runs last; `fl_backend/app/api/saisons/services.py :: find_rules_refusal` carries the sequence and
the reason for each position at the line. The order is behaviour rather than an accident, and
`fl_backend/tests/api/test_rules_refusal.py :: test_the_freeze_is_reported_before_a_narrowing` pins it:
telling an admin their group count strands a team, watching them fix it, and _then_ saying the season is
closed anyway is a puzzle rather than an answer.

---

## What is deliberately not enforced

**An absence looks identical to an omission**, so `domain.py :: UNENFORCED` names each permitted state with
its reason and, where there is one, the surface that reports it instead. What selects the set is a single
test: refusing would block a legitimate act rather than a mistake — a season being set up passes through
several of these states on its way to being complete.

Where a state is reported, the report is a page and never a stored flag: no bracket fault is stored
([ADR-0039](_decisions/0039-a-bracket-fault-is-derived-on-demand.md)), and the mismatch between a matchday's
fixtures and the count its phase implies is computed on the admin read (ADR-0052). Where an entry names no
surface, nothing reports the state.

---

## Where each layer enforces what

The division is deliberate:

| Layer                          | Enforces                                                    | Why not elsewhere                                                        |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| **`$jsonSchema` validators**   | BSON types, required keys, closed enums                     | Only these fail _silently_; a bad range fails Pydantic on the next read  |
| **Pydantic models**            | Ranges, patterns, lengths, cross-field shape                | A validator cannot express them, and a wrong value is loud               |
| **`find_*_refusal` functions** | Everything spanning more than one document                  | No validator sees more than one document                                 |
| **The admin pages**            | Offering only legal choices, and reporting permitted states | A page may never be the only enforcement — a direct API call bypasses it |

The boundary between the validators and the models is
[ADR-0020](_decisions/0020-the-database-enforces-its-own-invariants.md) and is itself tested:
`fl_backend/tests/core/test_constraints.py :: test_no_validator_constrains_a_range_or_a_format` fails a
validator that reaches past it, so widening the line is a decision rather than an improvement somebody slips
in.

**The pages narrow the offer; they never replace the refusal.** The season editor disables a narrowing it can
see is illegal, and `find_rules_refusal` still runs — because a stale form and a direct request each reach
the endpoint.

---

## Keeping this true

| If you                                   | You must also                                                        | Caught by                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Add a `REQ-*` refusal under `app/api/`   | Add its row to `RULES`, with a real `implemented_by` and `tested_by` | `test_domain.py`                                                                           |
| Add a collection                         | Place it in exactly one aggregate                                    | `test_domain.py`                                                                           |
| Rename a refusal or a test class         | Repoint the citation that names it                                   | `test_domain.py`                                                                           |
| Add a field that is not plainly editable | Add its `FieldPolicy`                                                | Nothing — the test resolves the policies that are declared and cannot see one nobody wrote |
| Decide _not_ to enforce something        | Add it to `UNENFORCED` with the reason                               | Nothing, for the same reason                                                               |

`fl_backend/tests/core/test_domain.py` runs in the default tier, so the rows it covers hold without anybody
remembering. It also enforces the invariant that keeps this a declaration — **no module under `app/` may
import `domain.py`** — because the moment production code reads these tables they stop being a declaration
and become an engine a write can forget to consult.

---

## See also

- **[`_decisions/0053`](_decisions/0053-the-domain-model-is-declared-and-conformance-checked.md)** — why this
  is a declaration and not a runtime rules engine, and what that rejected
- **[`_decisions/0052`](_decisions/0052-a-seasons-schedule-is-derived-from-its-rules.md)** — the season
  schedule, the rules refusals and the phase set
- **[`backend/spec.md`](backend/spec.md)** — the endpoint inventory and the backend's own invariants
- **[`glossary.md`](glossary.md)** — the German vocabulary, which is not optional
- **[`logging/error-codes.md`](logging/error-codes.md)** — how an error code reaches a log line and a German message
