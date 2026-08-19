# Glossary

**Verified against:** `4393dba3`, 2026-08-19\
**Purpose:** the German domain vocabulary — what each term is, where it lives, and what catches people.

The vocabulary appears verbatim in collection names, schema fields, API parameters and URLs. Translating
it in your head is fine; translating it in code is not.

| Section                              | Answers                                          |
| ------------------------------------ | ------------------------------------------------ |
| Core entities                        | What each stored entity is                       |
| Attributes and values                | What a field on one of them means                |
| Terms that are not domain vocabulary | What a word that only looks like one actually is |

**The ones that most often cost an hour:** `Spieltag` is not `Spiel` · a `Team` document is
season-independent · `"playoffs"` is not a stored value · a cancelled match with a result still counts
· `inactive_since` is a date, never a boolean.

---

## Core entities

### `Saison` — the competition year

**Is:** the year everything else hangs off, carrying the `rules` that configure the scoring, the groups, the qualifiers and the eligible school levels.\
**In code:** `fl_backend/app/api/saisons/schemas.py :: FLSaison`; the schedule its rules imply is `fl_backend/app/api/saisons/schedule.py :: knockout_phases_for`.\
**Trap:** the id is a four-character string rather than an ObjectId, and every `saison_id` is held to exactly that length — a longer one validates on the season and then makes every match and matchday pointing at it fail to read.\
**See:** backend spec I5 for the length, I18 for the single path to `status`.

### `Spiel` — one match

**Is:** the central entity — fixtures, results, the league table and the bracket are all views of matches.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpiel` stored, `FLSpielJoined` served; `fl_frontend/src/features/spiele/schemas.ts :: FLSpielSchema` mirrors the served shape alone.\
**Trap:** both teams are embedded rather than referenced, so a rename fans out into every match document; either side is null while its occupant is unknown; and a season's fixtures are created once, so `/spiele` has no POST and no DELETE.\
**See:** backend spec I32 for the joined field, I26 for the two absences.

### `Spieltag` — matchday, fixture round

**Is:** a block of matches inside a season, with a date range and a phase.\
**In code:** `fl_backend/app/api/spieltage/schemas.py :: FLSpieltag`, ordered by `fl_backend/app/api/spieltage/services.py :: order_spieltage`, labelled by `fl_frontend/src/features/spieltage/utils.ts :: spieltagLabel`.\
**Trap:** it carries no position, no name and no match count — all three are derived, so moving one means editing its phase or its `beginn`, and `anzahl_spiele` cannot be sorted on.\
**See:** [backend spec §1.1](backend/spec.md#11-endpoint-inventory) for the payloads that carry none of the three.

### `Team` — club

**Is:** a club, **season-independent**: its group, its disqualification and its table are assembled at read time from a junction row and from the matches.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLTeam`, flattened by `fl_backend/app/api/teams/services.py :: build_team_pipeline`.\
**Trap:** with a `saison_id` in play the junction join is strict, so a team with no `saison_teams` row for that season disappears from the results entirely rather than appearing with an empty table.\
**See:** backend spec I11, and [`domain.md`](domain.md) for the aggregate.

### `Spieler` — player

**Is:** a person, whose season-specific facts — squad membership, captaincy, retirement — live on a `saison_spieler` junction rather than on the person.\
**In code:** `fl_backend/app/api/spieler/schemas.py :: FLSpieler`, flattened by `fl_backend/app/api/spieler/services.py :: build_spieler_pipeline`.\
**Trap:** only `vorname` is required and `nummer` is free text; `FLSpieler` is one player against one season and carries no `saison_id`, so the admin list reads `GET /spieler/memberships` instead.\
**See:** backend spec I33 for that read, I35 for the closed sets.

### `Schiedsrichter` — referee

**Is:** a referee, embedded on a match as `{schiedsrichter_id, name, payment}`.\
**In code:** the `schiedsrichter` collection — `fl_backend/app/core/collections.py :: Collection`.\
**Trap:** deletion is soft, and a rename must fan out into the embedded copy on every match carrying it.\
**See:** backend spec I13.

### `Spielort` — venue, playing location

**Is:** a venue, embedded on a match as `{spielort_id, name, maps_link, mietpreis}`.\
**In code:** the `spielorte` collection — `fl_backend/app/core/collections.py :: Collection`.\
**Trap:** `maps_link` is **not** a URL despite the name — free text built server-side and searched on Google Maps, so it carries no scheme check.\
**See:** backend spec I13.

---

## Attributes and values

### `Tore` — goals

**Is:** the goals each side scored, `None` while the match is unplayed.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpiel`; `tore_geschossen` and `tore_kassiert` in the statistics are scored and conceded.\
**Trap:** —\
**See:** backend spec I1.

### `Ergebnis` — result, final score

**Is:** the score as a string — `"3:1"`, or null when unplayed — derived server-side from the two `tore` values.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpiel`, mirrored by `fl_frontend/src/features/spiele/schemas.ts :: FLSpielSchema`.\
**Trap:** both ends constrain it to `^[0-9]+:[0-9]+$`, the class deliberately `[0-9]` rather than `\d`, whose Unicode-aware backend reading would accept digits `Number()` turns into `NaN`; the frontend matches that pattern rather than splitting on `":"`, because a bare colon would read as a 0:0 draw.\
**See:** backend spec I3, and I25 for why a shoot-out is never in this string.

### `Elfmeterschießen` — penalty shoot-out

**Is:** `elfmeterschiessen` on a match — the shoot-out's own scoreline, null on every match that did not finish level.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielElfmeterschiessen`, mirrored by `fl_frontend/src/features/spiele/schemas.ts :: FLSpielSchema`.\
**Trap:** its two readers disagree on purpose — the bracket takes a winner from the counts so a level knockout advances a side, while the league table never consults them and scores the fixture as the draw it was; a level shoot-out is refused, and a record stored against a group match or a decided one is discarded.\
**See:** backend spec I25 and I25a.

### `Gruppe` — a group within a season

**Is:** the closed set `A` · `B` · `C` · `D` on the `saison_teams` junction; a season runs the first `rules.number_of_groups` of them.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLGruppenNames`.\
**Trap:** the grouped response is seeded with all four keys even where a group holds no teams, because the frontend schema requires all four and an unseeded group would take down `/dashboard/saisontabelle`; and teams arrive already in standing order, so re-sorting a group anywhere is a second answer to who finished second.\
**See:** backend spec I10 for the seeded keys, I24 for the ranking chain.

### `spiel_nr` — a match's number within its season

**Is:** an `int` with `gt=0` on a match, and a `sort_by` key.\
**In code:** `fl_backend/app/core/constraints.py :: uniq_saison_id_spiel_nr`.\
**Trap:** it is unique within a season rather than globally, and every season starts again at 1 — which is why `resolve_bracket` must be given exactly one season, and why a `Quelle` references a match by this number rather than by `_id`.\
**See:** backend spec I15 for the unique index behind it.

### `saison_phase` — stage of the season

**Is:** the stored set `gruppenphase` · `achtelfinale` · `viertelfinale` · `halbfinale` · `finale`, declared in bracket order so each knockout round feeds the next.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: PHASE_ORDER`; which rounds a season plays is `fl_backend/app/api/saisons/schedule.py :: knockout_phases_for`.\
**Trap:** `"playoffs"` is **not** one of them — a query-only alias compiled to `saison_phase != "gruppenphase"`, on no stored document; and `GET /teams` takes `statistik_scope` rather than this filter.\
**See:** backend spec I1c for the table's default scope.

### `spiel_status` — match status

**Is:** `ausstehend` · `vergangen` · `heute` · `abgesagt` · `unbekannt`, derived on both ends and stored nowhere.\
**In code:** `fl_backend/app/api/spiele/services.py :: build_spiele_filter` compiles the filter; `fl_frontend/src/features/spiele/utils.ts :: computeSpielStatus` derives the label.\
**Trap:** the two definitions differ on purpose — the server's `ausstehend` is `datum >= today` and **includes** today, the client's is `datum > today` and **excludes** it, because a filter selects while a label partitions; and `unbekannt` as a filter returns everything, no branch matching it.\
**See:** [backend spec §1.2](backend/spec.md#12-get-spiele-parameters) for the filter each value compiles to.

### `is_canceled` / `abgesagt` — called off, and still countable

**Is:** a boolean on the match saying the fixture was called off.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpiel`.\
**Trap:** it is not a delete — the match keeps its row, its `spiel_nr` and its bracket slot — and a cancelled match carrying a result still counts in the table, because the figures the table is scored and sorted on do not consult this field; the one figure it decides is `anzahl_abgesagte_spiele`, so a forfeit lands in that count and in the match tally both.\
**See:** backend spec I1a for what the table ignores, I1d for the cancellation count.

### `Quelle` — where a side of a fixture comes from

**Is:** `team1_quelle` and `team2_quelle` — a structural reference naming what feeds that side of the bracket, a group placing or a match outcome, never display text.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielQuelle`, resolved by `fl_backend/app/api/spiele/services.py :: resolve_bracket`, rendered by `fl_frontend/src/features/spiele/utils.ts :: formatQuelle`.\
**Trap:** it is not paired with the team field beside it — all four combinations are legitimate stored states — and while a reference stands it owns the slot, so a hand-set team is a 409 and is reverted on the next save. Clearing the reference is the only manual override.\
**See:** backend spec I22 for the independence, I28 for the faults a resolution reports.

### `Platz` — a placing in a group's standing

**Is:** `platz` inside a `gruppe` reference — `1` the group winner, `2` the runner-up; an `int` with `gt=0` and no upper bound.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielQuelle`.\
**Trap:** it counts only teams that can hold a placing, so a disqualified team keeps its table row while the place falls to the team below, and a team with no match that counts or still could holds no placing at all; a `platz` the group can never produce is reported rather than refused.\
**See:** backend spec I24b.

### `Ausgang` — which side of a match a reference names

**Is:** `ausgang` inside a `spiel` reference: `sieger` or `verlierer`.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielQuelle`.\
**Trap:** `verlierer` exists because a third-place play-off is fed by two losing semi-finals, and nothing writes it in this season's bracket; a level match with no shoot-out has neither outcome, so a reference to either resolves to nobody and the slot stays empty.\
**See:** backend spec I23.

### `disqualifikation` — out of one season, with the reason

**Is:** a record on the `saison_teams` junction carrying `grund` and `datum`, so a team is disqualified for a season rather than permanently.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLTeam`, joined from the junction.\
**Trap:** its absence is the null and no boolean records the same fact anywhere; `grund` is public and rendered as authored; and `GET /teams?is_disqualified=` is turned into a null test rather than reading a field.\
**See:** backend spec I31.

### `is_nachgetragen` — entered later, retrospectively added

**Is:** a marker on a squad entry added after the season had already started.\
**In code:** `fl_backend/app/api/spieler/schemas.py :: FLSpieler`, on the `saison_spieler` junction.\
**Trap:** every junction payload requires it with no default, and the admin create form derives it from the chosen season's status rather than asking, so it is always an answer rather than a value nobody chose.\
**See:** backend spec I34.

### `is_captain` — the squad's captain for one season

**Is:** captaincy within one team for one season, held on the `saison_spieler` junction rather than on the person.\
**In code:** `fl_backend/app/api/spieler/schemas.py :: FLSpieler`.\
**Trap:** no rule the database enforces makes it unique — a co-captaincy is a real arrangement — and `fl_backend/app/api/spieler/schemas.py :: PERSON_NAME_PATTERN` on the write payloads is what stops a captaincy marker being typed inside a name instead.\
**See:** backend spec I36 for the write-payload name pattern.

### `inactive_since` — the day something left

**Is:** a nullable `YYYY-MM-DD` string on `teams`, `spieler`, `saison_spieler`, `spieltage`, `spielorte` and `schiedsrichter`, where null means current.\
**In code:** `fl_backend/app/core/constraints.py`, which requires the field in each of those validators.\
**Trap:** a date and never a boolean, and on no payload — `DELETE` stamps it, `reactivate` clears it — so creating never revives a retired row and a natural-key collision comes back 409; leaving one season is a `disqualifikation`, a different thing.\
**See:** backend spec I12 for the shape, I20 for the create that never revives.

### `Statistik` — the derived league-table figures

**Is:** the league table's figures — played, won, drawn, lost, goals for and against, points, cancellations — computed per team and season from `spiele` on every read.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLTeamStatistik`, built by `fl_backend/app/api/teams/services.py :: build_team_pipeline`.\
**Trap:** nothing stores it, so there is no field to update and nothing to back-fill; a match counts exactly when it carries an `ergebnis`, points come from the season's `rules` rather than a hardcoded 3/1/0, and `statistik_scope` decides which table you get, defaulting to the narrow `gruppenphase` one.\
**See:** backend spec I1 for the derivation, I1c for the default scope.

### `mietpreis` · `default_mietpreis` — rental price

**Is:** two fields and never one copy — `mietpreis` is what one fixture paid for its venue, carried on the copy a match embeds; `default_mietpreis` is the venue's own current price. Both are an `int` with `ge=0`.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielOrtField` carries `mietpreis`; `fl_backend/app/api/spielorte/schemas.py :: FLSpielort` carries `default_mietpreis`.\
**Trap:** a venue's price change never fans out into the matches although its name and `maps_link` do, because the embedded figure records what _that_ fixture cost; and neither field carries a Pydantic default, because both patches write the payload back wholesale and a default would overwrite a real rent with `0`.\
**See:** backend spec I6, and [`domain.md`](domain.md) for the fan-out this is deliberately left out of.

### `payment` · `default_payment` — referee fee

**Is:** the same split as `mietpreis` — `payment` is what one fixture paid its referee, `default_payment` the referee's own current fee. Both are an `int` with `ge=0`.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielSchiedsrichterField` carries `payment`; `fl_backend/app/api/schiedsrichter/schemas.py :: FLSchiedsrichter` carries `default_payment`.\
**Trap:** no default on either, and no fan-out, for `mietpreis`'s reasons.\
**See:** backend spec I6.

### `saison_teams` · `saison_spieler` — the season junctions

**Is:** two collections with no model of their own, joined at read time and never returned directly — which is what makes "a team" and "a player" season-scoped at all.\
**In code:** `fl_backend/app/core/collections.py :: Collection`.\
**Trap:** they differ on the way out — `saison_spieler` carries `inactive_since` because a player leaves a squad, while `saison_teams` has no DELETE and disqualification is the only way out of a season. A junction row is addressed under its entity at `/teams/{team_id}/saisons/{saison_id}`, where `saisons` names the junction row rather than a season — except the group swap, which writes two rows at once and so is addressed on the season.\
**See:** backend spec I19 for the missing DELETE, I7 for the routers, I38 for the swap.

---

## Terms that are not domain vocabulary

| Term                        | Actually                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `slice`                     | A frontend code-organisation unit under `src/features/`, one per business entity                                        |
| `surface`                   | A documentation term: frontend, backend, or ops. See [`_standard/chapters/3-corpus.md`](_standard/chapters/3-corpus.md) |
| `base` / `system` / `admin` | The three API key tiers, not user roles. See the backend spec                                                           |
| `format`                    | The discriminator on the teams response (`list` · `grouped`, or `single` from `GET /teams/{id}`)                        |
