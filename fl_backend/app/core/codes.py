"""Every refusal code a failure body carries, each the one spelling of its reason.

The published document lists them once, as the failure body's `error_code`.
"""

from enum import StrEnum


class Code(StrEnum):
    DOCUMENT_NOT_FOUND = "DB-COMMON-001"
    DUPLICATE_KEY = "DB-COMMON-002"
    # A save carrying the `version` its form was read at, which another write has since raised: the record changed since it
    # was opened, a removal included.
    VERSION_STALE = "DB-COMMON-003"
    NO_DATABASE_CLIENT = "DB-CONN-001"
    DATABASE_FAILED = "DB-FAIL-001"
    # A write that may stand: its own code, because a page told "failed" sends the person to repeat a
    # write that is already there.
    UNKNOWN_OUTCOME = "DB-FAIL-002"
    # Activating demotes the incumbent to `past`, whose rules then freeze (`REQ-RULES-005`).
    ACTIVATE_SAISON_UNFINISHED = "REQ-ACTIVATE-001"
    # No escape, and no demotion endpoint beside it: both keep the state reachable, and this is the one
    # operation that can reopen a finished season's points, groups and table. A season closed by mistake
    # is repaired at the database.
    ACTIVATE_TARGET_PAST = "REQ-ACTIVATE-002"
    # The pair to `REQ-SPIELPLAN-003`: that one lets a running season still be drawn, and this one keeps
    # a season from going live undrawn in the first place.
    ACTIVATE_TARGET_UNDRAWN = "REQ-ACTIVATE-003"
    # Every matchday rather than the first alone: a season goes public with a whole calendar, and a
    # league running `active` with nothing dated enters every late addition as an ordinary one.
    ACTIVATE_SPIELTAGE_UNDATED = "REQ-ACTIVATE-004"
    ADRESSWECHSEL_UNBEKANNT = "REQ-ADRESSWECHSEL-001"
    ADRESSWECHSEL_BEENDET = "REQ-ADRESSWECHSEL-002"
    ADRESSWECHSEL_ABGELAUFEN = "REQ-ADRESSWECHSEL-003"
    # 403 where `-009` is 409: this caller is the barred person, and nothing they change lifts it.
    ADRESSWECHSEL_BESTAETIGUNG_GESPERRT = "REQ-ADRESSWECHSEL-004"
    # Its own code and never `-004`'s: the barred address here is the one on file, which the caller may not even hold.
    ADRESSWECHSEL_ERSETZTE_GESPERRT = "REQ-ADRESSWECHSEL-005"
    ADRESSWECHSEL_VERGEBEN = "REQ-ADRESSWECHSEL-006"
    ADRESSWECHSEL_UNVERAENDERT = "REQ-ADRESSWECHSEL-007"
    ADRESSWECHSEL_GESPERRT = "REQ-ADRESSWECHSEL-009"
    ADRESSWECHSEL_NICHTS = "REQ-ADRESSWECHSEL-010"
    ADRESSWECHSEL_KEIN_GENEHMIGER = "REQ-ADRESSWECHSEL-011"
    ADRESSWECHSEL_KEINE_GENEHMIGUNG_OFFEN = "REQ-ADRESSWECHSEL-012"
    # 403: the refusal is about who asks, and another administrator's press is what lifts it.
    ADRESSWECHSEL_GENEHMIGUNG_VERWEHRT = "REQ-ADRESSWECHSEL-013"
    ADRESSWECHSEL_GENEHMIGUNG_INHABER = "REQ-ADRESSWECHSEL-014"
    ADRESSWECHSEL_NICHT_GEDECKT = "REQ-ADRESSWECHSEL-015"
    ADRESSWECHSEL_NEUE_BERECHTIGT = "REQ-ADRESSWECHSEL-016"
    # 403 as `-013`: about who asks; an administrator holding their grant since before the start lifts it.
    ADRESSWECHSEL_GENEHMIGUNG_JUENGER = "REQ-ADRESSWECHSEL-017"
    ADRESSWECHSEL_BELEGT = "REQ-ADRESSWECHSEL-018"
    ANSETZUNG_TOKEN_UNKNOWN = "REQ-ANSETZUNG-001"
    ANSETZUNG_BEANTWORTET = "REQ-ANSETZUNG-002"
    ANSETZUNG_FRIST_VORBEI = "REQ-ANSETZUNG-003"
    ANSETZUNG_GEAENDERT = "REQ-ANSETZUNG-004"
    ANSETZUNG_ENTSCHIEDEN = "REQ-ANSETZUNG-005"
    ANSETZUNG_VORSCHLAG_VERGANGEN = "REQ-ANSETZUNG-007"
    ANSETZUNG_GESCHLOSSEN = "REQ-ANSETZUNG-009"
    ANSETZUNG_GESPERRT = "REQ-ANSETZUNG-011"
    ANSETZUNG_NICHT_EINTRAGBAR = "REQ-ANSETZUNG-013"
    ANSETZUNG_NICHT_VERWERFBAR = "REQ-ANSETZUNG-014"
    ANSETZUNG_FREMDE_ZEILE = "REQ-ANSETZUNG-015"
    MISSING_TOKEN = "REQ-AUTH-001"
    WRONG_BASE_KEY = "REQ-AUTH-002"
    WRONG_SYSTEM_KEY = "REQ-AUTH-003"
    WRONG_ADMIN_KEY = "REQ-AUTH-004"
    MISSING_ACTOR = "REQ-AUTH-005"
    ACTOR_NOT_ADMIN = "REQ-AUTH-006"
    ACTOR_TOKEN_REFUSED = "REQ-AUTH-007"
    PERSON_BARRED = "REQ-AUTH-008"
    CONFIRMATION_REQUIRED = "REQ-AUTH-009"
    BERECHTIGUNG_VORHANDEN = "REQ-BERECHTIGUNG-001"
    # A revoke never removes an `owner` row: an owner is demoted by another owner, or steps down, first, so the tier stays
    # out of an administrator's reach; only an erasure and an address change's move remove one.
    BERECHTIGUNG_INHABER = "REQ-BERECHTIGUNG-002"
    BERECHTIGUNG_GESPERRT = "REQ-BERECHTIGUNG-003"
    BERECHTIGUNG_MINDESTZAHL = "REQ-BERECHTIGUNG-004"
    # 403 and not 409: the refusal is about who asks, and granting the asker `owner` is what lifts it.
    BERECHTIGUNG_NUR_INHABER = "REQ-BERECHTIGUNG-005"
    # 409: the grants' state, and promoting another owner first is what lifts it.
    BERECHTIGUNG_LETZTER_INHABER = "REQ-BERECHTIGUNG-007"
    BERECHTIGUNG_ANTRAG_OFFEN = "REQ-BERECHTIGUNG-008"
    # 403, as the address change's approval refusals: about who asks, and another administrator's press lifts it.
    BERECHTIGUNG_GENEHMIGUNG_VERWEHRT = "REQ-BERECHTIGUNG-009"
    BERECHTIGUNG_GENEHMIGUNG_INHABER = "REQ-BERECHTIGUNG-010"
    BERECHTIGUNG_GENEHMIGUNG_JUENGER = "REQ-BERECHTIGUNG-011"
    # 409: the request's own state, which no approver lifts; a new request does.
    BERECHTIGUNG_ANTRAG_VERFALLEN = "REQ-BERECHTIGUNG-012"
    BERICHT_NICHT_GESPIELT = "REQ-BERICHT-001"
    BERICHT_NICHT_GELEITET = "REQ-BERICHT-002"
    BERICHT_NICHT_IM_KADER = "REQ-BERICHT-003"
    BERICHT_ABGESAGT = "REQ-BERICHT-004"
    # Both writes replace the whole block, so a form opened before another write would put back what that write changed.
    BERICHT_INZWISCHEN_GEAENDERT = "REQ-BERICHT-006"
    BERICHT_SAISON_BEENDET = "REQ-BERICHT-007"
    BERICHT_GRUND_FEHLT = "REQ-BERICHT-008"
    BERICHT_ELFMETER_IN_DER_GRUPPE = "REQ-BERICHT-009"
    BEWERBUNG_ALREADY_DECIDED = "REQ-BEWERBUNG-001"
    BEWERBUNG_SUBJECT_UNRESOLVED = "REQ-BEWERBUNG-002"
    BEWERBUNG_SCHULE_UNUSABLE = "REQ-BEWERBUNG-003"
    BEWERBUNG_FENSTER_GESCHLOSSEN = "REQ-BEWERBUNG-004"
    BEWERBUNG_SUBMISSION_SUBJECT_UNRESOLVED = "REQ-BEWERBUNG-005"
    BEWERBUNG_PICKED_CLUB_UNUSABLE = "REQ-BEWERBUNG-006"
    BEWERBUNG_PICKED_CLUB_ALREADY_ENTERED = "REQ-BEWERBUNG-007"
    BEWERBUNG_SHORTHAND_TAKEN = "REQ-BEWERBUNG-008"
    BEWERBUNG_TOKEN_UNKNOWN = "REQ-BEWERBUNG-009"
    # A decision is final, so the link is spent for good; a deadline a re-send restarts is not, so it
    # is a code of its own at the state's status.
    BEWERBUNG_TOKEN_DECIDED = "REQ-BEWERBUNG-010"
    BEWERBUNG_SEAT_ALREADY_ANSWERED = "REQ-BEWERBUNG-011"
    BEWERBUNG_KONTAKT_ALTER = "REQ-BEWERBUNG-012"
    BEWERBUNG_KONTAKTE_UNCONFIRMED = "REQ-BEWERBUNG-013"
    BEWERBUNG_KONTAKT_EMAIL_TAKEN = "REQ-BEWERBUNG-014"
    BEWERBUNG_SCHLUESSEL_ABWEICHEND = "REQ-BEWERBUNG-015"
    BEWERBUNG_TOKEN_PAST_DEADLINE = "REQ-BEWERBUNG-017"
    BEWERBUNG_ADRESSE_GESPERRT = "REQ-BEWERBUNG-018"
    BEWERBUNG_KONTAKT_GESPERRT = "REQ-BEWERBUNG-019"
    BEWERBUNG_EINWILLIGUNG_GESPERRT = "REQ-BEWERBUNG-020"
    BEWERBUNG_SITZ_ANDERS_BESETZT = "REQ-BEWERBUNG-021"
    # Judged on a reference the save moves, or keeps on a fixture it reopens: `REQ-RETIRE-003` lets a venue
    # retire while only played or called-off fixtures hold it, so refusing an unrelated edit of one would be false.
    BOOKING_UNKNOWN_RESOURCE = "REQ-BOOKING-001"
    # Judged on the same references: a referee booked before confirming would be mailed an Einteilung for a panel that
    # address cannot open. A code of its own, the way out being the person's confirmation rather than a reactivation.
    BOOKING_UNCONFIRMED_REFEREE = "REQ-BOOKING-002"
    # A referee's own decline empties the slot outside this route, under an editor still showing them: a wholesale save
    # keeping them would book them again unasked, and the next pass mail them for the fixture they just declined.
    BOOKING_REFEREE_MOVED = "REQ-BOOKING-003"
    FIXTURE_DOUBLE_BOOKED = "REQ-CLASH-001"
    FIXTURE_OUTSIDE_SPIELTAG = "REQ-DATE-001"
    SPIELTAG_OUTSIDE_SAISON = "REQ-DATE-002"
    # `REQ-DATE-001`'s mirror: shrinking the span is the other way to break the same containment.
    SPIELTAG_SPAN_BELOW_FIXTURES = "REQ-DATE-003"
    SAISON_SPAN_BELOW_SPIELTAGE = "REQ-DATE-004"
    # DERIVED, never an arbitrary floor: no two matchdays share a day. A one-day MATCHDAY stays legal.
    SAISON_SPAN_BELOW_SCHEDULE = "REQ-DATE-005"
    # `position` and `beginn` order a phase independently, so nothing else stops a season from showing
    # its matchdays in one order and dating them in another. `ende` is left free: it is the escape a
    # postponement takes.
    SPIELTAG_BEGINN_OUT_OF_ORDER = "REQ-DATE-008"
    SAISON_SPAN_BELOW_SCHEDULE_AS_STORED = "REQ-DATE-009"
    EINLADUNG_TEAM_NICHT_EINGETRAGEN = "REQ-EINLADUNG-001"
    EINLADUNG_SAISON_VORBEI = "REQ-EINLADUNG-002"
    # One code for a link nobody minted and one an administrator replaced, for the reason
    # `REQ-BEWERBUNG-009` gives: nothing tells a stranger's guess from a spent link, and naming which
    # would say more than the guess knew.
    EINLADUNG_UNBEKANNT = "REQ-EINLADUNG-003"
    # One code for every write that stamps a label, so a page's form maps one refusal however many
    # writes share its page.
    FASSUNG_UNZULAESSIG = "REQ-EINWILLIGUNG-001"
    # One code for every write taking a person's media consent, the account presses and the contact
    # confirmation alike, so each page maps one refusal.
    SELBST_MEDIEN_ALTER = "REQ-EINWILLIGUNG-002"
    EINWILLIGUNG_STAND_VERALTET = "REQ-EINWILLIGUNG-003"
    ERTEILUNG_NICHT_ZUGELASSEN = "REQ-EINWILLIGUNG-004"
    ELIGIBILITY_DISQUALIFIED = "REQ-ELIGIBILITY-001"
    ELIGIBILITY_NO_MEMBERSHIP = "REQ-ELIGIBILITY-002"
    ENTRY_SAISON_NOT_FUTURE = "REQ-ENTER-001"
    ENTRY_GRUPPE_NOT_OFFERED = "REQ-ENTER-002"
    ENTRY_GRUPPE_FULL = "REQ-ENTER-003"
    ENTRY_GRUPPE_LOCKED = "REQ-ENTER-004"
    CLUB_RETIRED = "REQ-ENTER-005"
    # The first refusal every person endpoint on a team's panel raises: who the caller is, so a 403
    # rather than a 409, whatever the team's own state.
    FUNKTION_NICHT_GEHALTEN = "REQ-FUNKTION-001"
    KONTAKTE_MOVED_UNDER_THE_SAVE = "REQ-KONTAKT-001"
    KONTAKT_SITZ_OHNE_BESTAETIGUNG = "REQ-KONTAKT-002"
    KONTAKT_SITZ_GESPERRT = "REQ-KONTAKT-003"
    # The season row's own code, beside the application's 409 for its shared deadline (`REQ-BEWERBUNG-017`).
    KONTAKT_LINK_ABGELAUFEN = "REQ-KONTAKT-004"
    KONTAKT_ZEILE_OHNE_SAISON = "REQ-KONTAKT-005"
    KONTAKT_SAISON_VORBEI = "REQ-KONTAKT-006"
    # 403 and not 409, `REQ-BERECHTIGUNG-005`'s precedent: the refusal is about who asks. An administrator's
    # own records go through their account page, or through an owner (`REQ-PURGE-005`).
    EIGENE_ADRESSE = "REQ-PURGE-003"
    # Refused rather than warned of: with no owner left nobody may make one or change a tier again, and only
    # a database paste could hand the administration on.
    LETZTER_INHABER_ERASURE = "REQ-PURGE-004"
    # 403 for who asks, as `REQ-PURGE-003`: without it an administrator ends another's grant, which a revoke
    # reserves to an owner (`REQ-BERECHTIGUNG-005`).
    VERWALTUNG_ADRESSE = "REQ-PURGE-005"
    # 422 on the box, as the address the payload's own validator refuses there: the value typed is what is
    # refused, and the administrator rephrases it.
    # 403 for who asks, as `REQ-PURGE-005`: an erasure ends every change naming its address, and ending a grant holder's
    # change is a discard, which only an owner may make of it.
    FREMDER_ADRESSWECHSEL = "REQ-PURGE-007"
    # Refused rather than answered: a league always holds a live `owner`,
    # so grants holding none were read from an empty or foreign database, which would answer every address
    # unreferenced.
    KEIN_INHABER = "REQ-REFERENZEN-001"
    REGISTRIERUNG_FENSTER_GESCHLOSSEN = "REQ-REGISTRIERUNG-001"
    REGISTRIERUNG_TEAM_NICHT_EINGETRAGEN = "REQ-REGISTRIERUNG-002"
    REGISTRIERUNG_STUFE_NICHT_ERLAUBT = "REQ-REGISTRIERUNG-003"
    REGISTRIERUNG_TOKEN_UNKNOWN = "REQ-REGISTRIERUNG-004"
    REGISTRIERUNG_TOKEN_EXPIRED = "REQ-REGISTRIERUNG-005"
    REGISTRIERUNG_ALREADY_CONFIRMED = "REQ-REGISTRIERUNG-006"
    REGISTRIERUNG_ALTER = "REQ-REGISTRIERUNG-007"
    REGISTRIERUNG_KADER_VOLL = "REQ-REGISTRIERUNG-008"
    # Its own code beside the ban list's own `REQ-SPERRLISTE-001`, which words an administrator's
    # duplicate ban: the prefix names the flow that refuses rather than the collection consulted, and
    # one rule keeps one code and one German sentence.
    REGISTRIERUNG_ADRESSE_GESPERRT = "REQ-REGISTRIERUNG-009"
    REGISTRIERUNG_MEDIEN_ALTER = "REQ-REGISTRIERUNG-010"
    REGISTRIERUNG_SCHLUESSEL_ABWEICHEND = "REQ-REGISTRIERUNG-011"
    REGISTRIERUNG_BESTAETIGUNG_GESPERRT = "REQ-REGISTRIERUNG-012"
    REGISTRIERUNG_UNBESTAETIGT = "REQ-REGISTRIERUNG-013"
    REGISTRIERUNG_PERSON_NICHT_BENANNT = "REQ-REGISTRIERUNG-014"
    REGISTRIERUNG_SCHON_IM_KADER = "REQ-REGISTRIERUNG-015"
    REGISTRIERUNG_SCHON_AUFGENOMMEN = "REQ-REGISTRIERUNG-016"
    REGISTRIERUNG_WAHLEN_UNPASSEND = "REQ-REGISTRIERUNG-017"
    REGISTRIERUNG_PERSON_FEHLT = "REQ-REGISTRIERUNG-018"
    # A replacement is neither an entry nor a swap: ONE junction row changes hands and the season's
    # fixtures follow it, so it carries codes of its own.
    REPLACE_SAISON_FINISHED = "REQ-REPLACE-001"
    REPLACE_OUTGOING_HAS_A_RECORD = "REQ-REPLACE-002"
    REPLACE_INCOMING_ALREADY_ENTERED = "REQ-REPLACE-003"
    # Apart from `REQ-REPLACE-003`, being the payload's own fault: no season makes a club its own replacement.
    REPLACE_ONE_CLUB_ON_BOTH_ENDS = "REQ-REPLACE-004"
    RESULT_SIDE_EMPTIED = "REQ-RESULT-001"
    RETIRE_BLOCKED = "REQ-RETIRE-001"
    # A played fixture never blocks: its `ort` is an embedded record.
    VENUE_STILL_BOOKED = "REQ-RETIRE-003"
    # A played fixture never blocks: its `schiedsrichter` is a record of who officiated.
    REFEREE_STILL_ASSIGNED = "REQ-RETIRE-004"
    # The routing layer's own refusals, raised before any handler runs.
    NO_ROUTE = "REQ-ROUTE-001"
    METHOD_NOT_SERVED = "REQ-ROUTE-002"
    RULES_BRACKET_IMPOSSIBLE = "REQ-RULES-001"
    RULES_GROUPS_IN_USE = "REQ-RULES-002"
    RULES_CAPACITY_BELOW_USE = "REQ-RULES-003"
    RULES_QUALIFIERS_BELOW_WIRING = "REQ-RULES-004"
    RULES_SAISON_FINISHED = "REQ-RULES-005"
    RULES_MATCHDAY_OVER_ITS_PHASE = "REQ-RULES-006"
    RULES_QUALIFIERS_ABOVE_GROUP = "REQ-RULES-007"
    RULES_DRAW_OUTVALUES_WIN = "REQ-RULES-008"
    RULES_KADER_BELOW_USE = "REQ-RULES-009"
    RULES_FORFEIT_DRAWS_A_KNOCKOUT = "REQ-RULES-010"
    RULES_SHAPE_AFTER_DRAW = "REQ-RULES-011"
    RULES_TIEBREAK_AFTER_KNOCKOUT = "REQ-RULES-012"
    RULES_FIXTURES_OVER_ONE_READ = "REQ-RULES-013"
    # Each code the draw shares with a season write, and its twin: the draw judges the STORED rules and
    # dates beneath its shape, so a refusal reading a stored value is a conflict with state, a 409.
    RULES_BRACKET_IMPOSSIBLE_AS_STORED = "REQ-RULES-014"
    RULES_QUALIFIERS_ABOVE_GROUP_AS_STORED = "REQ-RULES-015"
    RULES_DRAW_OUTVALUES_WIN_AS_STORED = "REQ-RULES-016"
    RULES_FORFEIT_DRAWS_A_KNOCKOUT_AS_STORED = "REQ-RULES-017"
    RULES_FIXTURES_OVER_ONE_READ_AS_STORED = "REQ-RULES-018"
    SCHIEDSRICHTER_RETIRED = "REQ-SCHIEDSRICHTER-001"
    SCHIEDSRICHTER_TOKEN_UNKNOWN = "REQ-SCHIEDSRICHTER-002"
    SCHIEDSRICHTER_TOKEN_EXPIRED = "REQ-SCHIEDSRICHTER-003"
    SCHIEDSRICHTER_ALREADY_CONFIRMED = "REQ-SCHIEDSRICHTER-004"
    SCHIEDSRICHTER_ALTER = "REQ-SCHIEDSRICHTER-005"
    SCHIEDSRICHTER_KEINE_ADRESSE = "REQ-SCHIEDSRICHTER-006"
    # Its own code and never `SPERRLISTE_ADRESSE_GESPERRT`, which a
    # client already maps to a second ban of one address: two conditions under one code are two a
    # frontend cannot part.
    SCHIEDSRICHTER_ADRESSE_GESPERRT = "REQ-SCHIEDSRICHTER-007"
    SCHIEDSRICHTER_MEDIEN_ALTER = "REQ-SCHIEDSRICHTER-008"
    SCHIEDSRICHTER_BESTAETIGUNG_GESPERRT = "REQ-SCHIEDSRICHTER-009"
    SCHIEDSRICHTER_ADRESSE_NUR_PER_WECHSEL = "REQ-SCHIEDSRICHTER-011"
    # One code over two readers: each slice words it for its own, an administrator being told plainly
    # what a visitor is told neutrally (`.claude/rules/cross-surface.md`).
    SPERRLISTE_ADRESSE_GESPERRT = "REQ-SPERRLISTE-001"
    SPERRLISTE_KEINE_SAISON = "REQ-SPERRLISTE-002"
    SPERRLISTE_VERWALTUNG = "REQ-SPERRLISTE-003"
    # The ban's reason, by the same matcher and on its own box.
    SPIELPLAN_ALREADY_DRAWN = "REQ-SPIELPLAN-001"
    SPIELPLAN_MATCHDAYS_HELD = "REQ-SPIELPLAN-002"
    SPIELPLAN_SAISON_FINISHED = "REQ-SPIELPLAN-003"
    # One code, because one repair reaches all three: every offered group holding exactly
    # `teams_per_group`, short or over, and no club standing outside them.
    SPIELPLAN_GRUPPEN_OFF_RULES = "REQ-SPIELPLAN-004"
    # ONE code for both halves of the window -- `future`, and nothing recorded.
    SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW = "REQ-SPIELPLAN-005"
    SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW = "REQ-SPIELPLAN-006"
    # A code of its own beside the window's: a report is no field of a fixture.
    SPIELPLAN_BERICHTE_EINGEREICHT = "REQ-SPIELPLAN-007"
    SPIELTAG_OCCUPIED = "REQ-SPIELTAG-001"
    # Its own code beside `SPIELTAG_OCCUPIED`, because the repair differs and no side of this save named
    # the club: a resend answers the same, and the way out is the wiring the resolution followed or a
    # result that changes who advances.
    SPIELTAG_OCCUPIED_BY_THE_RESOLUTION = "REQ-SPIELTAG-002"
    # The same dangling reference `REQ-ELIGIBILITY-002` refuses on the match side.
    SQUAD_TEAM_NOT_IN_SAISON = "REQ-SQUAD-001"
    SQUAD_FULL = "REQ-SQUAD-003"
    # One code for both roles, as `REQ-BOOKING-001` covers a venue and a referee: this is one rule read
    # against two values rather than two failure modes.
    SQUAD_ROLLE_TAKEN = "REQ-SQUAD-004"
    # A representative's edit is held to the season's list, where the administrator's form is trusted to
    # offer it.
    KADER_STUFE_NICHT_ERLAUBT = "REQ-SQUAD-005"
    STATE_RESULT_ON_A_NON_EVENT = "REQ-STATE-002"
    STATE_NO_SHOW_WITHOUT_TWO_SIDES = "REQ-STATE-003"
    # A swap is neither an entry nor the move `REQ-ENTER-004` locks, so it carries codes of its own.
    # One code covers the two "not a swap" shapes the season decides, because the control offers only
    # pairs that are one.
    SWAP_NOT_A_SWAP = "REQ-SWAP-001"
    SWAP_KNOCKOUT_STARTED = "REQ-SWAP-002"
    SWAP_SAISON_FINISHED = "REQ-SWAP-003"
    SWAP_GRUPPENPHASE_PLAYED = "REQ-SWAP-004"
    SWAP_SPIELTAG_CLASH = "REQ-SWAP-005"
    # `REQ-SWAP-006` is FORWARDS ONLY, exactly as `REQ-ELIGIBILITY-001` is: the past is left alone.
    SWAP_FIELDS_DISQUALIFIED = "REQ-SWAP-006"
    # Apart from `REQ-SWAP-001`, being the payload's own fault: no season could make one club a pair.
    SWAP_ONE_CLUB_TWICE = "REQ-SWAP-007"
    PAYLOAD_REFUSED = "REQ-VAL-001"
    # A body no field could be read from: malformed syntax, RFC 9110's 400, never a refused payload's 422.
    BODY_UNREADABLE = "REQ-VAL-002"
    WIRING_UNSUPPORTED = "REQ-WIRING-001"
    # Its own code because the repair differs from `find_wiring_refusal`'s: nothing moves a fixture's round,
    # so a resend answers the same. The way out is a different source on that side, or a hand-set team.
    WIRING_SEED_PAST_THE_OPENING_ROUND = "REQ-WIRING-002"
    # Its own code again: the picker offers only the season's groups, so this arriving means the season
    # was redrawn narrower under the open form, and the repair is a reload rather than another source.
    WIRING_GRUPPE_NOT_RUN = "REQ-WIRING-003"
    UNHANDLED_CRASH = "SRV-FAIL-001"
    STORED_DATA_INVALID = "SRV-VAL-001"
