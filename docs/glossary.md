# Glossary

**Verified against:** `7d3a797`, 2026-08-08

The domain vocabulary is German and load-bearing: it appears verbatim in collection names, schema
fields, API parameters and URLs. Translating it in your head is fine; translating it in code is not.

Each entry gives the term, what it means, where it lives, and the part that bites.

**The five that most often cost an hour**, if you read nothing else: `Spieltag` is not `Spiel` ·
a `Team` document is season-independent · `"playoffs"` is not a stored value · a cancelled match
with a result still counts · `inactive_since` is a date, never a boolean.

| Term                              | Is                                           | Section               |
| --------------------------------- | -------------------------------------------- | --------------------- |
| `Saison`                          | The competition year                         | Core entities         |
| `Spiel`                           | One match                                    | Core entities         |
| `Spieltag`                        | A named block of matches — **not** a `Spiel` | Core entities         |
| `Team`                            | A club, season-independent                   | Core entities         |
| `Spieler`                         | A person                                     | Core entities         |
| `Schiedsrichter`                  | A referee                                    | Core entities         |
| `Spielort`                        | A venue                                      | Core entities         |
| `Tore`                            | Goals, scored and conceded                   | Attributes and values |
| `Ergebnis`                        | The score as a string, derived server-side   | Attributes and values |
| `Elfmeterschießen`                | The shoot-out that settled a level knockout  | Attributes and values |
| `Gruppe`                          | A group within a season                      | Attributes and values |
| `spiel_nr`                        | A match's number within its season           | Attributes and values |
| `saison_phase`                    | Stage of the season                          | Attributes and values |
| `spiel_status`                    | Match status, derived not stored             | Attributes and values |
| `is_canceled`                     | Cancelled — and still countable              | Attributes and values |
| `Quelle`                          | Where a fixture's side comes from            | Attributes and values |
| `Platz`                           | A placing in a group's standing              | Attributes and values |
| `Ausgang`                         | Which side of a match a reference names      | Attributes and values |
| `disqualifikation`                | Out of one season, with the reason and date  | Attributes and values |
| `is_nachgetragen`                 | A squad entry added after the fact           | Attributes and values |
| `is_captain`                      | The squad's captain, for one season          | Attributes and values |
| `inactive_since`                  | Soft deletion, as a date                     | Attributes and values |
| `Statistik`                       | The derived league-table figures             | Attributes and values |
| `Mietpreis`                       | Venue cost, whole euros                      | Attributes and values |
| `Payment`                         | Referee fee, whole euros                     | Attributes and values |
| `saison_teams` · `saison_spieler` | The season junctions                         | Attributes and values |

---

## Core entities

### `Saison` — season

The competition year. Everything else hangs off one.

**In code:** `saisons` collection · `FLSaison` (`fl_backend/app/api/saisons/schemas.py`).
**Stored fields:** `start_date`, `end_date`, `status`, `rules`.
**Served but stored nowhere:** `schedule` — the season phase by phase, derived from `rules`
([ADR-0065](_decisions/0065-a-seasons-schedule-is-derived-from-its-rules.md)), which is where a
matchday's `anzahl_spiele` comes from and what lets the matchday editor refuse a phase too small for
the fixtures already attached.

**Pitfalls.** The id is **exactly four characters** and is a string, not an ObjectId — enforced at
`min_length=4, max_length=4`. That constraint is not cosmetic: `FLSpiel.saison_id` and
`FLSpieltag.saison_id` both demand exactly four characters of whatever they reference. An id like
`"2026/27"` would validate on the season itself and then make every match and matchday pointing at it
fail to parse on read.

`status` is `past` · `active` · `future` — English, unlike almost everything else in the model.

`rules` carries `win_points`, `draw_points`, `qualifiers_per_group`, `number_of_groups`,
`teams_per_group` and `erlaubte_stufen` per season, so the scoring, the size of the knockout round, the
season's capacity and the levels it admits are all season-configurable — and all six are live.
`GET /teams` scores its derived league table with
the two point values ([ADR-0026](_decisions/0026-team-statistics-are-derived-from-spiele.md)); a defeat
scores nothing, and there is deliberately no `loss_points` to say otherwise. Editing either changes
every table for that season on the next read.

`qualifiers_per_group` is how many of each group's teams reach the first knockout round
([ADR-0043](_decisions/0043-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md)). It
is required with no default on either side, so a season without it fails to read rather than seeding a
bracket from a number nobody chose. It reaches the frontend on the grouped teams response, beside the
table whose qualifying prefix it measures.

`erlaubte_stufen` is which school levels that season's squads may hold — a SUBSET of the league's own
closed set (ADR-0061), never a redefinition of it, exactly as `number_of_groups` picks a prefix of the
closed A–D group set. The squad forms offer these and nothing else. It binds the FORM rather than the
data: a row's `stufe` is held to the league's set, so narrowing a season cannot retroactively
invalidate the squads of a season already played.

`number_of_groups` and `teams_per_group` bound the season's field: it runs the first
`number_of_groups` of the closed A–D group set, and each group takes `teams_per_group` teams.
`POST /teams/{team_id}/saisons` refuses an entry outside those bounds, and a group change is held to
the same capacity (`REQ-ENTER-001..003` in [logging.md](logging.md)). Both are required with no
default, for the same reason `qualifiers_per_group` is.

**Five of the six field names are English**, unlike almost everything else in the model: they configure
the competition rather than naming anything in it. `erlaubte_stufen` is the exception and is German
because its VALUES are — it names which of the league's own school levels a season admits, and those are
the German vocabulary (ADR-0061).

**`rules` is edited on one surface**, the Regeln panel of `/admin/saisons/[saison_id]`
([ADR-0063](_decisions/0063-a-matchday-list-is-the-seasons-skeleton.md)). All six fields are writable
there and nowhere else. `status` is on no payload at all, so the rollover control on the same page remains
the only path to it ([ADR-0033](_decisions/0033-one-active-season-and-one-path-to-it.md)).

### `Spiel` — match, game

The central entity. Fixtures, results, tables and the bracket are all views of matches.

**In code:** `spiele` collection · `FLSpiel` and `FLSpielJoined`
(`fl_backend/app/api/spiele/schemas.py`) · `FLSpielSchema`
(`fl_frontend/src/features/spiele/schemas.ts`).

**Pitfalls.** The two teams are **embedded, not referenced** — `team1` and `team2` each carry
`team_id`, `name`, `shorthand` and `tore`. A team rename must therefore fan out into every match
document, which is what the venue and referee patch endpoints do for their own embedded copies.

**Two backend models, and the difference is which direction they serve.** `FLSpiel` is the document as
stored, and it is what the admin write path holds. `FLSpielJoined` is what every endpoint returns: the
same fixture with each side's `disqualifikation` looked up from `saison_teams`, which is stored on no
match ([ADR-0028](_decisions/0028-store-what-was-true-then-derive-what-is-true-now.md), rule 4). The
frontend parses no stored document, so it has one shape and calls it `FLSpiel`.

Either side is **null while its occupant is unknown** — a bracket slot the group phase has not
filled yet. What a card shows in its place is derived from `team1_quelle` / `team2_quelle`; see `Quelle`.

A knockout that finished level carries its `Elfmeterschießen` beside the score rather than inside it.

A fixture may carry an optional public **`notiz`** — free text entered in the match editor and shown
in the match details dialog; null on almost every match, and absent from documents older than the
field, which the read model tolerates by defaulting it.

**A season's matches are all created at its start, and the set never changes.** A match can be called
off (`is_canceled`) or moved to another date (`datum`); it is never deleted, and none is ever added
mid-season. That is why `/spiele` is the one resource with no POST and no DELETE
([ADR-0045](_decisions/0045-a-seasons-fixtures-are-created-once.md)) — the two absences are the rule,
not a gap. A cancelled match keeps its row, its `spiel_nr` and its place in the bracket, which is what
makes cancellation something other than a soft delete.

### `Spieltag` — matchday, fixture round

A block of matches inside a season, with a date range.

**In code:** `spieltage` collection · `FLSpieltag` (`fl_backend/app/api/spieltage/schemas.py`).
**Stored fields:** `beginn`, `ende`, `saison_phase`, `saison_id`, `inactive_since`.
**Served but stored nowhere:** `anzahl_spiele`, on the read model and on neither payload.

**Pitfalls — three things a matchday deliberately does not carry.**

**No position.** Its place in the season is derived
(`fl_backend/app/api/spieltage/services.py :: order_spieltage`,
[ADR-0064](_decisions/0064-a-matchdays-position-is-derived-not-stored.md)): `saison_phase` in bracket
order, then `beginn`, then `_id`. So moving a matchday means editing its date or its phase, two matchdays
cannot claim one place, and the order is total because the id is unique.

**No match count on the document.** `anzahl_spiele` is computed on read from the season's `rules` and this
matchday's phase, because a single round robin per group determines it exactly
([ADR-0065](_decisions/0065-a-seasons-schedule-is-derived-from-its-rules.md)) — so it cannot be sorted on,
and it is zero for a phase this season's bracket never reaches. The admin list compares it against the
fixtures actually attached.

**No name.** A group matchday is its ordinal and a knockout matchday is its round, so the label is composed
by the reader from `saison_phase` and the derived position
([ADR-0067](_decisions/0067-a-matchdays-name-is-composed-by-the-reader.md)) —
`fl_frontend/src/features/spieltage/utils.ts :: spieltagLabel`, on the frontend because it is German
display text. A round split across several matchdays gets a `(1)`/`(2)` suffix; one played once does not.

**Not the same as `Spiel`.** A `Spieltag` groups matches; a `Spiel` is one of them. The English
"matchday" collides badly here, so prefer the German in code and conversation.

### `Team` — club

**In code:** `teams` collection · `FLTeam` (`fl_backend/app/api/teams/schemas.py`).

**Pitfalls — the most important structural fact in the data model.** A team document is
**season-independent**. What is season-specific comes from somewhere else, assembled at read time by
`fl_backend/app/api/teams/services.py :: build_team_pipeline`:

| On the `teams` document                                                                     | On the `saison_teams` junction            | Computed from `spiele` |
| ------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------- |
| `name`, `full_name`, `shorthand`, `description`, `website_url`, `address`, `inactive_since` | `saison_id`, `gruppe`, `disqualifikation` | `statistik`            |

So a team's group, table position and disqualification are **properties of a team-in-a-season**, not of
the team. `FLTeam` flattens all of it back together, which is why the model looks like one document and
is not.

Two consequences worth knowing. With a `saison_id` in play the junction join is strict, so a team with
no `saison_teams` row for that season **disappears from results entirely** rather than appearing with
an empty table. And `statistik` has no stored home at all — the third column is a computation, not a
collection ([ADR-0026](_decisions/0026-team-statistics-are-derived-from-spiele.md)), so there is
nothing to keep in step and nothing to back-fill.

### `Spieler` — player

**In code:** `spieler` collection · `FLSpieler` (`fl_backend/app/api/spieler/schemas.py`).
**Fields:** `vorname`, `nachname`, `stufe`, `nummer`, `position`, `is_nachgetragen`, `team_id`.

**Pitfalls.** Only `vorname` is required; everything else may be null while a squad is being filled in.
`nummer` is a **string**, not an int, and stays free text — a squad number is worn rather than counted
and is not unique within a squad. `position` and `stufe` are **closed sets**
([ADR-0061](_decisions/0061-position-and-stufe-are-closed-sets.md)): `Tor · Abwehr · Mittelfeld ·
Angriff` and `E1 · E2 · Q1 · Q2 · Q3 · Q4`. Both stay nullable, because a squad entry is filled in over
time and an unanswered field is null rather than a placeholder.

Players use the **same two-document shape as teams**: the `spieler` record holds what does not change
between seasons, and a **`saison_spieler`** junction holds what does. `build_spieler_pipeline`
(`fl_backend/app/api/spieler/services.py`) joins them and flattens the result, so `FLSpieler` again
looks like one document and is two.

**That flattening is why the admin list reads a different endpoint.** `FLSpieler` is one player
against one season and carries no `saison_id`, so it can neither report a player who has played two
seasons nor represent one who is in no squad at all. `GET /spieler/memberships`
(`fl_backend/app/api/spieler/admin_router.py :: get_spieler_memberships`) returns the people carrying
their squad rows instead, unflattened.

### `Schiedsrichter` — referee

**In code:** `schiedsrichter` collection. Embedded on a match as
`{schiedsrichter_id, name, payment}`.

**Pitfalls.** Deletion is **soft** — `inactive_since`, never a real delete. `payment` is the
referee's fee in whole euros.

### `Spielort` — venue, playing location

**In code:** `spielorte` collection. Embedded on a match as
`{spielort_id, name, maps_link, mietpreis}`.

**Pitfalls.** `maps_link` is **not a URL** despite the name — it is free text
(`"name, address, Deutschland"`) built server-side and searched on Google Maps, so it carries no scheme
check. Deletion is soft, as with referees.

---

## Attributes and values

### `Tore` — goals

`tore` on each side of a match; `int | None`, constrained `ge=0`. `None` means the match has not been
played.

`tore_geschossen` / `tore_kassiert` in team statistics are goals **scored** and **conceded**.

### `Ergebnis` — result, final score

The score as a string: `"3:1"`, or `null` when unplayed.

**Pitfalls.** Not free text. Both sides constrain it to `^[0-9]+:[0-9]+$`, and it is **derived
server-side** from the two `tore` values — never accepted from a client. The pattern uses `[0-9]`
rather than `\d` deliberately: the backend's regex engine treats `\d` as Unicode-aware, and
`Number("٢")` in JavaScript is `NaN`, so the two ends would disagree about what counts as a digit.

The frontend parses it by matching that pattern rather than splitting on `":"`, because `":"` splits
into two empty strings and `Number("")` is `0` — a bare colon would read as a 0:0 draw.

**A shoot-out is never in here.** A knockout settled on penalties keeps the level score it finished on,
and the kicks are a scoreline of their own in `Elfmeterschießen` below — a third number in this string
would be a malformed value to every reader of it
([ADR-0044](_decisions/0044-a-shoot-out-is-its-own-scoreline.md)).

### `Elfmeterschießen` — penalty shoot-out

`elfmeterschiessen` on a `Spiel`: `{team1, team2}` — the shoot-out's own scoreline — or `null` on every
match that did not finish level, which is almost all of them.

**Only a knockout fixture carries one.** A `gruppenphase` draw is a final result worth a point to each
side, so there is no tie to break: `PATCH /spiele/{spiel_id}` discards a shoot-out arriving on a group
match, the admin form never offers the fields there, and `resolve_bracket` refuses to read one off a
group fixture even where a hand edit has stored it.

**In code:** `FLSpielElfmeterschiessen` (`fl_backend/app/api/spiele/schemas.py`) ·
`FLSpielElfmeterschiessenSchema` (`fl_frontend/src/features/spiele/schemas.ts`) ·
[ADR-0044](_decisions/0044-a-shoot-out-is-its-own-scoreline.md).

**Not the same word as `Elfmeter`.** A single spot kick awarded during play is an `Elfmeter`; this is the
sequence of kicks that decides a tie, and the system records only the second.

**Pitfalls — the two readers disagree about this fixture on purpose.** The **bracket** takes a winner
from these counts, so a level knockout advances a side instead of stalling. The **league table** does not
consult them at all: the match is a draw, one point each, and the kicks appear in no goal column
([ADR-0026](_decisions/0026-team-statistics-are-derived-from-spiele.md)). `computeErgebnisFor` follows
the table and marks it `D`, so a team's own page and the Saisontabelle agree with each other.

**The winner is derived, never stored.** There is no `sieger` field to contradict the counts, the same
reasoning that keeps an override flag off `Quelle`. A **level shoot-out is refused** by both models — it
would name nobody, which is the state the field exists to remove.

**It is kept only where the goals are level and the phase is a knockout.** `PATCH /spiele/{spiel_id}`
discards a record on any other fixture rather than refusing it, so a shoot-out stored by hand against a
match one side won 3:1 is ignored and the goals decide. A fixture whose occupant changes loses this along with its `Ergebnis`: the
kicks were taken by a side no longer in it.

**Written by the admin form and nowhere else.** The section appears on a fixture that finished level and
on no other, because that is the only shape the field can describe.

### `Gruppe` — group

`A` · `B` · `C` · `D`. Always exactly these four.

**In code:** `FLGruppenNames` (`fl_backend/app/api/teams/schemas.py`), on the `saison_teams` junction.

**Pitfalls.** The grouped response is seeded with **all four keys** even when a group has no teams. It
did not always do that, and a season with nobody in group D omitted the `"D"` key, which the frontend
schema requires — taking down `/dashboard/saisontabelle`.

Within each group, teams arrive in **standing order**: points, goal difference, goals scored, then the
head-to-head table among whoever is still level
([ADR-0043](_decisions/0043-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md)).
The same ordering seeds the playoff bracket, so **never re-sort a group anywhere** — a second sort is a
second answer to who finished second. A set the whole chain cannot separate stays tied and renders in
the pipeline's `name` order.

### `saison_phase` — stage of the season

**Stored values, exactly five:** `gruppenphase` · `achtelfinale` · `viertelfinale` · `halbfinale` ·
`finale`. Declared once, as `fl_backend/app/api/spiele/schemas.py :: PHASE_ORDER`, and that order is the
bracket's: each knockout round feeds the next.

**A season plays the LAST k of the four knockout rounds**, never a prefix — eight qualifiers play
quarter-final, semi-final and final and never touch `achtelfinale`
(`fl_backend/app/api/saisons/schedule.py :: knockout_phases_for`,
[ADR-0065](_decisions/0065-a-seasons-schedule-is-derived-from-its-rules.md)). Four knockout rounds is what
puts the qualifier ceiling at sixteen, and `MAX_QUALIFIERS` derives that from the set rather than
restating it.

**Pitfalls.** `"playoffs"` is **not** one of them. It is a query-only alias, accepted as a filter value
and compiled by `build_spiele_filter` to `saison_phase != "gruppenphase"`. It never appears on a stored
document, and you will not find it in the data.

`GET /teams` reads the same field but does **not** take this filter. It takes `statistik_scope`, a
closed set of two — see "Statistik" below, and
[ADR-0029](_decisions/0029-the-league-table-counts-the-gruppenphase.md) for why a general phase filter
was rejected there.

### `spiel_status` — match status

`ausstehend` (upcoming) · `vergangen` (past) · `heute` (today) · `abgesagt` (cancelled) ·
`unbekannt` (unknown).

**Two definitions, and the difference is the rule**
([ADR-0072](_decisions/0072-a-status-filter-is-not-a-status-label.md)): the server compiles a
**filter** and the client derives a **label**, and they answer different questions.

| Status       | Server filter (`build_spiele_filter`) | Client derivation (`computeSpielStatus`) |
| ------------ | ------------------------------------- | ---------------------------------------- |
| `heute`      | `datum == today`                      | `datum === today`                        |
| `vergangen`  | `datum < today`                       | `datum < today`                          |
| `ausstehend` | `datum >= today` — **includes today** | `datum > today` — **excludes today**     |
| `abgesagt`   | `is_canceled == True`                 | wins over any date                       |
| `unbekannt`  | no branch — filters nothing           | `datum === null`                         |

The filter values are deliberately **not a partition** — `heute` is a subset of `ausstehend`,
because a fixture today is still ahead of a reader asking for upcoming matches. The label **is** a
partition, because one card wears one word and `heute` is the most informative one on the day. So a
match today is returned by the landing page's "upcoming" query and labelled `HEUTE` by its own
card, which is the intended composition, not a mismatch.

Note also `unbekannt`: passing it as a filter returns _everything_, because no branch matches.

### `is_canceled` / `abgesagt` — cancelled

A boolean on the match. The client treats cancellation as **overriding** the date when deriving status;
the server treats `is_canceled` and `datum` as independent filters.

**It is not a delete, soft or otherwise.** A cancelled match keeps its row, its `spiel_nr` and its place
in the bracket, and still counts in the table if a result was awarded — which is why `spiele` carries no
`inactive_since` and `/spiele` has no DELETE (see `Spiel`, and
[ADR-0045](_decisions/0045-a-seasons-fixtures-are-created-once.md)).

### `Quelle` — where a side of a fixture comes from

`team1_quelle` and `team2_quelle` on a `Spiel`: a **structural reference** naming what feeds that side of
the bracket, never display text. It is a tagged union with two variants and no third, discriminated on
`type` ([ADR-0042](_decisions/0042-a-result-entry-resolves-the-whole-bracket.md)):

| Variant  | Stored                                             | Reads as          |
| -------- | -------------------------------------------------- | ----------------- |
| `gruppe` | `{type: "gruppe", gruppe: "A", platz: 1}`          | `1. der Gruppe A` |
| `spiel`  | `{type: "spiel", spiel_nr: 25, ausgang: "sieger"}` | `Sieger 25.`      |

`null` on a group-phase fixture, whose sides come from the schedule and from no earlier match — and on
any slot an admin has taken manual charge of.

**The German is derived and stored nowhere.** `fl_frontend/src/features/spiele/utils.ts ::
formatQuelle` is the only place either codebase turns a reference into words, so the bracket's
vocabulary exists once rather than once per fixture. **`type` is the one English key**, because it names
the shape of the object rather than anything in the competition; see `format` on the teams response for
the same line drawn elsewhere.

**It is also the only record of the bracket's edges**, which is why `PATCH /spiele/{spiel_id}` reads it:
the occupant of a slot fed by a match _is_ the winner of that match, and the occupant of a slot fed by a
group placing _is_ the team that has finished there beyond doubt. Every result entry recomputes both for
the whole season.

**A `gruppe` reference is honoured only once no remaining fixture in that group could change who holds
the placing** (ADR-0043). Until then the slot is empty, and that is not a state anybody is told about.

**Five states are reported, because no further result fixes any of them** — the _bracket faults_ below.
They arrive in `FLPatchSpielDataResponse.bracket_faults` on the save that computed them, and are
re-derived over every season by `GET /spiele/action_required`, so a missed toast does not lose one
([ADR-0047](_decisions/0047-a-bracket-fault-is-derived-on-demand.md)). None of them is stored.

| `reason`           | The reference                                                      | The slot   |
| ------------------ | ------------------------------------------------------------------ | ---------- |
| `gruppe_too_small` | a `platz` the group will never produce                             | stands     |
| `tie_unresolved`   | a placing the chain cannot separate in a group that has finished   | is emptied |
| `spiel_missing`    | a `spiel_nr` the season has no match for                           | stands     |
| `reference_cycle`  | a chain of references that closes on itself                        | stands     |
| `same_team`        | two references resolving to one club, so the fixture is unplayable | both stand |

**In code:** `FLSpielQuelle` (`fl_backend/app/api/spiele/schemas.py`) · `FLSpielQuelleSchema`
(`fl_frontend/src/features/spiele/schemas.ts`) · `fl_backend/app/api/spiele/services.py ::
resolve_bracket` · [ADR-0041](_decisions/0041-a-bracket-slot-carries-its-own-provenance.md) ·
[ADR-0042](_decisions/0042-a-result-entry-resolves-the-whole-bracket.md).

**Pitfalls.** It is **not** paired with the team field beside it: no model and no validator relates
the two, a side is `null` while its occupant is unknown, and the derived label is what a card renders
in its place — the reference describes the _fixture_, so it stays true once the winner is written in.
All four combinations of the two fields are legitimate stored states; a reader takes `team.name`
first, then `formatQuelle`, then "Noch offen", and never asks which state it is in. The one place a
relationship IS enforced is the match write path, which refuses a payload that changes the team by
hand while a `Quelle` stands
([ADR-0046](_decisions/0046-the-write-path-refuses-wiring-the-season-cannot-hold.md)).

**A reference owns the slot beside it, and clearing it is the only manual override.** While a `Quelle`
names a match the season has, only the resolution writes that side. A hand-set team submitted against
one is a 409 at the write path; written any other way — Compass, a stale client — it is reverted on
the next save of anything in that season. Setting the `Quelle` to `null` hands the slot back.
**There is no override flag and there must not be one**: a flag beside the reference could contradict
it, and no `$jsonSchema` validator can express that it must not.

A stored reference naming a match that does not exist is left alone instead of emptying the slot: a
number nobody can resolve is a typo, not an instruction to remove a team. The write path refuses to
store a new one (ADR-0046), so the state is reachable only by a hand edit.

The reason it is a sibling rather than a key inside the team field: a display copy of `teams.name` is
maintained by the rename fan-out in `PATCH /teams/{team_id}`
([ADR-0028](_decisions/0028-store-what-was-true-then-derive-what-is-true-now.md), rule 3), and a
provenance reference must never be. Sharing one field is what forced that endpoint to carry an exemption.

### `Platz` — a placing in a group's standing

`platz` inside a `gruppe` `Quelle`: `1` is the group winner, `2` the runner-up. An `int` with `gt=0`,
and nothing bounds it above — a group with fewer teams than the number is possible, and it is reported
rather than refused (see `Quelle`).

**It counts only the teams that can hold a placing**, which is not every row of the table
([ADR-0043](_decisions/0043-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md)). A
**disqualified** team keeps its row and cannot advance out of it, so the place falls to the team below.
A team with **no match that counts or still could** holds no placing at all — it is served a zeroed
`Statistik`, which ranks above every team with a negative goal difference, and the Saisontabelle prints
`N/A` instead of a position for that row. So `platz: 2` names the second team that could actually
advance, and the table's marker passes over exactly the same rows.

**Pitfall.** Not the same as `position`, which is a player's position on the pitch — a closed set of
four on `FLSpieler` ([ADR-0061](_decisions/0061-position-and-stufe-are-closed-sets.md)).

### `Ausgang` — which side of a match a reference names

`ausgang` inside a `spiel` `Quelle`: `sieger` or `verlierer`, exactly two values.

**Pitfalls.** `verlierer` exists because a third-place play-off is fed by the two losing semi-finals.
The resolution honours both spellings, and **nothing writes `verlierer` today** — the 2026 bracket has
no such fixture, and the bracket simply could not express one without it. A match that finished level
names a side through its `Elfmeterschießen`, and a level match without one has neither a `sieger` nor a
`verlierer`, so a reference to either resolves to nobody and the slot stays empty.

### `spiel_nr` — a match's number within its season

An `int` with `gt=0` on `FLSpiel`, and the sort key `sort_by=spiel_nr` orders by.

**Pitfalls.** It is unique **within a season, not globally** — `spiele.uniq_saison_id_spiel_nr` is a
compound index, and every season starts again at 1. That is why `resolve_bracket` must be given exactly
one season: a wider list resolves a `Quelle` against a match from the wrong year. It is also why a
`Quelle` references a match by this number rather than by `_id` — a bracket is drawn by match number
before the documents exist.

### `disqualifikation` — out of one season, with the reason

An embedded record on the `saison_teams` junction — a team is disqualified **for a season**, not
permanently. Two keys: `grund`, the reason as free text, and `datum`, the day it took effect as a
`YYYY-MM-DD` string.

**Its absence is the null, and no boolean exists.** A team is disqualified exactly when the field is
not null — on the document, on `FLTeam`, on each side of a served `FLSpiel`, and in the Zod mirror alike
([ADR-0059](_decisions/0059-a-disqualification-is-a-record-and-its-absence-is-the-null.md)). A flag
beside the record could contradict it and no `$jsonSchema` validator can express that it must not,
which is the argument that made `inactive_since` a bare date.

**`grund` is public.** It is served on `FLTeam` and rendered as authored on the team's own page, so it
is written for readers rather than for a file. There is no closed set of reasons: this league publishes
no disciplinary code an enum could cite.

**It is the only way out of a season.** The junction has no `DELETE`
([ADR-0033](_decisions/0033-one-active-season-and-one-path-to-it.md)), so
`PATCH /teams/{team_id}/saisons/{saison_id}` writing this record is how a team stops competing, and
writing `null` over it is how that is lifted.

**`GET /teams?is_disqualified=` is a question, not this field.** It is a boolean the backend translates
into a null test — nobody filters a list by the wording of a reason.

### `is_captain` — the squad's captain for one season

On the **`saison_spieler` junction**, not on the person, and that is the whole point: captaincy is a
role within one team for one season, so a player who captains 2026 need not captain 2027 and a player
who moves club does not carry it with them.

Not unique by any rule the database enforces. A co-captaincy is a real arrangement, and no validator
sees two documents at once anyway (backend spec I16).

**The marker used to live inside the name.** Six squad rows carried a literal `(C)` in `vorname` or
`nachname`, because there was nowhere else to put it; the field replaced them and the names were
cleaned in the same change. `PERSON_NAME_PATTERN` on the write payloads is what stops the next one.

### `is_nachgetragen` — "entered later", retrospectively added

On `FLSpieler`. Marks a squad entry added after the fact — the player joined a season that had already
started. The admin create form derives it from the chosen season's status rather than asking (owner,
2026-08-07), and every junction payload requires it with no default, so it is always an answer rather
than a value nobody chose.

### `inactive_since` — the day something left

A nullable `YYYY-MM-DD` string on `teams`, `spieler`, `saison_spieler`, `spieltage`, `spielorte` and
`schiedsrichter`. `null` means current; a date means retired on that date. There is no hard delete for
any of them ([ADR-0032](_decisions/0032-soft-deletion-is-a-date-not-a-flag.md)).

**A date rather than a flag, and the reason is not tidiness.** A boolean beside a date can contradict
itself and no `$jsonSchema` validator can express that it must not, so the two are never both stored.
The date is also what a future scheduled purge selects on (open item BE-12).

**It is on no payload.** `DELETE /{resource}/{id}` stamps it and `POST /{resource}/{id}/reactivate`
clears it. Creating never revives a retired row — a natural-key collision comes back **409**.

**Not the same thing as leaving one season.** A club that stops competing _in a season_ carries a
`disqualifikation` on the junction; `inactive_since` on `teams` is the club leaving the league
([ADR-0033](_decisions/0033-one-active-season-and-one-path-to-it.md)).

### `Statistik` — team statistics

`FLTeamStatistik`: `anzahl_gespielte_spiele` (matches played), `siege` (wins), `niederlagen` (losses),
`unentschieden` (draws), `tore_geschossen`, `tore_kassiert`, `punkte` (points).

**Not stored anywhere.** The seven numbers are **derived from the `spiele` documents on every read**
([ADR-0026](_decisions/0026-team-statistics-are-derived-from-spiele.md)), per team and per season, by
the same pipeline that serves `GET /teams`. There is no field to update, which is why no write path
mentions them.

**The counting rules, which are decisions rather than implementation details:**

- **A match contributes exactly when it carries an `ergebnis`.** An unplayed match contributes
  nothing, including to `anzahl_gespielte_spiele`.
- **A cancelled match with a result still counts — that is a forfeit.** `is_canceled` is deliberately
  not consulted. Three matches in season 2026 are in this state.
- **A knockout settled on penalties is a draw here.** `Elfmeterschießen` is not consulted either, so the
  fixture scores one point each and the kicks reach no goal column. Only the bracket takes a winner from
  them ([ADR-0044](_decisions/0044-a-shoot-out-is-its-own-scoreline.md)).
- **Points come from the season's `rules.win_points` / `draw_points`**, never a hardcoded 3/1/0. A
  defeat scores nothing, because `FLSaisonRules` has no `loss_points`.

Every field is `ge=0` and defaults to 0, so a team whose season holds no counting match is served a
zeroed object rather than an absent one.

**There are two tables, and which one you get is `statistik_scope`**
([ADR-0029](_decisions/0029-the-league-table-counts-the-gruppenphase.md)):

| Scope                      | Counts                           | Where it is shown                                        |
| -------------------------- | -------------------------------- | -------------------------------------------------------- |
| `gruppenphase` _(default)_ | Gruppenphase matches only        | `/dashboard/saisontabelle`, and every other team surface |
| `gesamt`                   | Every phase, playoff matches too | `/dashboard/teams/[team_id]` — the team's own page       |

**Pitfall.** Both scopes return the same seven fields, so a caller that omits the parameter gets a
plausible table rather than an error. That is why the default is the narrow one: the Saisontabelle is a
**group** standing and a playoff result must not move it. A page wanting season-wide figures has to ask.
The two therefore disagree by design — Helmholtz's group row and its own page differ by one
Viertelfinale — and each page carries a line of copy saying which it shows.

### `Mietpreis` — rental price

The venue's cost in **whole euros**, `int` with `ge=0`.

**Pitfalls.** It has **no default on the backend model**, deliberately. The admin patch writes the
payload back wholesale with `$set`, so a default would let a request that omitted the field silently
overwrite a real rent with `0`. On the frontend a _draft_ type permits `null` while an admin is
mid-edit, and the strict schema rejects it at submit time with a German message on the field.

### `Payment` — referee fee

Same shape and the same reasoning as `Mietpreis`: whole euros, `ge=0`, no default.

---

### `saison_teams` / `saison_spieler` — the season junctions

Two collections with no model of their own, joined at read time and never returned directly.

**In code:** `SAISON_TEAMS_COLLECTION_NAME` (`fl_backend/app/api/teams/services.py`),
`SAISON_SPIELER_COLLECTION_NAME` (`fl_backend/app/api/spieler/services.py`).

**Pitfalls.** They are the reason "a team" and "a player" are season-scoped concepts even though their
base documents are not. With a `saison_id` in play the join is strict, so an entity with no junction row
for that season is simply absent from results rather than appearing with empty fields.

**A junction row is addressed by its natural key, under the entity** —
`/teams/{team_id}/saisons/{saison_id}` and `/spieler/{spieler_id}/saisons/{saison_id}`. The path is
exactly the collection's unique index, so an ambiguous write cannot be expressed. **The `saisons`
segment there names a junction row, not a season document**: a season lives at `/saisons/{saison_id}`
and belongs to no team. A `GET` added under either path must return junction rows
([ADR-0034](_decisions/0034-the-write-path-is-resource-first-in-a-second-router.md)).

**The two behave differently on the way out, and that is deliberate.** `saison_spieler` carries
`inactive_since`, because a player leaves a squad. `saison_teams` carries none: once squads are settled
a team never leaves a season, and the only way out is disqualification — so that junction has a POST and
a PATCH and **no DELETE**
([ADR-0033](_decisions/0033-one-active-season-and-one-path-to-it.md)). That is also why creating a
`saison_teams` row is a plain insert while `saison_spieler` has to offer a reactivate: no
`saison_teams` row is ever retired, so its unique index is never held by a dead one.

**`saison_spieler` currently looks like a pointless join, and is not.** With one season in the
database the relationship is one-to-one — 362 base documents, 362 junction rows — and the base
`spieler` document holds only three fields: `_id`, `vorname`, `nachname`. Everything else lives on
the junction. **Do not collapse the two.** The split is what makes a player who returns next season a
single person with two squad entries, which is the situation it exists for.

## Terms that are not domain vocabulary

Words that look like domain terms and are not.

| Term                        | Actually                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `slice`                     | A frontend code-organisation unit under `src/features/`, one per business entity                  |
| `surface`                   | A documentation term: frontend, backend, or ops. See [`_standard/README.md`](_standard/README.md) |
| `base` / `system` / `admin` | The three API key tiers, not user roles. See the backend spec                                     |
| `format`                    | The discriminator on the teams response (`list` · `grouped`, or `single` from `GET /teams/{id}`)  |
