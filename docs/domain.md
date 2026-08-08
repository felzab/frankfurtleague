# The domain model

**Verified against:** `0ceefab`, 2026-08-08

**What the league's data is, what depends on what, when each thing may be edited, and what a write has to do
about its neighbours.** Four questions, one page.

**The authority is `fl_backend/app/core/domain.py`, not this page.** That module states the model as data —
seven aggregates, twelve references, thirty-three field policies, thirty refusal rules, eight deliberate
absences — and `fl_backend/tests/core/test_domain.py` checks every claim in it against the code on every test
run. This page is the narrative: it explains the shape and points at the tables, and it deliberately does
not repeat them, because a second copy of a table is a second thing to be wrong.

**Nothing here runs.** The rules are enforced at the endpoint that owns the write, one pure
`find_*_refusal` per rule, and that is deliberate rather than incidental
([ADR-0066](_decisions/0066-the-domain-model-is-declared-and-conformance-checked.md)).

**If you read one section, read [Aggregates](#aggregates).** Two of the seven are counter-intuitive and both
mistakes are expensive.

---

## The five facts that shape everything else

| Fact                                                       | Consequence                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A `Team` document is **season-independent**                | Everything season-scoped about a club lives on the `saison_teams` junction   |
| A `Spieler` document is **season-independent**             | Everything a squad list shows lives on the `saison_spieler` junction         |
| A season's `rules` **decide the shape of the competition** | Narrowing one below what exists strands data, so four narrowings are refused |
| A **match write is a season write**                        | Entering a result resolves the whole bracket in the same transaction         |
| Retirement is **a date, never a delete**                   | `inactive_since` is a timestamp; nothing in this system hard-deletes a row   |

The German vocabulary is load-bearing and is defined in [`glossary.md`](glossary.md). Read that first if
`Spieltag`, `Spiel` and `Saison` are not yet distinct in your head.

---

## Aggregates

An **aggregate** is a consistency boundary: a root collection plus the collections whose invariants are
checked against that root. Membership is decided by one question — _does a rule hold this collection and the
root true together?_ — and **not** by whether one document points at another.

`domain.py :: AGGREGATES` is the list. Seven boundaries over nine collections:

| Aggregate            | Root             | Also inside                      |
| -------------------- | ---------------- | -------------------------------- |
| **Saison**           | `saisons`        | `saison_teams`, `saison_spieler` |
| **Saison-Spielplan** | `spiele`         | —                                |
| **Spieltag**         | `spieltage`      | —                                |
| **Team**             | `teams`          | —                                |
| **Spieler**          | `spieler`        | —                                |
| **Spielort**         | `spielorte`      | —                                |
| **Schiedsrichter**   | `schiedsrichter` | —                                |

### The two that surprise everybody

**`spiele` is one aggregate per SEASON, not per match.** Entering a result resolves the season's bracket in
the same transaction and rewrites fixtures the request never named
([ADR-0042](_decisions/0042-a-result-entry-resolves-the-whole-bracket.md)). So the consistency boundary of a
match write is _every fixture in that season_: `PATCH /spiele/{spiel_id}` looks like a single-document write
and is not one. Every one of the seven rules on this aggregate needs more than the fixture the request
names — the matchday it sits in, the other fixtures sharing its venue, or the season's whole bracket.

**`teams` is NOT inside `Saison`.** A club exists independently of any season — that is the single most
important structural fact in this model — and what belongs to a season is the junction row. The practical
test: a club's name, address and website are on `teams`; its group and its disqualification are on
`saison_teams`; its league table is on neither, because it is derived from the matches
([ADR-0026](_decisions/0026-team-statistics-are-derived-from-spiele.md)).

**`spieltage` is its own aggregate even though `spiele` points at it.** Nothing holds a matchday and its
fixtures true together: the matchday's position and its expected match count are both derived from elsewhere
(ADR-0064, [ADR-0065](_decisions/0065-a-seasons-schedule-is-derived-from-its-rules.md)), and retiring one
leaves its matches untouched. A reference is not a boundary.

---

## What depends on what

Twelve references, each with a **referential action** for what happens when the target changes and for what
happens when it goes away. `domain.py :: REFERENCES` carries them with a reason each; the vocabulary is
SQL's, because it is precise and because **MongoDB enforces none of it** — naming the intended behaviour is
the only way the intention is written down.

| Action      | Means                                                                 |
| ----------- | --------------------------------------------------------------------- |
| `RESTRICT`  | The operation is refused while a reference exists                     |
| `CASCADE`   | The change is propagated into the referencing rows                    |
| `SET_NULL`  | The reference is emptied and the referencing row survives             |
| `NO_ACTION` | Nothing happens, **deliberately**, and the reference stays resolvable |

`SET_NULL` appears nowhere in this system, and that is worth stating: no reference here is ever emptied
because its target moved. A bracket slot whose feeder cannot be found keeps its occupant and is _reported_
as a fault ([ADR-0047](_decisions/0047-a-bracket-fault-is-derived-on-demand.md)) — "nothing to look up" never
empties a slot.

### The three fan-outs, and what they deliberately leave alone

A match embeds a **display copy** of its team, venue and referee beside the id, so a card renders without
three joins. Renaming the target therefore has to reach every match that embeds it, and each of the three
write paths does exactly that. What none of them touches is the point:

- a venue's **`mietpreis`** and a referee's **`payment`** do not fan out. They record what _this fixture_
  cost, so rewriting them would rewrite history
  ([ADR-0028](_decisions/0028-store-what-was-true-then-derive-what-is-true-now.md), rule 2).
- a **disqualification** is not embedded at all. It is joined from the junction on every read, so entering
  one reaches every surface at once instead of needing a fan-out.

### Retirement never cascades

Retiring a club, a person, a squad row or a matchday touches nothing that points at it. A played fixture's
embedded team name is what that fixture said at the time; a squad row for a retired club still resolves and
the admin list renders it. The one place retirement is _refused_ is a club still entered in a running or
planned season (`REQ-RETIRE-001`) — because that season has not happened yet.

### There is no delete

No endpoint in this system removes a `saisons`, `saison_teams` or `spiele` document, and that is three
separate decisions rather than an oversight:

- **`saisons`** — removing a season orphans every `saison_id` in the database
  ([ADR-0033](_decisions/0033-one-active-season-and-one-path-to-it.md))
- **`saison_teams`** — a team leaves a season only by disqualification, never by deletion (ADR-0033)
- **`spiele`** — a season's fixtures are created once, then cancelled or moved
  ([ADR-0045](_decisions/0045-a-seasons-fixtures-are-created-once.md))

---

## When a field may be edited

`domain.py :: FIELD_POLICIES` answers this per field, for every field whose answer is not plainly "whenever
you like". Six values, and the distinctions between them are the useful part:

| Editability    | Means                                                       | Example                   |
| -------------- | ----------------------------------------------------------- | ------------------------- |
| `EDITABLE`     | Through a payload, whenever the aggregate's state allows    | `saisons.start_date`      |
| `CONDITIONAL`  | Permitted in some states and refused in others              | `saisons.rules.*`         |
| `CONTROL_ONLY` | On no payload; one named endpoint owns the whole transition | `saisons.status`          |
| `COMPOSED`     | On no payload, and **stored** — the server builds it        | `spiele.ergebnis`         |
| `DERIVED`      | Computed on read, **stored nowhere**                        | `spieltage.anzahl_spiele` |
| `IMMUTABLE`    | Written once at create                                      | `spiele.spiel_nr`         |

**`COMPOSED` versus `DERIVED` is not a hair-split.** `spiele.ergebnis` is never accepted from a client and
_is_ stored, composed from the two goal counts so the string cannot disagree with the goals it formats.
`spieltage.anzahl_spiele` is on no document at all. `test_domain.py :: test_a_derived_field_is_on_no_document`
asserts the difference against the `$jsonSchema` validators, so the labels mean something rather than
reading as synonyms.

### A season's rules are the interesting case

Six fields, and they behave in three different ways:

**Frozen once the season is `past`** — `win_points`, `draw_points`, `qualifiers_per_group`. The league table
is scored from them on **every read**, so editing them rewrites who won a finished competition and nothing
records what it said before.

**Never narrowed below what exists** — `number_of_groups` may not drop below a group that still holds teams,
`teams_per_group` may not drop below the fullest group's occupancy, `qualifiers_per_group` may not drop below
a placing a bracket slot already names.

**Editable at any time** — `start_date`, `end_date` and `erlaubte_stufen`. The dates stay editable _even on a
finished season_, because correcting a mistyped date changes nothing anybody competed for; and
`erlaubte_stufen` bounds what a **form offers** rather than what a stored squad row holds
([ADR-0061](_decisions/0061-position-and-stufe-are-closed-sets.md)), so narrowing it strands nothing.

The freeze compares **values**, not the endpoint. A date-only edit resubmits the whole `rules` object
unchanged and passes, which is precisely what keeps the dates repairable.

---

## What a write must do

`domain.py :: RULES` lists thirty refusals with their code, the operations that perform them, the symbol
that implements them and the test that covers them. Every one of them:

- is a **pure function** returning `(error_code, detail)` or `None` — no I/O, so it is testable without a
  database, which is why all thirty sit in the default test tier
- is called by **the endpoint that owns the write**, not by a shared evaluator
- answers with a **code** the client maps to German, and an English `detail` for the log
  ([`logging.md`](logging.md))

Twenty-five of the thirty are marked `multi_document`: they need the aggregate, not just the payload and
its own row. That is the count that explains why the boundaries above matter — five rules in six cannot be
answered from a single document.

### The checks run in the order somebody can act on

Within a rules edit the order is: the freeze, then a group asked to supply more qualifiers than it holds
teams, then the bracket's shape, then the three narrowings against stored data, and last the check that no
matchday is left over its phase's count. Telling an admin their group count strands a team, watching them fix
it, and _then_ saying the season is closed anyway is a puzzle rather than an answer.
`test_rules_refusal.py :: test_the_freeze_is_reported_before_a_narrowing` pins that ordering, because it is
behaviour.

Two positions in that sequence are load-bearing rather than incidental. The qualifier-against-capacity check
precedes the bracket rule because it is **the narrower statement** — it names two fields an admin can compare
directly, where the bracket's answer is a property of their product. The matchday check comes **last** because
it is the only one that has to compute the season's whole schedule to answer.

### Some rules act rather than refuse

Two of the thirty do not return a verdict at all, and they are the reason a uniform "is this valid" layer
would not have worked. `judge_spieltag_occupancy` **moves** a manual side out of a clash and refuses only
against a maintained one. The bracket resolution **rewrites** fixtures the request never named. An
`is_valid(operation) -> bool` shape cannot express either outcome.

---

## What is deliberately not enforced

**An absence looks identical to an omission**, so `domain.py :: UNENFORCED` names eight of them with a reason
and, where there is one, the surface that reports the state instead. The pattern across all eight is the
same: refusing would block a legitimate act rather than a mistake.

| The system permits                                  | Because                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| A rollover while matches are unplayed               | An early rollover is a real decision, needed exactly when data is untidy |
| A matchday retired while it holds played matches    | Its matches stay readable and nothing is stranded                        |
| Attached fixtures differing from the expected count | A season being set up passes through every wrong count on the way        |
| An end date before its start date                   | No schema or endpoint holds the two in order, so no page may either      |

Where a state is permitted **and reported**, the report is a page, never a stored flag: no bracket fault is
stored (ADR-0047) — a slot whose occupant was disqualified after the resolution filled it is one of the
derived faults (ADR-0052) — and the count mismatch is computed on the admin read (ADR-0065).

The one that is not reported anywhere is named as such — the eventual purge of retired rows
(roadmap BE-12), an open item, not a decision.

---

## Where each layer enforces what

Four layers, and the division is deliberate:

| Layer                          | Enforces                                                    | Why not elsewhere                                                             |
| ------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **`$jsonSchema` validators**   | BSON types, required keys, closed enums                     | Only these three fail _silently_; a bad range fails Pydantic on the next read |
| **Pydantic models**            | Ranges, patterns, lengths, cross-field shape                | A validator cannot express them, and a wrong value is loud                    |
| **`find_*_refusal` functions** | Everything spanning more than one document                  | No validator sees two documents                                               |
| **The admin pages**            | Offering only legal choices, and reporting permitted states | A page may never be the only enforcement — a direct API call bypasses it      |

The boundary between the first two is [ADR-0027](_decisions/0027-the-database-enforces-its-own-invariants.md)
and is itself tested: `test_no_validator_constrains_a_range_or_a_format` fails a validator that reaches past
it, so widening the line is a decision rather than an improvement somebody slips in.

**The pages narrow the offer; they never replace the refusal.** The season editor disables a narrowing it can
see is illegal, and `find_rules_refusal` still runs — because a stale form and a direct request both reach
the endpoint.

---

## Keeping this true

| If you                                   | You must also                                                        |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Add a `REQ-*` refusal under `app/api/`   | Add its row to `RULES`, with a real `implemented_by` and `tested_by` |
| Add a collection                         | Place it in exactly one aggregate                                    |
| Add a field that is not plainly editable | Add its `FieldPolicy`                                                |
| Decide _not_ to enforce something        | Add it to `UNENFORCED` with the reason                               |
| Rename a refusal or a test class         | The citation follows, or `test_domain.py` fails                      |

None of that rests on remembering: `fl_backend/tests/core/test_domain.py` runs in the default tier and checks
each of them. The one rule it enforces that has no other home is that **no module under `app/` may import
`domain.py`** — the moment production code reads these tables they stop being a declaration and become an
engine a write can forget to consult.

---

## See also

- **[`_decisions/0066`](_decisions/0066-the-domain-model-is-declared-and-conformance-checked.md)** — why this
  is a declaration and not a runtime rules engine, and what that rejected
- **[`_decisions/0065`](_decisions/0065-a-seasons-schedule-is-derived-from-its-rules.md)** — the season
  schedule, the rules refusals and the phase set
- **[`backend/spec.md`](backend/spec.md)** — the endpoint inventory and the backend's own invariants
- **[`glossary.md`](glossary.md)** — the German vocabulary, which is not optional
- **[`logging.md`](logging.md)** — how an error code reaches a log line and a German message
