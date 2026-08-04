# Glossary

**Verified against:** `df21894`, 2026-08-04

The domain vocabulary is German and load-bearing: it appears verbatim in collection names, schema
fields, API parameters and URLs. Translating it in your head is fine; translating it in code is not.

Entries give the term, what it means, where it lives, and the part that bites.

---

## Core entities

### `Saison` — season

The competition year. Everything else hangs off one.

**In code:** `saisons` collection · `FLSaison` (`fl_backend/app/api/saisons/schemas.py`).
**Fields:** `start_date`, `end_date`, `status`, `rules`.

**Pitfalls.** The id is **exactly four characters** and is a string, not an ObjectId — enforced at
`min_length=4, max_length=4`. That constraint is not cosmetic: `FLSpiel.saison_id` and
`FLSpieltag.saison_id` both demand exactly four characters of whatever they reference. An id like
`"2026/27"` would validate on the season itself and then make every match and matchday pointing at it
fail to parse on read.

`status` is `past` · `active` · `future` — English, unlike almost everything else in the model.

`rules` carries `win_points` and `draw_points` per season, so scoring is season-configurable — and it
is live: `GET /teams` scores its derived league table with these two numbers
([ADR-0026](_decisions/0026-team-statistics-are-derived-from-spiele.md)). A defeat scores nothing, and
there is deliberately no `loss_points` to say otherwise. Editing either value changes every table for
that season on the next read.

### `Spiel` — match, game

The central entity. Fixtures, results, tables and the bracket are all views of matches.

**In code:** `spiele` collection · `FLSpiel` (`fl_backend/app/api/spiele/schemas.py`) ·
`FLSpielSchema` (`fl_frontend/src/features/spiele/schemas.ts`).

**Pitfalls.** The two teams are **embedded, not referenced** — `team1` and `team2` each carry
`team_id`, `name`, `shorthand` and `tore`. A team rename must therefore fan out into every match
document, which is what the venue and referee patch endpoints do for their own embedded copies.

### `Spieltag` — matchday, fixture round

A named block of matches inside a season, with a date range.

**In code:** `spieltage` collection · `FLSpieltag` (`fl_backend/app/api/spieltage/schemas.py`).
**Fields:** `name`, `beginn`, `ende`, `anzahl_spiele`, `order_val`, `saison_phase`, `saison_id`.

**Pitfalls.** Ordering is by `order_val`, not by date — that is the default sort. **Not the same as
`Spiel`.** A `Spieltag` groups matches; a `Spiel` is one of them. The English "matchday" collides
badly here, so prefer the German in code and conversation.

### `Team`

**In code:** `teams` collection · `FLTeam` (`fl_backend/app/api/teams/schemas.py`).

**Pitfalls — the most important structural fact in the data model.** A team document is
**season-independent**. What is season-specific comes from somewhere else, assembled at read time by
`build_team_pipeline` (`fl_backend/app/api/teams/services.py`):

| On the `teams` document                                                                     | On the `saison_teams` junction           | Computed from `spiele` |
| ------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------- |
| `name`, `full_name`, `shorthand`, `description`, `website_url`, `address`, `is_placeholder` | `saison_id`, `gruppe`, `is_disqualified` | `statistik`            |

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
`nummer` is a **string**, not an int. `stufe` (level/tier) is free text, not an enum.

Players use the **same two-document shape as teams**: the `spieler` record holds what does not change
between seasons, and a **`saison_spieler`** junction holds what does. `build_spieler_pipeline`
(`fl_backend/app/api/spieler/services.py`) joins them and flattens the result, so `FLSpieler` again
looks like one document and is two.

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

### `Gruppe` — group

`A` · `B` · `C` · `D`. Always exactly these four.

**In code:** `FLGruppenNames` (`fl_backend/app/api/teams/schemas.py`), on the `saison_teams` junction.

**Pitfalls.** The grouped response is seeded with **all four keys** even when a group has no teams. It
did not always do that, and a season with nobody in group D omitted the `"D"` key, which the frontend
schema requires — taking down `/dashboard/saisontabelle`. Within each group, teams are sorted by points
then goal difference.

### `saison_phase` — stage of the season

**Stored values, exactly four:** `gruppenphase` · `viertelfinale` · `halbfinale` · `finale`.

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

**Pitfalls — two definitions that do not match.** The server compiles the filter one way and the client
derives the label another:

| Status       | Server filter (`build_spiele_filter`) | Client derivation (`computeSpielStatus`) |
| ------------ | ------------------------------------- | ---------------------------------------- |
| `heute`      | `datum == today`                      | `datum === today`                        |
| `vergangen`  | `datum < today`                       | `datum < today`                          |
| `ausstehend` | `datum >= today` — **includes today** | `datum > today` — **excludes today**     |
| `abgesagt`   | `is_canceled == True`                 | wins over any date                       |
| `unbekannt`  | no branch — filters nothing           | `datum === null`                         |

A match today is returned by an "upcoming" query and then labelled `heute` by its own card. On the
landing page that is probably intended. Recorded as **Finding F1** in the ledger; verify the intent
before changing either side.

Note also `unbekannt`: passing it as a filter returns _everything_, because no branch matches.

### `is_canceled` / `abgesagt` — cancelled

A boolean on the match. The client treats cancellation as **overriding** the date when deriving status;
the server treats `is_canceled` and `datum` as independent filters.

### `is_placeholder` — the "TBD" team

A real team document standing in for an opponent that is not yet known — an unplayed bracket slot.
Excluded from team queries unless `include_placeholders` is set.

**Pitfalls.** It is a lie in the data model, and a known one. A placeholder needs its own
`saison_teams` row per season, which nothing prompts anyone to create. The intended fix is a nullable
opponent reference on the match with the placeholder team deleted. Tracked as **BE-9** in
[`roadmap/open-items.md`](roadmap/open-items.md).

One trap the fix has to clear: the placeholder's name embedded in a match is **not** a copy of
`teams.name`. Matches 29–31 embed `"Sieger 25."`, `"Sieger 26."` and so on, where the referenced
document reads `"TBD"` — the field carries a bracket slot label that exists nowhere else.

### `is_disqualified`

On the `saison_teams` junction — a team is disqualified **for a season**, not permanently.

### `is_nachgetragen` — "entered later", retrospectively added

On `FLSpieler`. Marks a squad entry added after the fact.

### `inactive_since` — the day something left

A nullable `YYYY-MM-DD` string on `teams`, `spieler`, `saison_spieler`, `spieltage`, `spielorte` and
`schiedsrichter`. `null` means current; a date means retired on that date. There is no hard delete for
any of them ([ADR-0032](_decisions/0032-soft-deletion-is-a-date-not-a-flag.md)).

**A date rather than a flag, and the reason is not tidiness.** A boolean beside a date can contradict
itself and no `$jsonSchema` validator can express that it must not, so the two are never both stored.
The date is also what a future scheduled purge selects on (open item BE-12).

**It is on no payload.** `DELETE /{resource}/{id}` stamps it and `POST /{resource}/{id}/reactivate`
clears it. Creating never revives a retired row — a natural-key collision comes back **409**.

**Not the same thing as leaving one season.** A club that stops competing _in a season_ is
`is_disqualified` on the junction; `inactive_since` on `teams` is the club leaving the league
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
