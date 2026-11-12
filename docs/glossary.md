# Glossary

**Purpose:** what each German word of the league and of the website means, and where it lives in
the code.

Translating it in your head is fine; translating it in code is not.

| Section                                         | Answers                                                   |
| ----------------------------------------------- | --------------------------------------------------------- |
| [Core entities](#core-entities)                 | What each stored entity is                                |
| [Attributes and values](#attributes-and-values) | What a field on one of them means                         |
| [The website's words](#the-websites-words)      | What a word for something the website does means, in code |

---

## Core entities

### `Saison` — the competition year

**Is:** the competition year, carrying the `rules` that configure how it is played and two
windows: `bewerbung`, when a school may apply to play it, and `registrierung`, when a pupil may
register for it. Its id is the year as a fixed-length string, never an ObjectId.\
**In code:** `fl_backend/app/api/saisons/schemas.py :: FLSaison`, its windows
`:: FLSaisonBewerbung` and `:: FLSaisonRegistrierung`.\
**See:** [`domain.md`](domain.md#the-life-of-a-season).

### `Spiel` — one match

**Is:** the central entity: fixtures, results, the league table and the bracket are all views of
matches. A match stores its teams' ids and no name, and is never a `Spieltag`, the round it
belongs to.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpiel` stored, `:: FLSpielJoined` and
`:: FLSpielJoinedAdmin` served.\
**See:** [`domain.md`](domain.md#what-is-stored-and-what-is-computed).

### `Spieltag` — matchday, fixture round

**Is:** a block of matches within one phase of a season, never a single `Spiel`, holding its
`position` in that phase and, once somebody sets one, a date range. Its label and its match count
are derived on read and stored nowhere.\
**In code:** `fl_backend/app/api/spieltage/schemas.py :: FLSpieltag`; the label is
`fl_frontend/src/features/spieltage/utils.ts :: spieltagLabel`.\
**See:** [`domain.md`](domain.md#what-is-held-true-together).

### `Team` — club

**Is:** a club as it stands today, in a season-independent `teams` document; its group, its
`austritt`, the name a season was played under and its table come from a `saison_teams` row and
the matches. The people who run the league are never a `Team`: on screen they are „Organisation“.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLTeam`, joined by
`fl_backend/app/api/teams/services.py :: build_team_pipeline`.\
**See:** [`domain.md`](domain.md#the-entities-and-what-holds-them-together).

### `Spieler` — player

**Is:** a person, whose season-specific facts (squad membership, captaincy, retirement) live on a
`saison_spieler` row rather than on the person. The shirt `nummer` is a string, never a number.\
**In code:** `fl_backend/app/api/spieler/schemas.py :: FLSpielerRecord` stored, `:: FLSpielerPublic`
served to the base tier.

### `Kader` — one team's squad in one season, as its own contact seats see it

**Is:** every `saison_spieler` row one team holds for one season, live and ausgetragen alike, which
the team's contact seats read and edit; the code's English for it is `squad`. The word also names
an application's `kader`, the school's estimate in two counts, a pupil's own squad row of one
season, and the consent scope `kader_public`.\
**In code:** `fl_backend/app/api/spieler/schemas.py :: FLKaderResponse` over `:: FLKaderRow`; the
other senses `fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungKader` and
`fl_backend/app/api/spieler/schemas.py :: FLSpielerSelfKaderRow`.

### `Schiedsrichter` — referee

**Is:** a referee, referenced on a match as `{schiedsrichter_id, payment}`, the referee's current
`name` joined beside it at read; a null `schiedsrichter_id` names nobody, a played match's referee
erased since.\
**In code:** `fl_backend/app/api/schiedsrichter/schemas.py :: FLSchiedsrichter`; on a match
`fl_backend/app/api/spiele/schemas.py :: FLSpielSchiedsrichterFieldRecord`.

### `Spielort` — venue, playing location

**Is:** a venue, referenced on a match as `{spielort_id, mietpreis}`, the venue's current `name`
and `maps_link` joined beside it at read. `maps_link` is not a URL: it is the venue's whole postal
address in one string, searched on Google Maps.\
**In code:** `fl_backend/app/api/spielorte/schemas.py :: FLSpielort`; on a match
`fl_backend/app/api/spiele/schemas.py :: FLSpielortFieldRecord`.

### `Bewerbung` — a school's application to play a season

**Is:** one school's application to play one season, naming either a club already in the league
(`team_id`) or a new school (`schule`), its three contact persons and its wishes, and decided once
by an administrator. It is not a `Registrierung`, a pupil's entry into a team already playing.\
**In code:** `fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbung`.\
**See:** [`domain.md`](domain.md#what-is-held-true-together).

### `Registrierung` — one pupil's registration for a team's season

**Is:** one pupil's registration to play one season for one team, submitted through that team's
`Einladung` and decided by its contact seats; `status` is `submitted` or `declined`, because an
admission deletes the row. It is not a `Bewerbung`, a school applying to play, and it puts the
pupil on no squad until a seat admits them.\
**In code:** `fl_backend/app/api/registrierungen/schemas.py :: FLRegistrierungRecord`.\
**See:** [`domain.md`](domain.md#what-is-held-true-together).

### `Spielbestätigung` · `Spielbestaetigung` — one party's answer about one Ansetzung of a fixture

**Is:** one party's answer about one `Ansetzung` of one fixture, stored as a row of
`spielbestaetigungen`: a club's, given by whichever of its confirmed contact seats answers first,
a booked referee's, or one an administrator records for either. It is not a
[`Bestätigung`](#bestätigung--confirmation--one-persons-own-answer-to-their-own-link-and-the-bookkeeping-beside-it-on-a-seat-a-registration-or-a-referee),
and it confirms nothing about the person answering.\
**In code:** `fl_backend/app/api/spielbestaetigungen/schemas.py :: FLSpielbestaetigungRecord`, its
state `fl_backend/app/api/spielbestaetigungen/services.py :: state_of`.\
**See:** [`domain.md`](domain.md#what-is-held-true-together).

### `Spielbericht` — one played fixture's report, by its referee

**Is:** one fixture's report in `spielberichte`, written by its booked referee: a proposed result
(`ergebnis_vorschlag`, never a club's `vorschlag` of a date), the goals by scorer, the cards and
remarks. It is a proposal: the fixture's result is never written from it, only by an
administrator in the match editor.\
**In code:** `fl_backend/app/api/spielberichte/schemas.py :: FLSpielbericht`.\
**See:** [`domain.md`](domain.md#what-is-held-true-together).

### `Aufstellung` — one club's line-up for one fixture

**Is:** the pupils one club fields in one fixture and which of them start, one document per club
per fixture in `aufstellungen`, entered by the club's contact seats until it locks one hour before
kick-off; an entry with a null `spieler_id` names nobody, a played match's pupil erased since. It is
no part of the `Spielbericht`, and not the `Kader` it picks from.\
**In code:** `fl_backend/app/api/aufstellungen/schemas.py :: FLAufstellung`, its clocks
`fl_backend/app/api/aufstellungen/services.py :: aufstellung_marks`.

---

## Attributes and values

### `Tore` — goals

**Is:** the goals each side scored, `None` while the match is unplayed. In the statistics
`tore_scored` and `tore_conceded` are two counts, not two spellings of one.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpiel`.

### `Ergebnis` — result, final score

**Is:** the score as a string, `"3:1"`, or null when unplayed, composed by the server from the two
`tore` values. A shoot-out is never part of it.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpiel`.

### `Elfmeterschießen` — penalty shoot-out

**Is:** `elfmeterschiessen` on a match, the shoot-out's own scoreline, null on every match that did
not finish level and on every no-show. It decides who advances in the bracket and never counts in
the table, which scores the match as the draw it was.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielElfmeterschiessen`.\
**See:** [`domain.md`](domain.md#the-competitions-own-rules).

### `Gruppe` — a group within a season

**Is:** the closed set `A` through `P` on the `saison_teams` row; a season runs the first
`rules.number_of_gruppen` of them.\
**In code:** `fl_backend/app/shared/schemas/literals.py :: FLGruppenNames`.

### `Spielplan` — a season's whole draw

**Is:** every matchday and every fixture of one season, composed in one operation from its `rules`
and the clubs entered, each knockout side a `Quelle` reference rather than a team; nothing it
writes carries a date. Whether a season is drawn is read off its stored fixtures, never off the
`spielplan` watermark, which only dates the draw.\
**In code:** `fl_backend/app/api/saisons/spielplan.py :: draw_spielplan`; the watermark
`fl_backend/app/api/saisons/schemas.py :: FLSaisonSpielplan`.\
**See:** [`domain.md`](domain.md#the-life-of-a-season).

### `spiel_nr` — a match's number within its season

**Is:** an `int` above 0 on a match, unique within its season rather than globally, by which a
`Quelle` names a match.\
**In code:** `fl_backend/app/core/constraints.py :: uniq_saison_id_spiel_nr`.

### `saison_phase` — stage of the season

**Is:** the stored set `gruppenphase` · `achtelfinale` · `viertelfinale` · `halbfinale` · `finale`,
in bracket order.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: PHASE_ORDER`.

### `sonderereignis` — what happened to a fixture beyond being played

**Is:** `ausgefallen` · `nichtantreten_team1` · `nichtantreten_team2` · `abgebrochen` ·
`annulliert`, or `null` where there is nothing to say. It is not a delete: the match keeps its row,
its `spiel_nr` and its bracket slot, and a no-show still counts in the table through its awarded
result.\
**In code:** `fl_backend/app/shared/schemas/literals.py :: FLSonderereignis`.\
**See:** [`domain.md`](domain.md#the-competitions-own-rules).

### `Paarung` — the two sides of one fixture and what they produced

**Is:** which two clubs meet in one fixture and what they produced: each side's club and goals, the
shoot-out record and the `sonderereignis`. It is neither the `Aufstellung`, the pupils a club
fields, nor the `Ansetzung`, when and where the fixture is set.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpiel`'s `team1`, `team2`,
`elfmeterschiessen` and `sonderereignis`.

### `Ansetzung` — the date, time, ground and two sides a fixture is set for

**Is:** a fixture's `date`, `time`, ground and two sides, with `digest`, a SHA-256 over those
five, as a `Spielbestätigung` answers about them; a change to any of the five is a new Ansetzung.
It is neither the `Paarung` nor the `Spieltag`.\
**In code:** `fl_backend/app/api/spielbestaetigungen/services.py :: ANSETZUNG_QUELLEN` and
`:: ansetzung_digest_of`; stored on a row as
`fl_backend/app/api/spielbestaetigungen/schemas.py :: FLSpielbestaetigungAnsetzung`.

### `Anpfiff` — kick-off

**Is:** the word the landing labels the season's opening match with: its `date`, and its `time` in
Berlin where one is set. The landing's countdown counts to the season's start, never to the
Anpfiff.\
**In code:** `fl_frontend/src/core/serverCopy.ts :: SERVER_COPY.landing.saison.opening`; the match
is `fl_backend/app/api/saisons/schemas.py :: FLLandingOpeningSpiel`.

### `Einteilung` — the message telling a referee they are booked onto one fixture

**Is:** the mail telling a booked referee of one fixture's current `Ansetzung`, owed once per
referee and Ansetzung and leading to their panel. It is not the booking, which is the match
editor's write.\
**In code:** `fl_backend/app/api/outbox/schemas.py :: FLSpielEinteilungData`; the mail
`fl_frontend/src/core/spielEmail.ts :: buildSpielEinteilungEmail`.

### `Einsatz` — a fixture a referee is booked onto, as their own Übersicht lists it

**Is:** one row of the box „Spiele“ on a referee's Übersicht of one season: a fixture booked to
them, with the newest `Spielbestätigung` row asking them about it. A fixture is one row, replaced
rather than added to when the request is renewed.\
**In code:** `fl_backend/app/api/schiedsrichter/schemas.py :: FLSchiedsrichterSpiel`, served by
`fl_backend/app/api/schiedsrichter/person_router.py :: get_self_spiele`.

### `vorschlag` — a date and hour a club proposes, and the state showing the other club's

**Is:** `answer.vorschlag`, the date and hour a club's decline proposes instead of the Ansetzung;
and, as a row's state, what a club still to answer sees while the other club's decline proposes a
date. The state never means this club proposed anything, and a proposal moves nothing.\
**In code:** `fl_backend/app/api/spielbestaetigungen/schemas.py :: FLSpielbestaetigungState` and
`:: FLSpielbestaetigungAppointment`.

### `Zusage` — one word over two acts: a club agreeing to a fixture's date, and the league accepting a school

**Is:** two acts sharing the word and nothing else: a club's or a booked referee's agreement to an
Ansetzung (`answer.kind` `agreed`, pressed as „Zusagen“), and the league's acceptance of a
`Bewerbung` and the mail announcing it. Neither is a `Bestätigung`, a person's own answer about
their own record.\
**In code:** `fl_backend/app/api/spielbestaetigungen/schemas.py :: FLSpielbestaetigungAnswerKind`;
`fl_frontend/src/core/bewerbungEmail.ts :: buildBewerbungZusageEmail`.

### `Absage` — one word over two acts: the league refusing an application, and a referee declining a booking

**Is:** the league's or a team's refusal of an application or a registration and its mail; and, in
code alone, a referee's decline of a booking (`answer.kind` `declined`), which on screen is
„Ablehnen“ and reads „Abgelehnt“. „Abgesagt“ is neither: it is a fixture called off, `cancelled`.\
**In code:** `fl_frontend/src/core/bewerbungEmail.ts :: buildBewerbungAbsageEmail`,
`fl_frontend/src/core/registrierungEmail.ts :: buildRegistrierungAbsageEmail`;
`fl_frontend/src/app/area/(person)/schiedsrichter/(liste)/[saison]/answerEinteilung.ts :: declineEinteilung`.

### `Quelle` — where a side of a fixture comes from

**Is:** `team1_quelle` and `team2_quelle`, a structural reference naming what feeds that side of
the bracket, a group placing or a match outcome, never display text. While a reference stands it
owns the slot, and clearing it is the only manual override.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielQuelle`, resolved by
`fl_backend/app/api/spiele/services.py :: resolve_bracket`.

### `Platz` — the number a club holds in a standing, or a place on the podium

**Is:** the `platz` a Tabelle row and a bracket reference carry, `1` being the group winner. It is
also a place on the podium, one to four, served by position rather than as a field.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielQuelle`;
`fl_backend/app/api/teams/schemas.py :: FLTabelleRow`; the podium
`fl_backend/app/api/saisons/schemas.py :: FLLandingDecided`.

### `Ausgang` — which side of a match a reference names

**Is:** `ausgang` inside a `spiel` reference: `sieger` or `verlierer`, `verlierer` feeding only
the match for third place. A level match with no shoot-out has neither.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielQuelle`.\
**See:** [`domain.md`](domain.md#the-competitions-own-rules).

### `Herkunft` — one German word over three unrelated origins

**Is:** the German for three origins sharing nothing but the word: what feeds a side of a knockout
fixture, the kind of actor behind a logged act, and whether an application names a new school. None
is a stored field of its own.\
**In code:** `fl_frontend/src/features/spiele/blocks.ts :: quelleWords`;
`fl_backend/app/api/action_log/schemas.py :: FLActionLogRecord`'s `by`;
`fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungListRow`'s `new_school`.

### `austritt` — out of one season, by which route and from when

**Is:** a record on the `saison_teams` row carrying `type` (`disqualifikation` or `rueckzug`),
`reason` and `date`: a team out of one season, never out of the league. Its absence is the null,
and no boolean records the same fact.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLAustritt`; its German is
`fl_frontend/src/core/copy.ts :: COPY.shared.austritt`, read through
`fl_frontend/src/features/teams/constants.ts :: austrittState` and `:: austrittChip`.\
**See:** [`domain.md`](domain.md#the-competitions-own-rules).

### `is_nachnominiert` — entered later, retrospectively added

**Is:** a marker on a squad row whose registration was submitted after the season's registration
window ended, which stands the row outside `max_kader_size`.\
**In code:** `fl_backend/app/api/spieler/schemas.py :: FLSaisonSpielerRow`; the verdict
`fl_backend/app/api/saisons/services.py :: entry_is_a_nominee`.

### `rolle` — which of a squad's leading roles a player holds

**Is:** the Kapitän or the Co-Kapitän of one team for one season, held on the `saison_spieler` row
as one nullable closed set, null being the ordinary state. On a contact seat the same word names
the seat instead.\
**In code:** `fl_backend/app/api/spieler/schemas.py :: FLSpielerRolle`; the seat's
`fl_backend/app/shared/schemas/literals.py :: FLKontaktRolle`.

### `admin_tier` — which tier of access to the league's administration a grant holds

**Is:** `owner` or `administration`, the tier a grant row holds; `owner` stands on exactly one row
and alone adds, removes and hands over administrators. In code `admin` names the administration
area, so the tier is always `admin_tier`, and it is neither `rolle` nor the session's `isAdmin`.\
**In code:** `fl_backend/app/shared/schemas/literals.py :: FLAdminTier`, held to one owner by
`fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`' `uniq_grant_owner`.

### `stufe` — which Oberstufe level a squad row records

**Is:** the Halbjahr of the Hessen Oberstufe a player is in, a nullable closed set on the
`saison_spieler` row, of which each season's `allowed_stufen` names those its squad form offers.
It is not an age, and inside `oberstufengymnasium` and `stufengroesse` the word means something
else.\
**In code:** `fl_backend/app/shared/schemas/literals.py :: FLSpielerStufe`;
`fl_backend/app/api/saisons/schemas.py :: FLSaisonRules`' `allowed_stufen`.\
**See:** [`domain.md`](domain.md#where-the-german-misleads).

### `stufengroesse` — how many pupils are in the Abi-Jahrgang the team comes from

**Is:** one number on an application: the whole Abi-Jahrgang the team comes from, pupils who will
never play included, rather than the squad it expects to field. It counts no `stufe` and is
checked against nothing once submitted.\
**In code:** `fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbung`'s `stufengroesse`.\
**See:** [`domain.md`](domain.md#where-the-german-misleads).

### `wunschgegner` — the opponent a school wishes to meet on the first Spieltag

**Is:** a school's free-text wish on its application for the side it would like to play first, or
null where it named nobody. It is a string, never a club reference, and the `Spielplan` decides
the pairings.\
**In code:** `fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbung`'s `wunschgegner`.

### `Kürzel` · `shorthand` — the three letters one club is known by

**Is:** the code a club is identified by league-wide, unique across every club, retired ones
included. A season's read serves the code its `saison_teams` row was played under, so a code on
screen is no key to look the club up by.\
**In code:** `fl_backend/app/shared/schemas/custom.py :: CustomShorthand`, held unique by
`fl_backend/app/core/constraints.py :: uniq_shorthand`.

### `schulform` — which kind of school a club is

**Is:** a closed set of school kinds on the season-independent `teams` document and on a new
school's application, G8 and G9 being two values. Null means nobody recorded one, never a school
of no kind.\
**In code:** `fl_backend/app/shared/schemas/literals.py :: FLSchulform`; its German
`fl_frontend/src/core/copy.ts :: COPY.team.schulformOption`.

### `trikot_farbe` — the kit colour a club plays a season in

**Is:** one of the league's own colours as a slug, on the `saison_teams` row, assigned by an
administrator or null before one is. An application's `trikot.wunschfarbe` is the same set as a
wish, and nothing copies it into the assignment.\
**In code:** `fl_backend/app/shared/schemas/literals.py :: FLTrikotFarbe`; names and hex
`fl_frontend/src/core/trikotFarben.ts :: TRIKOT_FARBEN`.

### `kontakte` — the three people the league reaches a team through

**Is:** three seats, an Ansprechperson, a Stellvertretung and a Trainer, with a declaration naming
which other seat the Trainer also holds, on a `saison_teams` row and on an application. They are
one season's people: a new season collects them again.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLSaisonTeamKontakte` over
`:: FLKontaktperson` and `:: FLKontaktKenntnisnahme`.\
**See:** [`domain.md`](domain.md#the-entities-and-what-holds-them-together).

### `Einwilligung` · `Kenntnisnahme` — one stored key over two vocabularies: a person's own consent, and what a contact seat was told

**Is:** the block stored under the key `einwilligung` (`scope`, `media`, `confirmed_at` and each
choice's `evidence`), which on a pupil, a referee and a pending registration is an Einwilligung,
the person's own consent. On a contact seat it is a Kenntnisnahme, an acknowledgement that the
details are held, and the seat's person's own answer to their link is a `Bestätigung`.\
**In code:** `fl_backend/app/api/spieler/schemas.py :: FLEinwilligung`;
`fl_backend/app/api/registrierungen/schemas.py :: FLRegistrierungEinwilligung`;
`fl_backend/app/api/teams/schemas.py :: FLKontaktKenntnisnahme`; the evidence
`fl_backend/app/shared/schemas/einwilligung.py :: FLEinwilligungEvidenceSet`.

### `inactive_since` — the day something left

**Is:** a nullable `YYYY-MM-DD` date on `teams`, `saison_spieler`, `spielorte` and
`schiedsrichter` marking a retired row, null while it is current: a date, never a boolean.
Retiring across the league is _stilllegen_ and taking a row out of one season's squad _austragen_,
both `retire` in code; leaving one season is an `austritt`.\
**In code:** the record model of each of those collections
(`fl_backend/app/readback.py :: RECORD_MODELS`).

### `Statistik` — the derived league-table figures

**Is:** the league table's figures, computed per team and season from `spiele` on every read and
stored nowhere. `statistik_scope` chooses the table, `gruppenphase` by default.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLTeamStatistik`, built by
`fl_backend/app/api/teams/services.py :: build_team_pipeline`.\
**See:** [`domain.md`](domain.md#what-is-stored-and-what-is-computed).

### `Sieg` · `Unentschieden` · `Niederlage` — what a played match gives a club

**Is:** a win, a draw and a loss, each worth the points the season's rules set.\
**In code:** counted as `siege`, `unentschieden` and `niederlagen` on
`fl_backend/app/api/teams/schemas.py :: FLTeamStatistik`, worth `win_points`, `draw_points` and
`loss_points` on `fl_backend/app/api/saisons/schemas.py :: FLSaisonRules`.

### `punkte` — what a club holds in the table

**Is:** a club's points in one season's table, the sum of what its wins, draws and losses are
worth. The three worths say `points`, so a search for one spelling finds none of the other's
sites.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLTeamStatistik`'s `punkte`.

### `mietpreis` · `default_mietpreis` — rental price

**Is:** two fields, never one copy: `mietpreis` is what one fixture agreed to pay for its venue, on
the copy the match embeds, and `default_mietpreis` is the venue's current price, „Mietpreis“ on
screen. A change of the venue's price never reaches a fixture.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielortFieldPayload`;
`fl_backend/app/api/spielorte/schemas.py :: FLSpielort`.\
**See:** [`domain.md`](domain.md#what-is-stored-and-what-is-computed).

### `payment` · `default_payment` — referee fee, `Honorar` on screen

**Is:** the same split as `mietpreis`: `payment` is what one fixture paid its referee, and
`default_payment` the referee's current fee.\
**In code:** `fl_backend/app/api/spiele/schemas.py :: FLSpielSchiedsrichterFieldPayload`;
`fl_backend/app/api/schiedsrichter/schemas.py :: FLSchiedsrichter`.\
**See:** [`domain.md`](domain.md#what-is-stored-and-what-is-computed).

### `saison_teams` · `saison_spieler` — the season junctions

**Is:** two collections joined at read time into a team or a player, which is what makes a team
and a player season-scoped at all. In the address `/teams/{team_id}/saisons/{saison_id}`,
`saisons` names the junction row, not a season.\
**In code:** `fl_backend/app/api/teams/schemas.py :: FLSaisonTeamRecord`;
`fl_backend/app/api/spieler/schemas.py :: FLSaisonSpielerRow`.\
**See:** [`domain.md`](domain.md#the-entities-and-what-holds-them-together).

### `Tabelle` — the league table, and the page showing it

**Is:** the screen word for one season's standings, and for the public page showing them, whose
address segment is `tabelle`.\
**In code:** `fl_frontend/src/core/routes.ts :: ROUTES.tabelle`; the figures are the `Statistik`
entry's, served by `fl_backend/app/api/saisons/public_router.py :: get_tabelle`.

### `Kontakt` — the page saying how to reach the league

**Is:** the screen word for the public page listing the league's contact channels, at `/contact`.\
**In code:** `fl_frontend/src/app/(classic)/contact/page.tsx`;
`fl_frontend/src/core/routes.ts :: ROUTES.contact` gives its address.

### `Vorstand` · `vorsitz` · `amt` — the association's board, its chairs, and each member's office

**Is:** the four members of the Frankfurt League e. V.'s board, the two chairs (`vorsitz`) first,
each with their office (`amt`) as the Impressum renders it, any two representing the association
jointly; content in code, never stored. The landing's „Vorstand“ is something else, an organiser's
role in a separate list.\
**In code:** `fl_frontend/src/core/brand.ts :: VORSTAND` and `:: VORSTAND_JOINTLY`; the landing's
`fl_frontend/src/features/meta/constants.ts :: OrganiserRole`.

### `K.-o.-Runde` · `K.-o.-Baum` — the knockout stage, and its tree

**Is:** „K.-o.-Runde“ is the screen word for a season's knockout stage, every round after the
`gruppenphase`, and for its public page, whose address segment is `ko-runde`; „K.-o.-Baum“ is the
tree its fixtures are drawn as.\
**In code:** `fl_frontend/src/core/copy.ts :: COPY.shared.kORunde` and `:: COPY.shared.kOBaum`;
`fl_frontend/src/core/routes.ts :: ROUTES.kORunde`.

---

## The website's words

| Term                        | Actually                                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slice`                     | A frontend code-organisation unit under `src/features/`, one per business entity                                                                                                                            |
| `surface`                   | A documentation term: frontend, backend, or ops, each with its folder under `docs/`                                                                                                                         |
| `base` / `system` / `admin` | The three API key tiers, not user roles. See [`backend/overview.md`](backend/overview.md#authorization)                                                                                                     |
| `format`                    | The discriminator on the teams response (`list`, or `single` from `GET /teams/{team_id}`)                                                                                                                   |
| `Aktion`                    | In code one entry is `action_log_entry` and the log is `action_log` ([its entry](#aktion--action_log_entry--one-recorded-act))                                                                              |
| `Einladung`                 | In code `invitation`, on screen „Registrierungslink“ ([its entry](#einladung--invitation--the-link-one-team-registers-its-players-through))                                                                 |
| `aufnehmen`                 | In code `admit` ([its entry](#aufnehmen--admit--a-team-taking-one-registered-pupil-into-its-squad))                                                                                                         |
| `Berechtigung`              | In code `grant` ([its entry](#berechtigung--grant--one-addresss-access-to-the-verwaltung-stored))                                                                                                           |
| `Löschung`                  | In code `erasure` ([its entry](#löschung--erasure--deleting-what-the-league-holds-about-a-person-on-a-request-or-by-the-season-after-rule))                                                                 |
| `Postausgang`               | In code `outbox`, the collection too ([its entry](#postausgang--outbox--every-mail-the-league-owes-one-row-per-recipient))                                                                                  |
| `Sperrliste`                | In code `ban_list` ([its entry](#sperrliste--ban_list--the-addresses-barred-from-signing-in-and-from-the-leagues-mail))                                                                                     |
| `Bestätigung`               | In code `confirmation` ([its entry](#bestätigung--confirmation--one-persons-own-answer-to-their-own-link-and-the-bookkeeping-beside-it-on-a-seat-a-registration-or-a-referee))                              |
| `Widerspruch`               | In code `objection`, the seat's stamp `declined_at` ([its entry](#bestätigung--confirmation--one-persons-own-answer-to-their-own-link-and-the-bookkeeping-beside-it-on-a-seat-a-registration-or-a-referee)) |
| `address_change`            | On screen „Adressänderung“, its collection `address_changes` ([its entry](#address_change--a-change-of-the-address-a-person-signs-in-on-and-the-record-it-waits-in))                                        |
| `Fassung`                   | In code `wording`, the consent module `fl_frontend/src/core/consentWordings.ts` ([its entry](#fassung--wording--one-frozen-consent-wording-a-person-was-shown-under-its-label))                             |
| `Dublette`                  | In code `duplicate` ([its entry](#dublette--duplicate--two-open-applications-the-triage-marks-as-colliding))                                                                                                |
| `subject`                   | The records one mailbox matches, composed per read ([its entry](#subject--the-data-protection-subject-one-mailbox-stands-for))                                                                              |
| `austragen`                 | In code `retire`, as `stilllegen` is ([its entry](#inactive_since--the-day-something-left))                                                                                                                 |
| `Funktion`                  | In code `role` ([its entry](#funktion--role--what-a-person-is-on-screen-the-record-that-admits-them-to-a-panel))                                                                                            |
| `Konto`                     | In code `account`, and in its address, `/account` ([its entry](#konto--account--a-signed-in-persons-account-and-the-records-of-their-own-that-admit-one))                                                   |
| `trace_id`                  | A request's id, stored on its action-log row; no screen word names it ([its entry](#trace_id--the-id-joining-one-act-to-its-requests-lines))                                                                |
| `Zustellstand`              | In code `FLOutboxDeliveryState`, the row's `delivery.state` ([its entry](#zustellstand--floutboxdeliverystate--what-became-of-the-last-message-to-one-recipient))                                           |
| `area`                      | The address segment a signed-in person's pages sit under, which no screen word names ([its entry](#area--the-address-segment-every-signed-in-persons-pages-sit-under))                                      |

### `Aktion` · `action_log_entry` — one recorded act

**Is:** a row of `action_log`, one act of the league's: when it happened (`at`), who acted (`by`,
an administrator's folded address or a role word), the closed `action`, the record's id, a `label`
of league data, a pass's `count` and the request's `trace_id`. It holds no person's name and no
address but an administrator's and a grant act's grantee's.\
**In code:** `fl_backend/app/core/recording.py :: record_act` and `:: FLAction`;
`fl_backend/app/api/action_log/schemas.py :: FLActionLogEntry`.\
**See:** [`domain.md`](domain.md#what-is-held-true-together).

### `Einladung` · `invitation` — the link one team registers its players through

**Is:** one minted registration link for one team's season, a row of `invitations` holding the
link's hashes and a revocation date, null while it stands; it names nobody. It is not a
`Bestätigung`: it authorises submitting one `Registrierung`, which the team's seats then decide. On
screen it is the „Registrierungslink“.\
**In code:** `fl_backend/app/api/invitations/schemas.py :: FLInvitationRecord`, minted by
`fl_backend/app/api/teams/admin_router.py :: post_invitation`.

### `aufnehmen` · `admit` — a team taking one registered pupil into its squad

**Is:** a contact seat's decision on one confirmed `Registrierung` of their team, pressed as
„Aufnehmen“: in one transaction it writes the person and their `Kader` row and deletes the
registration, the one write that creates a player. It is not `annehmen`, the administrator's
acceptance of a school's `Bewerbung`.\
**In code:** `fl_backend/app/api/registrierungen/person_router.py :: admit`.

### `Berechtigung` · `grant` — one address's access to the Verwaltung, stored

**Is:** a row of `grants`: one folded address, its `admin_tier`, the date it holds from
(`effective_from`) and, while a handover to it waits, `owner_from`; the one Funktion stored rather
than derived. On screen it is „Zugang“, and it is not a `Sperrliste` row.\
**In code:** `fl_backend/app/core/collections.py :: Collection.GRANTS`, read on every admin-tier
request by `fl_backend/app/api/grants/guard.py :: verify_actor_is_admin`.

### `Löschung` · `erasure` — deleting what the league holds about a person, on a request or by the season-after rule

**Is:** one erasure by two routes. „Löschung auf Anfrage“ takes every record held at an address,
and the season-after rule's hourly pass deletes a pupil's own data once none of it sits in a kept
season.\
**In code:** `fl_backend/app/api/identity/crud.py :: erase_everything`, the rule's run
`fl_backend/app/api/identity/system_router.py :: sweep_erasure`.

### `Postausgang` · `outbox` — every mail the league owes, one row per recipient

**Is:** the one queue every mail leaves through: a row names the mail's kind, its recipient, the
facts its builder renders and the record it is about, and is written in the transaction of the
write that owes it. The drain hands each row out and records what became of the message.\
**In code:** `fl_backend/app/api/outbox/schemas.py :: FLOutboxRow`, written by
`fl_backend/app/api/outbox/services.py :: enqueue_mails`.

### `Sperrliste` · `ban_list` — the addresses barred from signing in and from the league's mail

**Is:** one row per barred address: the folded address, the administrator's reason, the day and
the last season the ban covers. It bars the sign-in and the hand-out of a mail alone, and „sperren“
is done to an address, never to a person.\
**In code:** `fl_backend/app/api/ban_list/schemas.py :: FLBanListRow`; the checks
`fl_backend/app/api/ban_list/crud.py :: address_is_barred` and `:: read_barred_addresses`.

### `Bestätigung` · `confirmation` — one person's own answer to their own link, and the bookkeeping beside it on a seat, a registration or a referee

**Is:** one person's own answer to the link mailed about their own record (a contact seat, a
pending registration or a referee row), with the bookkeeping beside it: the link's hashes, the days
it was sent and chased, and its `deadline`. The link's second door, on a seat and a referee row
alone, is the `Widerspruch`: code says `objection` and stamps `declined_at`, and it is never the
Art. 21 DSGVO objection. It empties a seat at once, and a referee's entry goes at the midnight
after its link's deadline.\
**In code:** `fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungConfirmationRecord`,
`fl_backend/app/api/registrierungen/schemas.py :: FLRegistrierungConfirmationRecord`,
`fl_backend/app/api/schiedsrichter/schemas.py :: FLSchiedsrichterConfirmationRecord` and
`fl_backend/app/api/teams/schemas.py :: FLSaisonTeamConfirmationRecord`.

### `address_change` — a change of the address a person signs in on, and the record it waits in

**Is:** a change of the address every record of one person is keyed on, waiting as a record of its
own until it moves every record at that address at once. On screen it is the „Änderung“ of the
„E-Mail-Adresse“, and „Adressänderung“ in the administration. It starts on the person's account
page (`account`) or by an administrator for a lost mailbox (`waiting_period`), and the new mailbox
confirms it by a link.\
**In code:** `fl_backend/app/api/address_change/services.py :: compose_record`, moved by
`fl_backend/app/api/address_change/crud.py :: move_the_address_in_session`.

### `Fassung` · `wording` — one frozen consent wording a person was shown, under its label

**Is:** the words of one consent under the label each choice's evidence stamps as `text_version`,
A label's words never change: new words are a new label.\
**In code:** `fl_frontend/src/core/consentWordings.ts :: CONSENT_WORDINGS`;
`fl_backend/app/shared/schemas/einwilligung.py :: FLEinwilligungTextVersion`.

### `Dublette` · `duplicate` — two open applications the triage marks as colliding

**Is:** two or more `submitted` applications to one season naming the same club, marked for an
administrator to choose between, and stored nowhere. It is shown and never refused, and two new
schools are never a Dublette.\
**In code:** `fl_backend/app/api/bewerbungen/services.py :: is_duplicate`.

### `subject` — the data-protection subject one mailbox stands for

**Is:** the league records one mailbox matches (its confirmed contact seats, pupil rows and referee
rows) as three lists composed at read time, beside the flags `unconfirmed` and `barred` and the
`admin_tier` of any grant; nothing stores one. It answers records, never a count of people, and is
not yet a `Funktion`.\
**In code:** `fl_backend/app/api/identity/schemas.py :: FLSubjectResponse`, composed by
`fl_backend/app/api/identity/crud.py :: find_subject`.

### `Funktion` · `role` — what a person is on screen: the record that admits them to a panel

**Is:** one contact seat, pupil row or referee row, or administration, each admitting the signed-in
person to a panel; plural `Funktionen`, and „Funktion wechseln“ switches between them. It is
neither the wire's `subject`, which it narrows, nor `rolle`, the captaincy and the contact seat.\
**In code:** `fl_backend/app/api/identity/crud.py :: roles_of`, narrowed by
`fl_backend/app/api/identity/services.py :: grants_a_panel`;
`fl_frontend/src/core/roles.ts :: rolesOf`.

### `Konto` · `account` — a signed-in person's account, and the records of their own that admit one

**Is:** the account a person signs in to, „Konto“ on screen, at `/account` with its four pages
„Anmeldung“, „Sicherheit“, „Darstellung“ and „Deine Einträge“. A record of the person's own admits
a sign-in to it whether or not it grants a `Funktion`.\
**In code:** `fl_backend/app/api/identity/services.py :: own_entries`;
`fl_backend/app/api/identity/schemas.py :: FLSignInResponse`'s `account`.

### `trace_id` — the id joining one act to its request's lines

**Is:** the trace id of the request that made an act, stored on its action-log row, which nginx
mints per request as thirty-two lowercase hex characters.\
**In code:** `fl_backend/app/core/recording.py :: record_act` stamps it;
`fl_backend/app/api/action_log/schemas.py :: FLActionLogRecord` holds it.

### `Zustellstand` · `FLOutboxDeliveryState` — what became of the last message to one recipient

**Is:** what the mail provider reported about one message the Postausgang sent (`delivered`,
`delayed`, `undeliverable`, `suppressed` or `complaint`), held on that mail's `outbox` row beside
the row's own `state`. It is not a seat's `Stand`, which is what the person did.\
**In code:** `fl_backend/app/api/outbox/schemas.py :: FLOutboxDelivery` over
`:: FLOutboxDeliveryState`, written by `fl_backend/app/api/outbox/system_router.py :: post_event`.

### `area` — the address segment every signed-in person's pages sit under

**Is:** `/area`, the first address segment of the pages a person reaches by signing in, which no
screen word names; `team`, `spieler` and `schiedsrichter` follow it, each with a season. Its
`team` is a club's seats in one season, never the `Team` document.\
**In code:** `fl_frontend/src/app/area/`; `fl_frontend/src/proxy.ts :: config`.
