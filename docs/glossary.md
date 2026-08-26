# Glossary

**Verified against:** `f6073b6f`, 2026-08-26\
**Purpose:** the German domain vocabulary — what each term is, where it lives, and what catches people.

The vocabulary appears verbatim in collection names, schema fields, API parameters and URLs. Translating
it in your head is fine; translating it in code is not.

| Section                              | Answers                                          |
| ------------------------------------ | ------------------------------------------------ |
| Core entities                        | What each stored entity is                       |
| Attributes and values                | What a field on one of them means                |
| Terms that are not domain vocabulary | What a word that only looks like one actually is |

**The ones that most often cost an hour:** `Spieltag` is not `Spiel` · a `Team` document is
season-independent · `"playoffs"` is not a stored value · a no-show still counts in the table
· `inactive_since` is a date, never a boolean.

---

## Core entities

### `Saison` — the competition year

**Is:** the year everything else hangs off, carrying the `rules` that configure the scoring, the groups, the qualifiers, the squad cap, the award a no-show hands over and the eligible school levels.\
**In code:** `fl_backend/app/api/saisons/schemas.py :: FLSaison`; the schedule its rules imply is `fl_backend/app/api/saisons/schedule.py :: knockout_phases_for`.\
**Trap:** the id is a short fixed-length string rather than an ObjectId (`fl_backend/app/shared/schemas/bounds.py :: SAISON_ID_LENGTH`), and every model that ACCEPTS one holds it to that length — but a junction row echoing a stored id does not, deliberately, because a read model refusing one stored row would answer 500 for the whole list it appears in. So an id of the wrong length that reaches the database by a route holding it to nothing is echoed back without complaint, while every match and matchday carrying it fails to read.\
**See:** backend spec I5 for the length, I18 for the single path to `status`.

### `Spiel` — one match

**Is:** the central entity — fixtures, results, the league table and the bracket are all views of matches.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpiel` stored, `:: FLSpielJoined` served to the base tier and `:: FLSpielJoinedAdmin` to the match editor; the frontend mirrors are `fl_frontend/src/features/spiele/schemas.ts :: FLSpielSchema` and `:: FLSpielAdminSchema`.\
**Trap:** both teams are embedded rather than referenced, so a club rename fans out into the matches of every season that is not `past` and a finished season keeps the name it was played under; the embedded name rides on no payload and is composed from the season's junction row on every write; either side is null while its occupant is unknown; and `/spiele` has no POST and no DELETE — a season's fixtures are written by its draw and removed only by a confirmed replace of that draw or an undraw of it, both season-scoped and declaring neither verb.\
**See:** backend spec I13 for the fan-out and its scope, I32 for the joined field, I26 for the two absences.

### `Spieltag` — matchday, fixture round

**Is:** a block of matches inside a season, carrying a phase and, once somebody sets one, a date range.\
**In code:** `fl_backend/app/api/spieltage/schemas.py :: FLSpieltag`, ordered by `fl_backend/app/api/spieltage/services.py :: order_spieltage`, labelled by `fl_frontend/src/features/spieltage/utils.ts :: spieltagLabel`.\
**Trap:** `position` is STORED and orders matchdays within one PHASE, so the numbers restart at 1 in every round and `uniq_saison_id_saison_phase_position` is what keeps two matchdays off one slot — the season's draw writes it and no payload carries it afterwards, and nothing renumbers a matchday — a confirmed replace removes the season's whole list and draws a fresh one, and an undraw removes that list and writes none back; `beginn` and `ende` are null until an admin dates the matchday, and an undated one states no span for a fixture to fall outside of; the name and the match count carry no field at all, the label being composed by the reader and `anzahl_spiele` derived from the season's rules, which is why neither can be sorted on.\
**See:** the `Spielplan` entry below for what creates a matchday and what removes one, and [backend spec §1.1](backend/spec.md#11-endpoint-inventory) for the one write it takes afterwards.

### `Team` — club

**Is:** a club. The `teams` document is **season-independent** and carries the club as it stands today; its group, its `austritt`, the name and shorthand one season was played under, and its table are assembled at read time from a junction row and from the matches.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLTeam`, flattened by `fl_backend/app/api/teams/services.py :: build_team_pipeline`.\
**Trap:** with a `saison_id` in play the junction join is strict, so a team with no `saison_teams` row for that season disappears from the results entirely rather than appearing with an empty table; and the `name` that read serves is the junction's, so a club renamed after a season finished still reads there under the name it played under. `GET /teams/memberships` is the club-centric read and serves the club's own name instead.\
**See:** backend spec I11, and [`domain.md`](domain.md) for the aggregate.

### `Spieler` — player

**Is:** a person, whose season-specific facts — squad membership, captaincy, retirement — live on a `saison_spieler` junction rather than on the person.\
**In code:** `fl_backend/app/api/spieler/schemas.py :: FLSpieler` is the stored person flattened against one season and reaches no endpoint; `:: FLSpielerPublic` is what `fl_backend/app/api/spieler/services.py :: build_spieler_pipeline` projects for the base tier.\
**Trap:** only `vorname` is required and `nummer` is free text; the base tier reads a surname as an initial (`READ-PUPIL-001`) and is served no `stufe` (`READ-PUPIL-002`), no consent record and neither `is_nachgetragen` nor `rolle`, so no public squad list names a captain; and `FLSpieler` is one player against one season and carries no `saison_id`, so the admin list reads `GET /spieler/memberships` instead.\
**See:** backend spec I33 for that read, I35 for the closed sets.

### `Schiedsrichter` — referee

**Is:** a referee, embedded on a match as `{schiedsrichter_id, name, payment}` — the shape the DOCUMENT stores, which the match payload does not mirror and which a base-tier fixture read serves without the `payment`.\
**In code:** the `schiedsrichter` collection — `fl_backend/app/core/collections.py :: Collection`; the embedded copy is `fl_backend/app/api/spiele/schemas.py :: FLSpielSchiedsrichterField`, narrowed to `:: FLSpielSchiedsrichterFieldPublic` for the base tier.\
**Trap:** deletion is soft and stays soft under a privacy request — every match embeds the referee's name and id, so an anonymisation nulls the members of `kontakt` in place while the row and its name stand, where a pupil, whom no match embeds, is erased outright; a rename must fan out into the embedded copy on every match carrying it — every season's, unlike a club's, because a referee is not season-scoped; and the collection's own read is admin-tier, a referee being a pupil whose `kontakt` and `schule` are private (`READ-CONTACT-001`) beside a `default_payment` that is money (`READ-MONEY-001`).\
**See:** backend spec I13 for the fan-out, I3 for what the match payload carries instead.

### `Spielort` — venue, playing location

**Is:** a venue, embedded on a match as `{spielort_id, name, maps_link, mietpreis}` — the shape the DOCUMENT stores, which the match payload does not mirror and which a base-tier fixture read serves without the `mietpreis`.\
**In code:** the `spielorte` collection — `fl_backend/app/core/collections.py :: Collection`; the embedded copy is `fl_backend/app/api/spiele/schemas.py :: FLSpielOrtField`, narrowed to `:: FLSpielOrtFieldPublic` for the base tier.\
**Trap:** `maps_link` is **not** a URL despite the name — free text built server-side and searched on Google Maps, so it carries no scheme check — and it is the venue's whole postal address in one string, composed by `fl_backend/app/api/spielorte/admin_router.py :: _maps_link` from the name and the address's own `fl_backend/app/shared/schemas/addresses.py :: to_string`. It rides on every base-tier fixture read that names a venue, while the collection's own read, structured `address` included, is admin-tier (`READ-ADDRESS-001`).\
**See:** backend spec I13 for the fan-out, I3 for what the match payload carries instead.

### `Aktion` — one recorded write, and what it replaced or removed

**Is:** a row of the `aktionen` collection — one write, carrying the actor it is attributed to (an admin session, or the system where no request made it), the route, the collection, the operation, and the image of what the write replaced or removed.\
**In code:** `fl_backend/app/core/recording.py :: record_write` appends it from `fl_backend/app/core/crud.py`, which every write passes through; `fl_backend/app/api/aktionen/schemas.py :: FLAktion` is the shape served back.\
**Trap:** each fan-out is ONE row, carrying the filter it ran and a count and no pre-image at all, so nothing can restore a document from it — and a club rename issues a fan-out per collection pass beside the row for the club itself, every one of them sharing that rename's correlation id, which is what gathers them into a single action on the page; and that filter is text rendered for a reader rather than a query anything can replay. A removal is the one row carrying an image PER document it took, or none at all where it was an erasure, whose image would be a fresh copy of exactly what the erasure destroyed. And a row outliving its subject is the point everywhere but a person: a pupil's erasure reaches in here, empties the values in place and stamps `redacted_at`, and no row is ever dropped.\
**See:** backend spec I40 for what a fan-out records, I48 for what a removal records and I42 for the redaction, and [`domain.md`](domain.md) for why the collection sits in no consistency boundary.

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

**Is:** `elfmeterschiessen` on a match — the shoot-out's own scoreline, null on every match that did not finish level and on every no-show, whose award is composed rather than played.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielElfmeterschiessen`, mirrored by `fl_frontend/src/features/spiele/schemas.ts :: FLSpielSchema`.\
**Trap:** its two readers disagree on purpose — the bracket takes a winner from the counts so a level knockout advances a side, while the league table never consults them and scores the fixture as the draw it was; a level shoot-out is refused, and a record stored against a group match or a decided one is discarded.\
**See:** backend spec I25 and I25a.

### `Gruppe` — a group within a season

**Is:** the closed set `A` · `B` · `C` · `D` on the `saison_teams` junction; a season runs the first `rules.number_of_groups` of them.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLGruppenNames`.\
**Trap:** the grouped response is seeded with all four keys even where a group holds no teams, because the frontend schema requires all four and an unseeded group would take down `/dashboard/saisontabelle`; and teams arrive already in standing order, so re-sorting a group anywhere is a second answer to who finished second.\
**See:** backend spec I10 for the seeded keys, I24 for the ranking chain.

### `Spielplan` — a season's whole draw

**Is:** every matchday and every fixture of one season, composed in one operation from that season's `rules` and the clubs entered into it: round _k_ of every group is matchday _k_, so the groups play in step, and each knockout round that follows is one further matchday whose sides are `Quelle` references rather than teams. Nothing it writes carries a date.\
**In code:** `fl_backend/app/api/saisons/spielplan.py :: draw_spielplan` composes the documents, `fl_backend/app/api/saisons/services.py :: find_spielplan_refusal` decides whether a season may be drawn at all, and `fl_backend/app/api/saisons/schemas.py :: FLSaisonSpielplan` is the watermark the season keeps afterwards.\
**Trap:** the watermark is a record rather than the guard, so a repeat draw is measured against the FIXTURES and one made by any other route is caught too — which is what lets a season drawn by hand be replaced at all. A second draw is refused unless the request CONFIRMS a replace, which `REQ-SPIELPLAN-005` holds to a `future` season with nothing recorded: it removes the season's fixtures and matchdays and draws fresh ones in one transaction (I46, I48). An UNDRAW removes the same two lists in that same window (`REQ-SPIELPLAN-006`) and clears this field rather than restamping it, which is what returns a season to undrawn. The field is null on every season stored before the draw existed, which is why it sits outside the validator's `required` list.\
**See:** [backend spec §1.1](backend/spec.md#11-endpoint-inventory) for both endpoints and I26 for the verbs `/spiele` declares neither of, [`logging/error-codes.md`](logging/error-codes.md) for the refusals they raise, and [`domain.md`](domain.md) for what an undraw reopens.

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
**Trap:** the two definitions differ on purpose — the server's `ausstehend` is `datum >= today` and **includes** today, the client's is `datum > today` and **excludes** it, because a filter selects while a label partitions; `unbekannt` as a filter returns everything, no branch matching it; and `abgesagt` is not the whole of `sonderereignis` — an abandoned fixture took place, so it reads by its date like any other.\
**See:** [backend spec §1.2](backend/spec.md#12-get-spiele-parameters) for the filter each value compiles to.

### `sonderereignis` — what happened to a fixture beyond being played

**Is:** `ausgefallen` · `nichtantreten_team1` · `nichtantreten_team2` · `abgebrochen` · `annulliert`, or `null` where there is nothing to say.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSonderereignis`, with one named member set per consumer beside it.\
**Trap:** it is not a delete — the match keeps its row, its `spiel_nr` and its bracket slot — and no member of it reaches the figures the table is scored and sorted on; a no-show counts because its goals are composed from `rules.forfeit_ergebnis`, while `ausgefallen` and `annulliert` may carry no result at all. The one figure the field decides is `anzahl_abgesagte_spiele`, which counts the fixtures that did not take place — every member but `abgebrochen`.\
**See:** backend spec I1a for what the table ignores, I1d for the cancellation count, I3a for the composed forfeit.

### `Quelle` — where a side of a fixture comes from

**Is:** `team1_quelle` and `team2_quelle` — a structural reference naming what feeds that side of the bracket, a group placing or a match outcome, never display text.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielQuelle`, resolved by `fl_backend/app/api/spiele/services.py :: resolve_bracket`, rendered by `fl_frontend/src/features/spiele/utils.ts :: formatQuelle`.\
**Trap:** it is not paired with the team field beside it — all four combinations are legitimate stored states — and while a reference stands it owns the slot, so a hand-set team is a 409 and is reverted on the next save. Clearing the reference is the only manual override.\
**See:** backend spec I22 for the independence, I28 for the faults a resolution reports.

### `Platz` — a placing in a group's standing

**Is:** `platz` inside a `gruppe` reference — `1` the group winner, `2` the runner-up; an `int` with `gt=0` and no upper bound.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielQuelle`.\
**Trap:** it counts only teams that can hold a placing, so a team that has left the season keeps its table row while the place falls to the team below, and a team with no match that counts or still could holds no placing at all; a `platz` the group can never produce is reported rather than refused.\
**See:** backend spec I24b.

### `Ausgang` — which side of a match a reference names

**Is:** `ausgang` inside a `spiel` reference: `sieger` or `verlierer`.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielQuelle`.\
**Trap:** `verlierer` exists because a third-place play-off is fed by two losing semi-finals, and nothing writes it in this season's bracket; a level match with no shoot-out has neither outcome, so a reference to either resolves to nobody and the slot stays empty.\
**See:** backend spec I23.

### `austritt` — out of one season, by which route and from when

**Is:** a record on the `saison_teams` junction carrying `type`, `grund` and `datum`, so a team is out of one season rather than out of the league, and the record says which of the two routes out it took — `disqualifikation` or `rueckzug`.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLAustritt`, joined from the junction; the German for each route is `fl_frontend/src/features/teams/constants.ts :: AUSTRITT_OPTIONS`, which every surface reads rather than writing its own.\
**Trap:** its absence is the null and no boolean records the same fact anywhere; replacing the club clears the record, which left standing would mark the INCOMING club withdrawn; every rule keyed on a club having left reads `datum` and never `type`, so a withdrawal keeps a club off a later fixture exactly as a sanction does; `grund` is public and rendered as authored; and `GET /teams?has_austritt=` is turned into a null test on the whole record, so it selects on having left by either route, `austritt_type=` beside it being what narrows to one of them — two independent terms rather than one nested under the other, so naming a route needs no boolean with it.\
**See:** backend spec I31.

### `is_nachgetragen` — entered later, retrospectively added

**Is:** a marker on a squad entry added after the season had already started.\
**In code:** `fl_backend/app/api/spieler/schemas.py :: FLSaisonSpielerRow`, the `saison_spieler` row's own declared shape.\
**Trap:** every junction payload requires it with no default, and the admin create form derives it from the chosen season's status rather than asking, so it is always an answer rather than a value nobody chose.\
**See:** backend spec I34.

### `rolle` — which of a squad's leading roles a player holds

**Is:** the Kapitän or the Co-Kapitän of one team for one season, held on the `saison_spieler` junction rather than on the person. ONE nullable closed set rather than a flag per role, so holding both at once is unrepresentable rather than refused, and null — holding neither — is the ordinary state.\
**In code:** `fl_backend/app/api/spieler/schemas.py :: FLSpielerRolle`, on `:: FLSaisonSpielerRow` beside `is_nachgetragen`; the German for each value and the Kürzel the phone layout shows in its place are `fl_frontend/src/features/spieler/constants.ts :: ROLLE_OPTIONS`, which every surface reads rather than spelling its own.\
**Trap:** a squad holds each role at most once among its LIVE rows and every squad write path refuses one already held (`REQ-SQUAD-004`), so a role is handed on by taking it off its current holder or retiring them; it is the one `saison_spieler` key the validator leaves out of `required`, a missing key and a stored null both reading as no role; and `fl_backend/app/shared/schemas/custom.py :: PERSON_NAME_PATTERN` on the write payloads is what stops the marker being typed inside a name instead.\
**See:** backend spec I35 for the closed sets, I36 for the write-payload name pattern.

### `inactive_since` — the day something left

**Is:** a nullable `YYYY-MM-DD` string on `teams`, `spieler`, `saison_spieler`, `spielorte` and `schiedsrichter`, where null means current.\
**In code:** `fl_backend/app/core/constraints.py`, which requires the field in each of those validators.\
**Trap:** a date and never a boolean, and on no payload — `DELETE` stamps it, `reactivate` clears it — so creating never revives a retired row and a natural-key collision comes back 409; leaving one season is an `austritt`, a different thing. The one `DELETE` that does not stamp it is a pupil's erasure, which removes the person and their squad rows outright and is refused until this field is set (`REQ-PURGE-001`), the reversible step having to have been taken and left standing first.\
**See:** backend spec I12 for the shape, I20 for the create that never revives.

### `Statistik` — the derived league-table figures

**Is:** the league table's figures — played, won, drawn, lost, goals for and against, points, cancellations — computed per team and season from `spiele` on every read.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLTeamStatistik`, built over a read of `spiele` by `fl_backend/app/api/teams/services.py :: build_team_pipeline`, and over fixtures a caller already holds by `fl_backend/app/api/teams/services.py :: build_statistik_by_team` — the bracket resolution's preview.\
**Trap:** nothing stores it, so there is no field to update and nothing to back-fill; a match counts exactly when it carries an `ergebnis`, points come from the season's `rules` rather than a hardcoded 3/1/0, and `statistik_scope` decides which table you get, defaulting to the narrow `gruppenphase` one.\
**See:** backend spec I1 for the derivation, I1c for the default scope.

### `mietpreis` · `default_mietpreis` — rental price

**Is:** two fields and never one copy — `mietpreis` is what one fixture paid for its venue, carried on the copy a match embeds; `default_mietpreis` is the venue's own current price. Both are an `int` with `ge=0`.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielOrtFieldPayload` carries `mietpreis`, and the stored `:: FLSpielOrtField` declares it again over `:: FLSpielOrtFieldPublic`, the base-tier read shape without it; `fl_backend/app/api/spielorte/schemas.py :: FLSpielort` carries `default_mietpreis`.\
**Trap:** `mietpreis` is **submitted** where the `name` and `maps_link` beside it on the same embedded venue are composed by the server (I3) — it is what _that_ fixture agreed to pay rather than a copy of anything, which is also why a venue's price change never fans out although its name and `maps_link` do. Neither field carries a Pydantic default, because both patches write their payload back wholesale and a default would overwrite a real rent with `0`.\
**See:** backend spec I6 and I3, [backend spec §1.1](backend/spec.md#11-endpoint-inventory) for which fixture read serves it, and [`domain.md`](domain.md) for the fan-out this is deliberately left out of.

### `payment` · `default_payment` — referee fee

**Is:** the same split as `mietpreis` — `payment` is what one fixture paid its referee, `default_payment` the referee's own current fee. Both are an `int` with `ge=0`.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielSchiedsrichterFieldPayload` carries `payment`, and the stored `:: FLSpielSchiedsrichterField` declares it again over `:: FLSpielSchiedsrichterFieldPublic`, the base-tier read shape without it; `fl_backend/app/api/schiedsrichter/schemas.py :: FLSchiedsrichter` carries `default_payment`.\
**Trap:** no default on either, no fan-out, `payment` stays on the match payload while the `name` beside it is composed, and the base tier is served without it — every one of them for `mietpreis`'s reasons.\
**See:** backend spec I6.

### `saison_teams` · `saison_spieler` — the season junctions

**Is:** two collections joined at read time into a team or a player, which is what makes "a team" and "a player" season-scoped at all. Neither is read through a model: `saison_teams` has none at all, its fields declared by the `$jsonSchema` validator alone, and `saison_spieler`'s is a declared shape no stored row is validated against.\
**In code:** `fl_backend/app/core/collections.py :: Collection`, with the row's fields in `fl_backend/app/core/constraints.py :: COLLECTION_VALIDATORS` and `saison_spieler`'s declared shape in `fl_backend/app/api/spieler/schemas.py :: FLSaisonSpielerRow`. Each junction's own write endpoints echo the row back — `fl_backend/app/api/teams/schemas.py :: FLSaisonTeamResponse` and `fl_backend/app/api/spieler/schemas.py :: FLSaisonSpielerResponse`, each assembled from what the write just stored rather than being a model the stored row is read through.\
**Trap:** they differ on the way out — `saison_spieler` carries `inactive_since` because a player leaves a squad — one row at a time by hand, or a whole squad at once when a club is REPLACED in a season, those players not having transferred with the fixtures — and is removed outright only by that person's erasure, while `saison_teams` has no DELETE: a club leaves a season by an `austritt` record, or by a replacement repointing its row at another club, and the row itself survives both. A junction row is addressed under its entity at `/teams/{team_id}/saisons/{saison_id}`, where `saisons` names the junction row rather than a season — except the group swap, which writes two rows at once and so is addressed on the season.\
**See:** backend spec I19 for the missing DELETE, I7 for the routers, I38 for the swap.

---

## Terms that are not domain vocabulary

| Term                        | Actually                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `slice`                     | A frontend code-organisation unit under `src/features/`, one per business entity                                        |
| `surface`                   | A documentation term: frontend, backend, or ops. See [`_standard/chapters/3-corpus.md`](_standard/chapters/3-corpus.md) |
| `base` / `system` / `admin` | The three API key tiers, not user roles. See the backend spec                                                           |
| `format`                    | The discriminator on the teams response (`list` · `grouped`, or `single` from `GET /teams/{id}`)                        |
