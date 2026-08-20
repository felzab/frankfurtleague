# The domain model

**Verified against:** `c90a98dc`, 2026-08-20

**What the league's data is, what depends on what, when each thing may be edited, and what a write has to do
about its neighbours.**

**The authority is `fl_backend/app/core/domain.py`, not this page.** It states the model as data — the
aggregates, the references, the field policies, the refusal rules and the deliberate absences — and
`fl_backend/tests/core/test_domain.py` checks it against the code on every test run. Where a declaration
names a symbol the test resolves it, and where a declaration makes a claim about that symbol the test holds
the claim rather than the address — [Keeping this true](#keeping-this-true) is which is which. This page
carries only what a table cannot: the readings that catch people out.

**If you read one section, read [Aggregates](#aggregates).** Several of those boundaries are
counter-intuitive and every one of the mistakes is expensive.

| Section                                                                       | Answers                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [The facts that shape everything else](#the-facts-that-shape-everything-else) | What to hold in your head before the rest makes sense        |
| [Aggregates](#aggregates)                                                     | Which collections are held true together, and which point    |
| [What depends on what](#what-depends-on-what)                                 | What a rename reaches, what a retirement leaves alone        |
| [When a field may be edited](#when-a-field-may-be-edited)                     | Which fields freeze, which narrow, which are on no payload   |
| [What a write must do](#what-a-write-must-do)                                 | The refusals, their order, and what they hand back           |
| [What is deliberately not enforced](#what-is-deliberately-not-enforced)       | The states the system permits, and where each is reported    |
| [Where each layer enforces what](#where-each-layer-enforces-what)             | Why a rule lives in the validator, the model or the endpoint |
| [Keeping this true](#keeping-this-true)                                       | What a change to the model obliges you to change with it     |

---

## The facts that shape everything else

| Fact                                                         | Consequence                                                                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| A `Team` and a `Spieler` document are **season-independent** | Everything season-scoped about a club or a squad lives on the `saison_teams` and `saison_spieler` junctions |
| A season's `rules` **decide the shape of the competition**   | Narrowing one below what already exists strands data, and is refused                                        |
| A **match write is a season write**                          | Entering a result resolves the whole bracket in the same transaction                                        |
| Retirement is **a date, never a delete**                     | `inactive_since` is a date string; nothing in this system hard-deletes a row                                |

The German vocabulary is load-bearing and is defined in [`glossary.md`](glossary.md).

---

## Aggregates

An **aggregate** is a consistency boundary: a root collection plus the collections whose invariants are
checked against that root. Membership turns on one question — _does a rule hold this collection and the root
true together?_ — and **not** on whether one document points at another. `domain.py :: AGGREGATES` is the
list, each entry stating the invariant that binds it.

**`spiele` is one aggregate per SEASON, not per match.** Entering a result resolves the season's bracket in
the same transaction and rewrites fixtures the request never named, so the boundary of a match write is
_every fixture in that season_ — `PATCH /spiele/{spiel_id}` looks like a single-document write and is not
one.

**`teams` is NOT inside `Saison`.** The practical test: a club's name, address and website are on `teams`;
its group and its disqualification are on `saison_teams`; its league table is on neither, being derived from
the matches.

**`spieltage` is its own aggregate even though `spiele` points at it.** Its position and its expected match
count are each derived from elsewhere, and retiring one leaves its matches untouched. A reference is not a
boundary.

**`aktionen` is in a boundary with nothing, and that is the decision rather than an oversight.** It is its own
aggregate in `domain.py :: AGGREGATES` with no members, because no invariant holds a log row and any other
document true together: what binds a row to the write it records is the **transaction they share**, not a
reference. It carries no reference out and nothing points at it, so `domain.py :: REFERENCES` holds no row for it
in either direction — `aktionen.document_id` is a copy of the id a write touched rather than a pointer this system
resolves, and the document it names may be edited or retired afterwards with nothing rewriting the row to match.

---

## What depends on what

`domain.py :: REFERENCES` carries every cross-collection reference with the **referential actions** it is held
to, and the reason for each. The vocabulary is SQL's because **MongoDB enforces none of it** — naming the
intended behaviour is the only way the intention is written down at all.

**The constraint and the triggered actions are separate columns**, because SQL packs into one `FOREIGN KEY`
what has to be written down separately here. `Reference.on_reference_created` is the constraint — whether the
write refuses a target it cannot resolve — and `on_target_change` and `on_target_removed` are the actions
riding on it. Model only the triggered actions and there is no slot for the constraint itself, which is how
half a referential check gets written and the other half never noticed.

**A `NO_ACTION` on the creating direction is a statement that nothing looks at the target**, and it covers
situations the notes keep apart. **Nothing reads the target at all**: a `saison_teams` row may name a club
`teams` does not hold and a `saison_spieler` row a person `spieler` does not, the path parameter naming each
and no handler resolving it. **Nothing can create the reference**: `spiele.spieltag_id` is on no payload and
`/spiele` has no POST. **Or something is checked and it is not the target** — a fixture's side and a squad row
are both held to the season's `saison_teams` entrants rather than to `teams`, and since entry into that
junction is itself unchecked the entrants are not a subset, so either can carry a `team_id` no club document
holds.

That last case is the one most easily misread as a constraint, and it is why those rows carry `NO_ACTION`
with the check they _do_ perform named in the note. A `RESTRICT` there would say the write resolves the club,
which nothing does.

**`aktionen` appears in `REFERENCES` in neither direction, on purpose** — its `document_id` is a copy of an id
rather than a reference anything maintains, and [Aggregates](#aggregates) carries the reading.

### The fan-outs, and what they deliberately leave alone

A match embeds a **display copy** of its team, venue and referee beside the id, so a card renders without a
join, and each write path fans a rename out into every match that embeds it. What none of them touches is the
point:

- a venue's **`mietpreis`** and a referee's **`payment`** do not fan out. They record what _this fixture_
  cost, so rewriting them would rewrite history.
- a **disqualification** is not embedded at all. It is joined from the junction on every read, so entering
  one reaches every surface at once instead of needing a fan-out.

### Retirement never cascades

Retiring a club, a person, a squad row or a matchday touches nothing that points at it: a played fixture's
embedded team name is what that fixture said at the time. Retirement is _refused_ only where it would take
something live down with it, and the `REQ-RETIRE-*` rows of `domain.py :: RULES` are every such refusal there
is.

### There is no delete

No endpoint removes a `saisons`, `saison_teams` or `spiele` document, and each absence is its own decision:
removing a season orphans every `saison_id` in the database, a team leaves a season only by disqualification,
and a season's fixtures are created once, then cancelled or moved.

---

## When a field may be edited

`domain.py :: FIELD_POLICIES` answers this per field, wherever the answer is not plainly "whenever you like";
`domain.py :: Editability` defines the values it answers with.

**`COMPOSED` versus `DERIVED` is not a hair-split.** `spiele.ergebnis` is never accepted from a client and
_is_ stored, composed server-side so the string cannot disagree with the goals it formats.
`spieltage.anzahl_spiele` is on no document at all, and
`fl_backend/tests/core/test_domain.py :: test_a_derived_field_is_on_no_document` asserts the difference
against the `$jsonSchema` validators.

### A season's rules are the interesting case

Some fields of `rules` freeze once the season is `past`, because the league table is scored from them on
every read and nothing records what they said before; some may never narrow below what already exists,
because the data below would be stranded. `erlaubte_stufen` narrows freely even on a finished season, because
it bounds what a **form offers** rather than what a stored squad row holds.

**Every one of these checks judges the step, not the endpoint and not the state it arrives in**, so a
date-only edit resubmits the whole `rules` object and passes whatever the stored values already say — which
is what keeps the dates repairable, and `docs/backend/spec.md :: I44` is the general form of it. `start_date`
and `end_date` sit on the season document rather than inside `rules` and stay editable on a finished season,
correcting a mistyped date changing nothing anybody competed for.

---

## What a write must do

`domain.py :: RULES` lists every refusal a write path performs, with its code, the operations that perform
it, the symbol that implements it and the test that covers it. What the table cannot show is what those
symbols have in common:

- each is a **pure function** — no I/O, so every one is tested without a database, in the default tier
- each is called by **the endpoint that owns the write**, never by a shared evaluator
- each refusal reaches the client as a **code** it maps to German, with an English `detail` that goes only
  to the log ([`logging/error-codes.md`](logging/error-codes.md))

**A rule returns one shape**, `fl_backend/app/core/exceptions.py :: WriteRefusal` or `None`, and
`DocumentConflictException.from_refusal` is the only route from one to a response.
`judge_spieltag_occupancy` is the one signature that differs: it returns a `SpieltagVerdict` carrying a
refusal beside the moves it plans, because a clash against a manual side is resolved rather than refused. A
uniform `is_valid(operation) -> bool` cannot express that outcome, which is why there is no central
evaluator.

**`RULES` is not the whole list of what a match write does.** The bracket resolution backs no row in it and
**rewrites** fixtures the request never named.

### The checks run in the order somebody can act on

Within a rules edit the freeze is reported first and the check computing the season's whole schedule runs
last; `fl_backend/app/api/saisons/services.py :: find_rules_refusal` carries the sequence and the reason for
each position at the line, and
`fl_backend/tests/api/test_rules_refusal.py :: test_the_freeze_is_reported_before_a_narrowing` pins it.
Telling an admin their group count strands a team, watching them fix it, and _then_ saying the season is
closed anyway is a puzzle rather than an answer.

---

## What is deliberately not enforced

**An absence looks identical to an omission**, so `domain.py :: UNENFORCED` names each permitted state with
its reason and, where there is one, the surface that reports it instead. What selects the set: refusing would
block a legitimate act rather than a mistake — a season being set up passes through several of these states
on its way to being complete.

Where a state is reported, the report is a page and never a stored flag. Where an entry names no surface,
nothing reports the state.

### An entry has to earn its place, and then prove it

A reason a reader nods at is not evidence, so `domain.py :: Unenforced` carries the fields a check can act
on and `test_domain.py` acts on each:

- **`near`** is the entry bar. It names the refusal codes a reader would expect to cover this state and does
  not find, and an entry that can name none is not surprising anybody — the observation belongs as a comment
  at the line it concerns. Each code it names must be one the application actually defines.
- **`proven_by`** names a class of `fl_backend/tests/core/test_unenforced.py`, and the pairing is exact in
  **both** directions: an entry nothing executes fails, and a test class no entry claims fails with it. That
  is what keeps a declaration from decaying into the oversight it exists to be distinguishable from.
- **`surfaced_by`** is an address rather than a description — an `/admin` route or a repo path to the
  component — and it is resolved against the frontend tree, so an entry cannot go on claiming a person can
  see the state after the page showing it has gone. What that surface shows is `reason`'s to say.

---

## Where each layer enforces what

| Layer                          | Enforces                                                    | Why not elsewhere                                                        |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| **`$jsonSchema` validators**   | BSON types, required keys, closed enums                     | Only these fail _silently_; a bad range fails Pydantic on the next read  |
| **Pydantic models**            | Ranges, patterns, lengths, cross-field shape                | A validator cannot express them, and a wrong value is loud               |
| **`find_*_refusal` functions** | Everything spanning more than one document                  | No validator sees more than one document                                 |
| **The admin pages**            | Offering only legal choices, and reporting permitted states | A page may never be the only enforcement — a direct API call bypasses it |

The line between the validators and the models is itself tested:
`fl_backend/tests/core/test_constraints.py :: test_no_validator_constrains_a_range_or_a_format` fails a
validator that reaches past it. And **the pages narrow the offer and name what they cannot narrow; they
never replace the refusal** — the entry form disables a group it can see is full, the season editor raises an
illegal ratio beside the field that holds it
(`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/banners.ts :: buildSaisonBanners`),
and `find_rules_refusal` still runs either way, because a stale form and a direct request each reach the
endpoint.

---

## Keeping this true

| If you                                                | You must also                                                                                                                        | Caught by                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Add a `REQ-*` refusal under `app/api/`                | Add its row to `RULES`, with an `implemented_by` that reaches the code and a `tested_by` that asserts on it                          | `test_domain.py`                                                                           |
| Move a refusal out from under the row that claims it  | Repoint `implemented_by`, or move the code with it                                                                                   | `test_domain.py`                                                                           |
| Rewrite a test class to assert on the message instead | Leave the code in it, or repoint `tested_by` at a class that asserts on the code                                                     | `test_domain.py`                                                                           |
| Add a collection                                      | Place it in exactly one aggregate                                                                                                    | `test_domain.py`                                                                           |
| Give a collection an `inactive_since`                 | Declare when that field may be written                                                                                               | `test_domain.py`                                                                           |
| Add any other field that is not plainly editable      | Add its `FieldPolicy`                                                                                                                | Nothing — the test resolves the policies that are declared and cannot see one nobody wrote |
| Decide _not_ to enforce something                     | Add it to `UNENFORCED` with its reason, its `near` codes, its `proven_by` class and, where a page shows the state, its `surfaced_by` | Every field of the entry, once the entry exists; nothing catches a state nobody declared   |

**What the test holds is the claim, never the address.** A callable at `implemented_by` is not enough: it has
to reach the constant holding that rule's code, same-module helpers followed, so a refusal that moved out
from under its row fails instead of passing on the strength of the function still being there. `tested_by` is
held the same way — the class it names must reach a name **imported** from the application that holds the
code. A string literal is refused on purpose, every code being bound to a named constant, so a test asserting
on the literal carries a second copy of it; and a class asserting on message substrings alone proves the
wording rather than the contract a client maps.

**`FIELD_POLICIES` is closed in its other direction at the one place that is mechanical**: every collection
whose validator declares `inactive_since` must say when that field may be written, and none of them can be
forgotten. Nothing can do the same where the editability is a judgement, which is why a field whose policy is
a judgement is the one row above with no check against it.

`fl_backend/tests/core/test_domain.py` runs in the default tier, so the rows it covers hold without anybody
remembering. It also enforces the invariant that keeps this a declaration — **no module under `app/` may
import `domain.py`** — because the moment production code reads these tables they stop being a declaration
and become an engine a write can forget to consult.

---

## See also

- **[`backend/spec.md`](backend/spec.md)** — the endpoint inventory and the backend's own invariants
- **[`glossary.md`](glossary.md)** — the German vocabulary, which is not optional
- **[`logging/error-codes.md`](logging/error-codes.md)** — how an error code reaches a log line and a German message
