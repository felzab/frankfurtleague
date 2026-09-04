# Glossary

**Purpose:** the German domain vocabulary — what each term is, where it lives, and what catches people.

Translating it in your head is fine; translating it in code is not.

| Section                                                                       | Answers                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------ |
| [Core entities](#core-entities)                                               | What each stored entity is                       |
| [Attributes and values](#attributes-and-values)                               | What a field on one of them means                |
| [Terms that are not domain vocabulary](#terms-that-are-not-domain-vocabulary) | What a word that only looks like one actually is |

**The ones that most often cost an hour:** `Spieltag` is not `Spiel` · a `Team` document is
season-independent · `"playoffs"` is not a stored value · a no-show still counts in the table
· `inactive_since` is a date, never a boolean.

---

## Core entities

### `Saison` — the competition year

**Is:** the year everything else hangs off, carrying the `rules` that configure how it is played — and, outside `rules`, the `bewerbung` window saying when a school may apply to play it.\
**In code:** `fl_backend/app/api/saisons/schemas.py :: FLSaison` over the writable half both payloads share, `:: _SaisonWritable`; the application window is `:: FLSaisonBewerbung`, and the schedule the rules imply is `fl_backend/app/api/saisons/schedule.py :: knockout_phases_for`.\
**Trap:** the id is a short fixed-length string rather than an ObjectId (`fl_backend/app/shared/schemas/bounds.py :: SAISON_ID_LENGTH`), and every model that ACCEPTS one AS DATA TO STORE holds it to that length. Backend spec I5 names the kinds that deliberately do not: a model echoing a stored id, because one refusing a stored row would answer 500 for the whole list it appears in, and a LIST FILTER, which matches rather than stores. So an id of the wrong length that reaches the database by a route holding it to nothing is echoed back without complaint, while every match and matchday carrying it fails to read. The application window carries an asymmetry of its own: `_SaisonWritable` declares `bewerbung` with NO default, so a PATCH omitting the key is refused rather than silently closing a window somebody opened, while `FLSaison` re-declares it with one, every season stored before the field carrying neither key nor value.\
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
**Trap:** the junction join is strict and there is no other kind — `build_team_pipeline` refuses a call carrying no `saison_id` rather than joining leniently, a season-less join returning one row per season played and a table of zeros beside it — so a team with no `saison_teams` row for the season disappears from the results entirely rather than appearing with an empty table; and the `name` that read serves is the junction's, so a club renamed after a season finished still reads there under the name it played under. `GET /teams/memberships` is the club-centric read and serves the club's own name instead.\
**See:** backend spec I11, and [`domain.md`](domain.md) for the aggregate.

### `Spieler` — player

**Is:** a person, whose season-specific facts — squad membership, captaincy, retirement — live on a `saison_spieler` junction rather than on the person.\
**In code:** `fl_backend/app/api/spieler/schemas.py :: FLSpieler` is the stored person flattened against one season and reaches no endpoint; `:: FLSpielerPublic` is what `fl_backend/app/api/spieler/services.py :: build_spieler_pipeline` projects for the base tier.\
**Trap:** only `vorname` is required and `nummer` is free text; the base tier reads a surname as an initial (`READ-PUPIL-001`) and is served no `stufe` (`READ-PUPIL-002`), no consent record and neither `is_nachgetragen` nor `rolle`, so no public squad list names a captain; and `FLSpieler` is one player against one season and carries no `saison_id`, so the admin list reads `GET /spieler/memberships` instead.\
**See:** backend spec I33 for that read, I35 for the closed sets.

### `Schiedsrichter` — referee

**Is:** a referee, embedded on a match as `{schiedsrichter_id, name, payment}` — the shape the DOCUMENT stores, which the match payload does not mirror and which a base-tier fixture read serves without the `payment` and with the surname cut to an initial.\
**In code:** the `schiedsrichter` collection — `fl_backend/app/core/collections.py :: Collection`; the embedded copy is `fl_backend/app/api/spiele/schemas.py :: FLSpielSchiedsrichterField`, narrowed to `:: FLSpielSchiedsrichterFieldPublic` for the base tier.\
**Trap:** deletion is soft and stays soft under a privacy request — every match embeds the referee's name and id, so an anonymisation nulls the members of `kontakt` and writes a neutral label over the name, on the row and on every match, where a pupil, whom no match embeds, is erased outright; a rename must fan out into the embedded copy on every match carrying it — every season's, unlike a club's, because a referee is not season-scoped; and the collection's own read is admin-tier, a referee being a pupil whose `kontakt` and `schule` are private (`READ-CONTACT-001`) beside a `default_payment` that is money (`READ-MONEY-001`).\
**See:** backend spec I13 for the fan-out, I3 for what the match payload carries instead.

### `Spielort` — venue, playing location

**Is:** a venue, embedded on a match as `{spielort_id, name, maps_link, mietpreis}` — the shape the DOCUMENT stores, which the match payload does not mirror and which a base-tier fixture read serves without the `mietpreis`.\
**In code:** the `spielorte` collection — `fl_backend/app/core/collections.py :: Collection`; the embedded copy is `fl_backend/app/api/spiele/schemas.py :: FLSpielOrtField`, narrowed to `:: FLSpielOrtFieldPublic` for the base tier.\
**Trap:** `maps_link` is **not** a URL despite the name — free text built server-side and searched on Google Maps, so it carries no scheme check — and it is the venue's whole postal address in one string, composed by `fl_backend/app/api/spielorte/admin_router.py :: _maps_link` from the name and the address's own `fl_backend/app/shared/schemas/addresses.py :: to_string`. It rides on every base-tier fixture read that names a venue, while the collection's own read, structured `address` included, is admin-tier (`READ-ADDRESS-001`).\
**See:** backend spec I13 for the fan-out, I3 for what the match payload carries instead.

### `Bewerbung` — a school's application to play a season

**Is:** one school's application to play one season, stored as it arrived: the triage moves `status`, `entscheidung` and `team_id`, a contact erasure empties the slot naming the person who asked for it, and nothing else on the document moves at all. The opponent it would like on the first Spieltag is a FREE STRING and never a reference: a school may name an applicant nobody has accepted yet, and a picker over the accepted ones would give a later applicant the longer list.\
**In code:** `fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbung`, the stored shape; `POST /bewerbungen` in `fl_backend/app/api/bewerbungen/public_router.py` is what creates one, and the two decisions are `POST /bewerbungen/{bewerbung_id}/annehmen` and `.../ablehnen` in `fl_backend/app/api/bewerbungen/admin_router.py`.\
**Trap:** **while the application still stands `eingereicht`**, exactly one of `team_id` and `schule` carries a value — the club the applicant picked, or the school they propose — and no validator of types and enums can say so, which is why acceptance judges it and refuses the rest (`REQ-BEWERBUNG-002`) rather than branching on an assumption. Acceptance is IRREVERSIBLE, `saison_teams` having no DELETE, so a second decision on either endpoint is refused (`REQ-BEWERBUNG-001`) rather than entering the club again; it writes the created club's id back into `team_id` and leaves `schule` where it stood, so a decided application always names a club and an accepted new school's names both. No route serves a STORED application to the base tier, unlike `spiele`: an application holds three people's email addresses and telephone numbers, a date of birth per seat that stays null until that person enters it, and says which schools asked and were turned down. The collection is not closed to that tier, though — the public form's create is base-tier and echoes nothing of what it wrote (`READ-BEWERBUNG-001`).\
**See:** backend spec I16 for what a validator may assert, which is why the exclusive pair is the write path's, and [`domain.md`](domain.md) for the boundary this collection is held true in.

### `Aktion` — one recorded write, and what it replaced or removed

**Is:** a row of the `aktionen` collection — one write, carrying the actor it is attributed to — an admin session, the public where the request authenticates nobody, or the system where no request made it at all — the route, the collection, the operation, and the image of what the write replaced or removed.\
**In code:** `fl_backend/app/core/recording.py :: record_write` appends it from `fl_backend/app/core/crud.py`, which every write passes through; `fl_backend/app/api/aktionen/schemas.py :: FLAktion` is the shape served back.\
**Trap:** each fan-out is ONE row, carrying the filter it ran and a count and no pre-image at all, so nothing can restore a document from it — and a club rename issues a fan-out per collection pass beside the row for the club itself, every one of them sharing that rename's correlation id, which is what gathers them into a single action on the page; and that filter is text rendered for a reader rather than a query anything can replay. A removal is the one row carrying an image PER document it took, or none at all where it was an erasure, whose image would be a fresh copy of exactly what the erasure destroyed. And a row outliving its subject is the point everywhere but a person: every write that destroys a person's values reaches in here in the same transaction, empties the images in place and stamps `redacted_at`, and no row is ever dropped.\
**See:** backend spec I40 for what a fan-out records, I48 for what a removal records, I42 for the redaction and I119 for the log only growing, and [`domain.md`](domain.md) for why the collection sits in no consistency boundary.

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
**Trap:** its absence is the null and no boolean records the same fact anywhere; replacing the club clears the record, which left standing would mark the INCOMING club withdrawn; no rule keyed on a club having left reads `type`, so a withdrawal keeps a club off a later fixture exactly as a sanction does — what a rule reads is the record's presence (`fl_backend/app/api/teams/services.py :: _may_hold_a_platz`) or its `datum` (`fl_backend/app/api/spiele/services.py :: find_departed_occupants`), and `type` reaches a reader only as something reported; `grund` is public and rendered as authored (`READ-FREETEXT-002`); and `GET /teams?has_austritt=` is turned into a null test on the whole record, so it selects on having left by either route, `austritt_type=` beside it being what narrows to one of them — two independent terms rather than one nested under the other, so naming a route needs no boolean with it.\
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

### `schulform` — which kind of school a club is

**Is:** a closed set of school-kind slugs, or null where nobody has recorded it. It sits on the season-independent `teams` document and, in the same spelling, on the club a new school proposes in its application. G8 and G9 are told apart because they are two school careers rather than two names for one building.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLSchulform`, declared on `:: _TeamWritable`, which both write payloads inherit, and re-declared with a default on the two read models so a club whose document predates the field still reads; the application's copy is `fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungSchule`; the German for each value is `fl_frontend/src/features/teams/constants.ts :: SCHULFORM_OPTIONS`, which every surface reads rather than spelling its own.\
**Trap:** on `teams` it is the one key the validator leaves out of `required`, so a missing key and a stored null both read as unrecorded rather than as a school of no kind; inside an application the KEY is required and its STORED value nullable instead, which is what says a school stated no kind rather than that nobody has recorded one — a null the public form cannot produce, `fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungSchulePayload` narrowing the field to non-null on the write alone. A club's NAME settles at most half of it — `Gymnasium` says nothing about whether that school runs G8 or G9 — so what cannot be derived from a name is left null for a person to set in the editor rather than guessed.\
**See:** backend spec I16 for why the validator carries the enum and no length, and [`ops/runbooks.md`](ops/runbooks.md) §2 for the order a constraint change runs in.

### `trikot_farbe` — the kit colour a club plays a season in

**Is:** one of the league's own colours as a slug, held on the `saison_teams` junction and assigned by an administrator, or null before one is.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLTrikotFarbe`, declared on the junction's `$jsonSchema` in `fl_backend/app/core/constraints.py` because that row has no model of its own, and on `fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungTrikot` for the wish; the German name and the hex for each value are `fl_frontend/src/features/teams/constants.ts :: TRIKOT_FARBE_OPTIONS`.\
**Trap:** an application's `trikot.wunschfarbe` is the same closed set in a different role — what a school ASKED for — and nothing copies it across: acceptance takes the colour it assigns from its own payload, because a wish is not an assignment and two schools may wish for one colour. The wish is REQUIRED on the public payload and nullable everywhere else (`fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungTrikotPayload`): the form asks a school to choose, while the stored shape and the read models keep the null a season's row carries until an administrator assigns one. Which colours a season has already ASSIGNED is readable from the public tier through `GET /bewerbungen/trikotfarben/{saison_id}`, so a form can offer the rest — off the junction, never off another application's wish (`READ-BEWERBUNG-001`). The vocabulary is the league's corporate identity, not a form's — `Grün` and `Magenta`, never `Dunkelgrün` or `Pink`. The hex beside a slug is drawing data and is stored nowhere, so nothing reads a colour back as a value. On the junction it sits outside the validator's `required` for `schulform`'s reason.\
**See:** backend spec I16, and [`backend/overview.md`](backend/overview.md) for why this junction's fields are transcribed by hand.

### `kontakte` — the three people the league reaches a team through

**Is:** a block of three slots — an Ansprechperson, a Stellvertretung and a Trainer — beside a declaration naming which OTHER seat the Trainer also holds, or nobody, held on TWO collections from one pair of declarations: nullable as a whole on a `saison_teams` row, which is entered before anybody has been recorded, and required on an application, which IS the form those people filled in.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLSaisonTeamKontakte` over `:: FLKontaktperson` and `:: FLKontaktEinwilligung`, tightened for a write by `:: FLSaisonTeamKontaktePayload` and imported rather than restated by `fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbung`; both validators are built from `fl_backend/app/core/constraints.py :: _KONTAKTE_REQUIRED` and `:: _KONTAKTE_PROPERTIES`. A junction row's three are entered on a page of their own, `fl_frontend/src/features/kontakte/components/forms/AdminKontakteEditForm/FormKontakteSection.tsx`, which the club's season panel links to rather than holding a field of; an accepted application's arrive with the row acceptance writes, and `POST /kontakte/erasure` is what takes one person out of both collections.\
**Trap:** each slot is nullable on its own on the stored shape and on the JUNCTION's write — an application's payload requires all three, non-null (`fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungKontaktePayload`) — so an erasure can empty the slot naming one person without reaching the two beside them, and a row it emptied still saves — a payload requiring all three would have made every later edit to that row re-collect the person who asked to be forgotten. On a junction row, three whole people in a block filled in for the first time is `FormKontakteSection.tsx`'s guarantee rather than the payload's; on an application it is the payload's, and `trainer_ist_zugleich` stands through an erasure, recording what somebody asserted rather than what the block now holds. Season-scoped and never carried forward: these are one cohort's people, so a new season collects them again rather than inheriting them, and a replacement clears the block rather than handing the outgoing school's people to the incoming one. `FLKontaktEinwilligung` is deliberately not the `einwilligung` a pupil carries: that one records what may be PUBLISHED about a person, this one only that these details may be held and used, and entangling them would put a club's contacts behind an open question about pupil data. A seat's `geburtsdatum` is null until its person enters it at the confirmation, and the public form never asks for it — `fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungKontaktpersonPayload` refuses the key outright rather than taking a null, while the junction editor's `fl_backend/app/api/teams/schemas.py :: FLKontaktpersonPayload` still requires one (I141). `erteilt_von` and `bestaetigt_am` are the server's on every write path (I142): `administrativ` on every seat at submission, and the junction editor keeps a confirmed seat's pair only where the address it confirmed is the address being written, so a seat handed to another mailbox starts unconfirmed. The junction join withholds this block from the base tier inside the `$lookup` rather than at a later stage, a club's public read being one aggregation away from it otherwise.\
**See:** backend spec I50 for the withholding at the join and I137 for what a replacement clears, [`backend/overview.md`](backend/overview.md) for the junction having no stored-document model, and [`domain.md`](domain.md) for where a season-scoped fact belongs.

### `inactive_since` — the day something left

**Is:** a nullable `YYYY-MM-DD` string on `teams`, `spieler`, `saison_spieler`, `spielorte` and `schiedsrichter`, where null means current.\
**In code:** `fl_backend/app/core/constraints.py`, which requires the field in each of those validators.\
**Trap:** a date and never a boolean, and on no payload — `DELETE` stamps it, `reactivate` clears it — so creating never revives a retired row and a natural-key collision comes back 409; leaving one season is an `austritt`, a different thing. The German verb pair is fixed: _stilllegen_ retires the entity across the whole league, _austragen_ takes one `saison_spieler` row out of one season's squad — each stamps this field on its own collection, and a name or a sentence about a squad row takes the second verb, never the first (`fl_backend/app/api/teams/schemas.py :: FLReplaceSaisonTeamResponse` counts `ausgetragene_squad_rows`). The one `DELETE` that does not stamp it is a pupil's erasure, which removes the person and their squad rows outright and is refused until this field is set (`REQ-PURGE-001`), the reversible step having to have been taken and left standing first.\
**See:** backend spec I12 for the shape, I20 for the create that never revives.

### `Statistik` — the derived league-table figures

**Is:** the league table's figures, computed per team and season from `spiele` on every read.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLTeamStatistik`, built over a read of `spiele` by `fl_backend/app/api/teams/services.py :: build_team_pipeline`, and over fixtures a caller already holds by `fl_backend/app/api/teams/services.py :: build_statistik_by_team` — the bracket resolution's preview.\
**Trap:** nothing stores it, so there is no field to update and nothing to back-fill; a match counts exactly when it carries an `ergebnis`, points come from the season's `rules` rather than a hardcoded 3/1/0, and `statistik_scope` decides which table you get, defaulting to the narrow `gruppenphase` one.\
**See:** backend spec I1 for the derivation, I1c for the default scope.

### `mietpreis` · `default_mietpreis` — rental price

**Is:** two fields and never one copy — `mietpreis` is what one fixture paid for its venue, carried on the copy a match embeds; `default_mietpreis` is the venue's own current price. Both are an `int` with `ge=0`.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielOrtFieldPayload` carries `mietpreis`, and the stored `:: FLSpielOrtField` declares it again over `:: FLSpielOrtFieldPublic`, the base-tier read shape without it; `fl_backend/app/api/spielorte/schemas.py :: FLSpielort` carries `default_mietpreis`.\
**Trap:** `mietpreis` is **submitted** where the `name` and `maps_link` beside it on the same embedded venue are composed by the server (I3) — it is what _that_ fixture agreed to pay rather than a copy of anything, which is also why a venue's price change never fans out although its name and `maps_link` do. Neither field carries a Pydantic default, because both patches write their payload back wholesale and a default would overwrite a real rent with `0`.\
**See:** backend spec I6 and I3, [backend spec §1.1](backend/spec.md#11-endpoint-inventory) for which fixture read serves it, and [`domain.md`](domain.md) for the fan-out this is deliberately left out of.

### `payment` · `default_payment` — referee fee, `Honorar` on screen

**Is:** the same split as `mietpreis` — `payment` is what one fixture paid its referee, `default_payment` the referee's own current fee. Both are an `int` with `ge=0`.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielSchiedsrichterFieldPayload` carries `payment`, and the stored `:: FLSpielSchiedsrichterField` declares it again over `:: FLSpielSchiedsrichterFieldPublic`, the base-tier read shape without it; `fl_backend/app/api/schiedsrichter/schemas.py :: FLSchiedsrichter` carries `default_payment`; that German is spelt at each field rather than read from a table, there being one label and not a closed set of them (`fl_frontend/src/features/schiedsrichter/schiedsrichterDraftStatus.ts :: FLSchiedsrichterFieldGroup`).\
**Trap:** no default on either, no fan-out, `payment` stays on the match payload while the `name` beside it is composed, and the base tier is served without it — every one of them for `mietpreis`'s reasons.\
**See:** backend spec I6.

### `saison_teams` · `saison_spieler` — the season junctions

**Is:** two collections joined at read time into a team or a player, which is what makes "a team" and "a player" season-scoped at all. Neither has a model of the whole STORED document — `saison_teams` has none at all, its fields declared by the `$jsonSchema` validator alone, and `saison_spieler`'s is a declared shape no stored row is validated against — while the PROJECTION each `memberships` read serves is a model, and validates the stored rows it carries through it.\
**In code:** `fl_backend/app/core/collections.py :: Collection`, with the row's fields in `fl_backend/app/core/constraints.py :: COLLECTION_VALIDATORS` and `saison_spieler`'s declared shape in `fl_backend/app/api/spieler/schemas.py :: FLSaisonSpielerRow`. Each junction's own write endpoints echo the row back — `fl_backend/app/api/teams/schemas.py :: FLSaisonTeamResponse` and `fl_backend/app/api/spieler/schemas.py :: FLSaisonSpielerResponse`, each assembled from what the write just stored rather than being a model the stored row is read through; the membership projections that DO read stored rows are `fl_backend/app/api/teams/schemas.py :: FLTeamMembership` and `fl_backend/app/api/spieler/schemas.py :: FLSpielerMembership`, each defaulting the keys a row predating them has not got.\
**Trap:** they differ on the way out — `saison_spieler` carries `inactive_since` because a player leaves a squad — one row at a time by hand, or a whole squad at once when a club is REPLACED in a season, those players not having transferred with the fixtures — and is removed outright only by that person's erasure, while `saison_teams` has no DELETE: a club leaves a season by an `austritt` record, or by a replacement repointing its row at another club, and the row itself survives both. A junction row is addressed under its entity at `/teams/{team_id}/saisons/{saison_id}`, where `saisons` names the junction row rather than a season — except the group swap, which writes two rows at once and so is addressed on the season.\
**See:** backend spec I19 for the missing DELETE, I7 for the routers, I38 for the swap.

---

## Terms that are not domain vocabulary

| Term                        | Actually                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `slice`                     | A frontend code-organisation unit under `src/features/`, one per business entity                      |
| `surface`                   | A documentation term: frontend, backend, or ops. See [`standard.md`](_standard/standard.md#corpus)    |
| `base` / `system` / `admin` | The three API key tiers, not user roles. See backend spec I7                                          |
| `format`                    | The discriminator on the teams response (`list` · `grouped`, or `single` from `GET /teams/{team_id}`) |
