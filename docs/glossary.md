# Glossary

**Verified against:** `78d32af9`, 2026-08-19\
**Purpose:** the German domain vocabulary — one entry per term, giving what it is, where it lives, what catches people, and where the rule is enforced.

The vocabulary appears verbatim in collection names, schema fields, API parameters and URLs.
Translating it in your head is fine; translating it in code is not.

| Section                              | Answers                                               |
| ------------------------------------ | ----------------------------------------------------- |
| Core entities                        | What each stored entity is                            |
| Attributes and values                | What a field on one of them means                     |
| Terms that are not domain vocabulary | What a word that looks like a domain term actually is |

**The five that most often cost an hour:** `Spieltag` is not `Spiel` · a `Team` document is
season-independent · `"playoffs"` is not a stored value · a cancelled match with a result still counts
· `inactive_since` is a date, never a boolean.

---

## Core entities

### `Saison` — the competition year

**Is:** the year everything else hangs off, carrying `start_date`, `end_date`, `status` and a `rules` block that configures the scoring, the number and size of the groups, how many qualify, and which school levels the squads may hold.\
**In code:** `fl_backend/app/api/saisons/schemas.py :: FLSaison` — the `saisons` collection; the schedule it serves is derived by `fl_backend/app/api/saisons/schedule.py :: knockout_phases_for`.\
**Trap:** the id is a four-character string rather than an ObjectId, and every `saison_id` referencing it is held to exactly that length, so a longer id validates on the season and then makes every match and matchday pointing at it fail to read.\
**See:** backend spec I18 for the single path to `status`.

### `Spiel` — one match

**Is:** the central entity — fixtures, results, the league table and the bracket are all views of matches.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpiel` is the stored shape, `FLSpielJoined` the served one; `fl_frontend/src/features/spiele/schemas.ts :: FLSpielSchema` mirrors the served shape alone.\
**Trap:** the two teams are embedded rather than referenced, so a rename fans out into every match document; either side is null while its occupant is unknown; and a season's fixtures are created once, so `/spiele` has no POST and no DELETE.\
**See:** backend spec I32 for the joined field, I26 for the two absences.

### `Spieltag` — matchday, fixture round

**Is:** a block of matches inside a season, with a date range and a phase.\
**In code:** `fl_backend/app/api/spieltage/schemas.py :: FLSpieltag`; its order is `fl_backend/app/api/spieltage/services.py :: order_spieltage` and its German label `fl_frontend/src/features/spieltage/utils.ts :: spieltagLabel`.\
**Trap:** it carries no position, no name and no match count — all three are derived, so moving one means editing its phase or its `beginn`, and `anzahl_spiele` cannot be sorted on.\
**See:** backend spec §1.1 for the payloads that carry none of the three, and [`domain.md`](domain.md) for `anzahl_spiele` as a derived field.

### `Team` — club

**Is:** a club, and the document is **season-independent**: its group, its disqualification and its table are assembled at read time from a junction row and from the matches.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLTeam`, flattened by `fl_backend/app/api/teams/services.py :: build_team_pipeline`.\
**Trap:** with a `saison_id` in play the junction join is strict, so a team with no `saison_teams` row for that season disappears from results entirely rather than appearing with an empty table.\
**See:** backend spec I11, and [`domain.md`](domain.md) for the aggregate.

### `Spieler` — player

**Is:** a person, whose season-specific facts — squad membership, captaincy, retirement — live on a `saison_spieler` junction rather than on the person.\
**In code:** `fl_backend/app/api/spieler/schemas.py :: FLSpieler`, flattened by `fl_backend/app/api/spieler/services.py :: build_spieler_pipeline`.\
**Trap:** only `vorname` is required and `nummer` is a free-text string rather than an int; `FLSpieler` is one player against one season and carries no `saison_id`, so the admin list reads `GET /spieler/memberships` instead.\
**See:** backend spec I35 for the two closed sets.

### `Schiedsrichter` — referee

**Is:** a referee, embedded on a match as `{schiedsrichter_id, name, payment}`.\
**In code:** the `schiedsrichter` collection — `fl_backend/app/core/collections.py :: Collection`.\
**Trap:** deletion is soft, and a rename must fan out into the embedded copy on every match that carries it.\
**See:** backend spec I13 for the fan-out.

### `Spielort` — venue, playing location

**Is:** a venue, embedded on a match as `{spielort_id, name, maps_link, mietpreis}`.\
**In code:** the `spielorte` collection — `fl_backend/app/core/collections.py :: Collection`.\
**Trap:** `maps_link` is **not** a URL despite the name — it is free text built server-side and searched on Google Maps, so it carries no scheme check.\
**See:** backend spec I13.

---

## Attributes and values

### `Tore` — goals

**Is:** `tore` on each side of a match, `int | None` constrained `ge=0`, where `None` means the match has not been played.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpiel`; `tore_geschossen` and `tore_kassiert` in team statistics are goals scored and conceded.\
**Trap:** —\
**See:** backend spec I1.

### `Ergebnis` — result, final score

**Is:** the score as a string — `"3:1"`, or null when unplayed — derived server-side from the two `tore` values and never accepted from a client.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpiel`, mirrored by `fl_frontend/src/features/spiele/schemas.ts :: FLSpielSchema`.\
**Trap:** both ends constrain it to `^[0-9]+:[0-9]+$` and the class is deliberately `[0-9]` rather than `\d`, whose Unicode-aware backend reading would accept digits `Number()` turns into `NaN`; the frontend matches that pattern rather than splitting on `":"`, because a bare colon would read as a 0:0 draw.\
**See:** backend spec I25 for why a shoot-out is never in this string.

### `Elfmeterschießen` — penalty shoot-out

**Is:** `elfmeterschiessen` on a match — the shoot-out's own scoreline, or null on every match that did not finish level, which is almost all of them.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielElfmeterschiessen`, mirrored by `fl_frontend/src/features/spiele/schemas.ts :: FLSpielSchema`.\
**Trap:** its two readers disagree on purpose — the bracket takes a winner from the counts so a level knockout advances a side, while the league table never consults them and scores the fixture as the draw it was; a level shoot-out is refused, and a record stored against a group match or a decided one is discarded.\
**See:** backend spec I25 and I25a.

### `Gruppe` — a group within a season

**Is:** the closed set `A` · `B` · `C` · `D`, held on the `saison_teams` junction, of which a season runs the first `rules.number_of_groups`.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLGruppenNames`.\
**Trap:** the grouped response is seeded with all four keys even where a group holds no teams, because the frontend schema requires all four and an unseeded group would take down `/dashboard/saisontabelle`; and teams arrive already in standing order, so re-sorting a group anywhere is a second answer to who finished second.\
**See:** backend spec I10 for the four seeded keys, I24 for the one ranking chain the standing order comes from.

### `spiel_nr` — a match's number within its season

**Is:** an `int` with `gt=0` on a match, and the key `sort_by=spiel_nr` orders by.\
**In code:** `fl_backend/app/core/constraints.py :: uniq_saison_id_spiel_nr`.\
**Trap:** it is unique within a season rather than globally, and every season starts again at 1 — which is why `resolve_bracket` must be given exactly one season, and why a `Quelle` references a match by this number rather than by `_id`.\
**See:** backend spec I15 for the unique index behind it.

### `saison_phase` — stage of the season

**Is:** the stored set `gruppenphase` · `achtelfinale` · `viertelfinale` · `halbfinale` · `finale`, declared in bracket order so each knockout round feeds the next.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: PHASE_ORDER`; a season plays the last of the knockout rounds it has qualifiers for, per `fl_backend/app/api/saisons/schedule.py :: knockout_phases_for`.\
**Trap:** `"playoffs"` is **not** one of them — it is a query-only alias compiled to `saison_phase != "gruppenphase"`, and it appears on no stored document; `GET /teams` does not take this filter at all, but `statistik_scope`.\
**See:** backend spec I1c for the table's default scope.

### `spiel_status` — match status

**Is:** `ausstehend` · `vergangen` · `heute` · `abgesagt` · `unbekannt`, derived on both ends and stored nowhere.\
**In code:** `fl_backend/app/api/spiele/services.py :: build_spiele_filter` compiles the filter; `fl_frontend/src/features/spiele/utils.ts :: computeSpielStatus` derives the label.\
**Trap:** the two definitions differ on purpose — the server's `ausstehend` is `datum >= today` and **includes** today, the client's is `datum > today` and **excludes** it, because a filter selects while a label partitions; and passing `unbekannt` as a filter returns everything, since no branch matches it.\
**See:** backend spec §1.2 for the filter each value compiles to.

### `is_canceled` / `abgesagt` — called off, and still countable

**Is:** a boolean on the match saying the fixture was called off.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpiel`.\
**Trap:** it is not a delete of any kind — the match keeps its row, its `spiel_nr` and its place in the bracket — and a cancelled match that carries a result still counts in the table, because the derivation of the figures the table is scored and sorted on deliberately does not consult this field; the one figure it does decide is `anzahl_abgesagte_spiele`, which counts every cancellation, so a forfeit lands in that count and in the match tally both.\
**See:** backend spec I1a for what the table ignores, I1d for the cancellation count.

### `Quelle` — where a side of a fixture comes from

**Is:** `team1_quelle` and `team2_quelle` — a structural reference naming what feeds that side of the bracket, either a group placing or a match outcome, and never display text.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielQuelle`, resolved by `fl_backend/app/api/spiele/services.py :: resolve_bracket`, rendered by `fl_frontend/src/features/spiele/utils.ts :: formatQuelle`.\
**Trap:** it is not paired with the team field beside it — all four combinations of the two are legitimate stored states — and while a reference stands it owns the slot, so a hand-set team is a 409 at the write path and is reverted on the next save; clearing the reference is the only manual override, and there is deliberately no override flag.\
**See:** backend spec I22 for the independence and I28 for the faults a resolution reports.

### `Platz` — a placing in a group's standing

**Is:** `platz` inside a `gruppe` reference: `1` is the group winner, `2` the runner-up, an `int` with `gt=0` and no upper bound.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielQuelle`.\
**Trap:** it counts only the teams that can hold a placing, so a disqualified team keeps its table row and the place falls to the team below, and a team with no match that counts or still could holds no placing at all; a `platz` the group can never produce is reported rather than refused.\
**See:** backend spec I24b.

### `Ausgang` — which side of a match a reference names

**Is:** `ausgang` inside a `spiel` reference: `sieger` or `verlierer`, exactly two values.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielQuelle`.\
**Trap:** `verlierer` exists because a third-place play-off is fed by two losing semi-finals, and nothing writes it in this season's bracket; a level match with no shoot-out has neither outcome, so a reference to either resolves to nobody and the slot stays empty.\
**See:** backend spec I23.

### `disqualifikation` — out of one season, with the reason

**Is:** an embedded record on the `saison_teams` junction carrying `grund`, the reason as free text, and `datum`, the day it took effect — so a team is disqualified for a season rather than permanently.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLTeam`, joined from the junction.\
**Trap:** its absence is the null and no boolean records the same fact anywhere; `grund` is public and rendered as authored; and `GET /teams?is_disqualified=` is a question the backend turns into a null test, not this field.\
**See:** backend spec I31.

### `is_nachgetragen` — entered later, retrospectively added

**Is:** a marker on a squad entry added after the season had already started.\
**In code:** `fl_backend/app/api/spieler/schemas.py :: FLSpieler`, stored on the `saison_spieler` junction.\
**Trap:** every junction payload requires it with no default, and the admin create form derives it from the chosen season's status rather than asking, so it is always an answer rather than a value nobody chose.\
**See:** backend spec I34 for the junction's write path.

### `is_captain` — the squad's captain for one season

**Is:** captaincy as a role within one team for one season, held on the `saison_spieler` junction rather than on the person.\
**In code:** `fl_backend/app/api/spieler/schemas.py :: FLSpieler`.\
**Trap:** it is unique by no rule the database enforces — a co-captaincy is a real arrangement — and `fl_backend/app/api/spieler/schemas.py :: PERSON_NAME_PATTERN` on the write payloads is what stops a captaincy marker being typed inside a name instead.\
**See:** backend spec I36 for the write-payload name pattern.

### `inactive_since` — the day something left

**Is:** a nullable `YYYY-MM-DD` string on `teams`, `spieler`, `saison_spieler`, `spieltage`, `spielorte` and `schiedsrichter`, where null means current and a date means retired on that day.\
**In code:** `fl_backend/app/core/constraints.py`, which requires the field in each of those validators.\
**Trap:** it is a date and never a boolean, it is on no payload — `DELETE` stamps it and `reactivate` clears it — and creating never revives a retired row, so a natural-key collision comes back 409; leaving one season is a `disqualifikation`, which is a different thing.\
**See:** backend spec I12 for the shape, I20 for the create that never revives.

### `Statistik` — the derived league-table figures

**Is:** matches played, wins, losses, draws, goals scored, goals conceded, points, and a count of the fixtures that were called off — computed per team and per season from the `spiele` documents on every read.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLTeamStatistik`, built by `fl_backend/app/api/teams/services.py :: build_team_pipeline`.\
**Trap:** nothing stores it, so there is no field to update and nothing to back-fill; a match counts exactly when it carries an `ergebnis`, points come from the season's `rules` rather than a hardcoded 3/1/0, and which of the two tables you get is `statistik_scope`, whose default is the narrow `gruppenphase` one. `anzahl_abgesagte_spiele` is the one figure `is_canceled` decides, it includes a forfeit and therefore overlaps the match tally rather than partitioning it, and it reaches no other figure — a fixture merely not played yet is not in it and is not stored anywhere.\
**See:** backend spec I1 for the derivation, I1c for the default scope.

### `Mietpreis` — rental price

**Is:** the venue's cost in whole euros, an `int` with `ge=0`.\
**In code:** `fl_backend/app/api/spielorte/schemas.py :: FLSpielort`.\
**Trap:** it has no default on the backend model, deliberately — the admin patch writes the payload back wholesale, so a default would let a request that omitted the field overwrite a real rent with `0`.\
**See:** backend spec I6.

### `Payment` — referee fee

**Is:** the referee's fee in whole euros, an `int` with `ge=0`.\
**In code:** `fl_backend/app/api/schiedsrichter/schemas.py :: FLSchiedsrichter`.\
**Trap:** the same shape and the same reasoning as `Mietpreis` — no default, for the same wholesale-write reason.\
**See:** backend spec I6.

### `saison_teams` · `saison_spieler` — the season junctions

**Is:** two collections with no model of their own, joined at read time and never returned directly, which is what makes "a team" and "a player" season-scoped concepts although their base documents are not.\
**In code:** `fl_backend/app/core/collections.py :: Collection`.\
**Trap:** the two behave differently on the way out — `saison_spieler` carries `inactive_since` because a player leaves a squad, while `saison_teams` has no DELETE at all and disqualification is the only way out of a season; and a junction row is addressed under its entity at `/teams/{team_id}/saisons/{saison_id}`, where the `saisons` segment names a junction row rather than a season document — except for the group swap, which writes two `saison_teams` rows at once and so is addressed on the season.\
**See:** backend spec I19 for the missing DELETE, I7 for the routers, I38 for the swap.

---

## Terms that are not domain vocabulary

Words that look like domain terms and are not.

| Term                        | Actually                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `slice`                     | A frontend code-organisation unit under `src/features/`, one per business entity                                        |
| `surface`                   | A documentation term: frontend, backend, or ops. See [`_standard/chapters/3-corpus.md`](_standard/chapters/3-corpus.md) |
| `base` / `system` / `admin` | The three API key tiers, not user roles. See the backend spec                                                           |
| `format`                    | The discriminator on the teams response (`list` · `grouped`, or `single` from `GET /teams/{id}`)                        |
