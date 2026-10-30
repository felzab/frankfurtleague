"""Every refusal code a failure body carries, each the one spelling of its reason.

A code's value is its member's own name in lower snake case, which `StrEnum`'s `auto()` derives. The
published document lists them once, as the failure body's `error_code`.
"""

from enum import StrEnum, auto


class Code(StrEnum):
    DOCUMENT_NOT_FOUND = auto()
    DUPLICATE_KEY = auto()
    # A save carrying the `version` its form was read at, which another write has since raised: the record changed since it
    # was opened, a removal included.
    VERSION_STALE = auto()
    NO_DATABASE_CLIENT = auto()
    DATABASE_FAILED = auto()
    # A write that may stand: its own code, because a page told "failed" sends the person to repeat a
    # write that is already there.
    UNKNOWN_OUTCOME = auto()
    # Activating demotes the incumbent to `past`, whose rules then stay frozen (`rules_saison_started`).
    ACTIVATE_SAISON_UNFINISHED = auto()
    # Every write a `past` season refuses, its activation included, the rules' freeze aside. No escape, and no demotion endpoint
    # beside it: both keep the state reachable, and activating is the one operation that can reopen a
    # finished season's points, groups and table. A season closed by mistake is repaired at the database.
    SAISON_PAST = auto()
    # The pair to `saison_past` on the draw: that one lets a running season still be drawn, and this one
    # keeps a season from going live undrawn in the first place.
    ACTIVATE_TARGET_UNDRAWN = auto()
    # Every matchday rather than the first alone: a season goes public with a whole calendar, and a
    # league running `active` with nothing dated enters every late addition as an ordinary one.
    ACTIVATE_SPIELTAGE_UNDATED = auto()
    # One code for a link no record holds on every link page, a guess and a spent link alike: nothing
    # tells a stranger's guess from a spent link, and naming which would say more than the guess knew.
    LINK_UNGUELTIG = auto()
    ADRESSWECHSEL_BEENDET = auto()
    # A link whose deadline passed, or whose application was decided: either spends it for good. An
    # application's deadline a re-send restarts is no such link, so it keeps its own code at the state's
    # status (`bewerbung_token_past_deadline`).
    LINK_ABGELAUFEN = auto()
    # 403 where `adresswechsel_gesperrt` is 409: this caller is the barred person, and nothing they change lifts it.
    LINK_GESPERRT = auto()
    # Its own code and never `link_gesperrt`'s: the barred address here is the one on file, which the caller may not even hold.
    ADRESSWECHSEL_ERSETZTE_GESPERRT = auto()
    ADRESSWECHSEL_VERGEBEN = auto()
    ADRESSWECHSEL_UNVERAENDERT = auto()
    ADRESSWECHSEL_GESPERRT = auto()
    ADRESSWECHSEL_NICHTS = auto()
    ADRESSWECHSEL_KEIN_GENEHMIGER = auto()
    ADRESSWECHSEL_KEINE_GENEHMIGUNG_OFFEN = auto()
    # 403: the refusal is about who asks, and another administrator's press is what lifts it.
    ADRESSWECHSEL_GENEHMIGUNG_VERWEHRT = auto()
    ADRESSWECHSEL_GENEHMIGUNG_INHABER = auto()
    ADRESSWECHSEL_NICHT_GEDECKT = auto()
    ADRESSWECHSEL_NEUE_BERECHTIGT = auto()
    # 403 as `adresswechsel_genehmigung_verwehrt`: about who asks; an administrator holding their grant since before the
    # start lifts it.
    ADRESSWECHSEL_GENEHMIGUNG_JUENGER = auto()
    ADRESSWECHSEL_BELEGT = auto()
    ANSETZUNG_BEANTWORTET = auto()
    ANSETZUNG_FRIST_VORBEI = auto()
    ANSETZUNG_GEAENDERT = auto()
    ANSETZUNG_ENTSCHIEDEN = auto()
    ANSETZUNG_VORSCHLAG_VERGANGEN = auto()
    ANSETZUNG_GESCHLOSSEN = auto()
    ANSETZUNG_NICHT_EINTRAGBAR = auto()
    ANSETZUNG_NICHT_VERWERFBAR = auto()
    ANSETZUNG_FREMDE_ZEILE = auto()
    # A tier's key missing or wrong, whichever tier: the path names the tier.
    ACCESS_KEY_REFUSED = auto()
    MISSING_ACTOR = auto()
    ACTOR_NOT_ADMIN = auto()
    SESSION_REFUSED = auto()
    PERSON_BARRED = auto()
    CONFIRMATION_REQUIRED = auto()
    BERECHTIGUNG_VORHANDEN = auto()
    # A revoke never removes an `owner` row: an owner is demoted by another owner, or steps down, first, so the tier stays
    # out of an administrator's reach; only an erasure and an address change's move remove one.
    BERECHTIGUNG_INHABER = auto()
    BERECHTIGUNG_GESPERRT = auto()
    BERECHTIGUNG_MINDESTZAHL = auto()
    # 403 and not 409: the refusal is about who asks, and granting the asker `owner` is what lifts it.
    BERECHTIGUNG_NUR_INHABER = auto()
    # 409: the grants' state, and promoting another owner first is what lifts it.
    BERECHTIGUNG_LETZTER_INHABER = auto()
    BERECHTIGUNG_ANTRAG_OFFEN = auto()
    # 403, as the address change's approval refusals: about who asks, and another administrator's press lifts it.
    BERECHTIGUNG_GENEHMIGUNG_VERWEHRT = auto()
    BERECHTIGUNG_GENEHMIGUNG_INHABER = auto()
    BERECHTIGUNG_GENEHMIGUNG_JUENGER = auto()
    # 409: the request's own state, which no approver lifts; a new request does.
    BERECHTIGUNG_ANTRAG_VERFALLEN = auto()
    BERICHT_NICHT_GESPIELT = auto()
    BERICHT_NICHT_GELEITET = auto()
    BERICHT_NICHT_IM_KADER = auto()
    BERICHT_ABGESAGT = auto()
    # Both writes replace the whole block, so a form opened before another write would put back what that write changed.
    BERICHT_INZWISCHEN_GEAENDERT = auto()
    BERICHT_GRUND_FEHLT = auto()
    BERICHT_ELFMETER_IN_DER_GRUPPE = auto()
    BEWERBUNG_ALREADY_DECIDED = auto()
    BEWERBUNG_SUBJECT_UNRESOLVED = auto()
    BEWERBUNG_SCHULE_UNUSABLE = auto()
    BEWERBUNG_FENSTER_GESCHLOSSEN = auto()
    BEWERBUNG_SUBMISSION_SUBJECT_UNRESOLVED = auto()
    BEWERBUNG_PICKED_TEAM_UNUSABLE = auto()
    BEWERBUNG_PICKED_TEAM_ALREADY_ENTERED = auto()
    BEWERBUNG_SHORTHAND_TAKEN = auto()
    BEWERBUNG_SITZ_ALREADY_ANSWERED = auto()
    BESTAETIGUNG_ALTER = auto()
    BEWERBUNG_KONTAKTE_UNCONFIRMED = auto()
    BEWERBUNG_KONTAKT_EMAIL_TAKEN = auto()
    BEWERBUNG_SCHLUESSEL_ABWEICHEND = auto()
    BEWERBUNG_TOKEN_PAST_DEADLINE = auto()
    BEWERBUNG_ADRESSE_GESPERRT = auto()
    BEWERBUNG_KONTAKT_GESPERRT = auto()
    BEWERBUNG_SITZ_ANDERS_BESETZT = auto()
    # Judged on a reference the save moves, or keeps on a fixture it reopens: `spielort_still_booked` lets a venue
    # retire while only played or called-off fixtures hold it, so refusing an unrelated edit of one would be false.
    BOOKING_UNKNOWN_RESOURCE = auto()
    # Judged on the same references: a referee booked before confirming would be mailed an Einteilung for a panel that
    # address cannot open. A code of its own, the way out being the person's confirmation rather than a reactivation.
    BOOKING_UNCONFIRMED_SCHIEDSRICHTER = auto()
    # A referee's own decline empties the slot outside this route, under an editor still showing them: a wholesale save
    # keeping them would book them again unasked, and the next pass mail them for the fixture they just declined.
    BOOKING_SCHIEDSRICHTER_MOVED = auto()
    SPIEL_DOUBLE_BOOKED = auto()
    SPIEL_OUTSIDE_SPIELTAG = auto()
    SPIELTAG_OUTSIDE_SAISON = auto()
    # `spiel_outside_spieltag`'s mirror: shrinking the span is the other way to break the same containment.
    SPIELTAG_SPAN_BELOW_SPIELE = auto()
    SAISON_SPAN_BELOW_SPIELTAGE = auto()
    # DERIVED, never an arbitrary floor: no two matchdays share a day. A one-day MATCHDAY stays legal.
    SAISON_SPAN_BELOW_SPIELPLAN = auto()
    # `position` and `beginn` order a phase independently, so nothing else stops a season from showing
    # its matchdays in one order and dating them in another. `ende` is left free: it is the escape a
    # postponement takes.
    SPIELTAG_BEGINN_OUT_OF_ORDER = auto()
    SAISON_SPAN_BELOW_SPIELPLAN_AS_STORED = auto()
    EINLADUNG_TEAM_NICHT_EINGETRAGEN = auto()
    # One code for every write that stamps a label, so a page's form maps one refusal however many
    # writes share its page.
    FASSUNG_UNZULAESSIG = auto()
    # One code for every write taking a person's media consent, the account presses and the three
    # confirmations alike, so each page maps one refusal.
    MEDIEN_ALTER = auto()
    ERTEILUNG_NICHT_ZUGELASSEN = auto()
    ELIGIBILITY_DISQUALIFIED = auto()
    ELIGIBILITY_TEAM_NOT_IN_SAISON = auto()
    ENTRY_SAISON_NOT_FUTURE = auto()
    ENTRY_GRUPPE_NOT_OFFERED = auto()
    ENTRY_GRUPPE_FULL = auto()
    ENTRY_GRUPPE_LOCKED = auto()
    TEAM_RETIRED = auto()
    # The first refusal every person endpoint on a team's panel raises: who the caller is, so a 403
    # rather than a 409, whatever the team's own state.
    FUNKTION_NICHT_GEHALTEN = auto()
    KONTAKTE_MOVED_UNDER_THE_SAVE = auto()
    KONTAKT_SITZ_OHNE_BESTAETIGUNG = auto()
    KONTAKT_SITZ_GESPERRT = auto()
    KONTAKT_ZEILE_OHNE_SAISON = auto()
    KONTAKT_SAISON_VORBEI = auto()
    # 403 and not 409, `berechtigung_nur_inhaber`'s precedent: the refusal is about who asks. An administrator's
    # own records go through their account page, or through an owner (`verwaltung_adresse`).
    EIGENE_ADRESSE = auto()
    # Refused rather than warned of: with no owner left nobody may make one or change a tier again, and only
    # a database paste could hand the administration on.
    LETZTER_INHABER_LOESCHUNG = auto()
    # 403 for who asks, as `eigene_adresse`: without it an administrator ends another's grant, which a revoke
    # reserves to an owner (`berechtigung_nur_inhaber`).
    VERWALTUNG_ADRESSE = auto()
    # 403 for who asks, as `verwaltung_adresse`: an erasure ends every change naming its address, and ending a grant
    # holder's change is a discard, which only an owner may make of it.
    FREMDER_ADRESSWECHSEL = auto()
    # Refused rather than answered: a league always holds a live `owner`,
    # so grants holding none were read from an empty or foreign database, which would answer every address
    # unreferenced.
    KEIN_INHABER = auto()
    REGISTRIERUNG_GESCHLOSSEN = auto()
    REGISTRIERUNG_STUFE_NICHT_ERLAUBT = auto()
    BESTAETIGUNG_VORHANDEN = auto()
    REGISTRIERUNG_KADER_VOLL = auto()
    # Its own code beside `duplicate_key`, which words an administrator's duplicate ban: the name says
    # the flow that refuses rather than the collection consulted, and one rule keeps one code and one
    # German sentence.
    REGISTRIERUNG_ADRESSE_GESPERRT = auto()
    REGISTRIERUNG_SCHLUESSEL_ABWEICHEND = auto()
    REGISTRIERUNG_UNBESTAETIGT = auto()
    REGISTRIERUNG_PERSON_NICHT_BENANNT = auto()
    REGISTRIERUNG_SCHON_IM_KADER = auto()
    REGISTRIERUNG_SCHON_AUFGENOMMEN = auto()
    REGISTRIERUNG_WAHLEN_UNPASSEND = auto()
    REGISTRIERUNG_PERSON_FEHLT = auto()
    # A replacement is neither an entry nor a swap: ONE junction row changes hands and the season's
    # fixtures follow it, so it carries codes of its own.
    REPLACE_OUTGOING_HAS_A_RECORD = auto()
    REPLACE_INCOMING_ALREADY_ENTERED = auto()
    # Apart from `replace_incoming_already_entered`, being the payload's own fault: no season makes a club its own
    # replacement.
    REPLACE_ONE_TEAM_ON_BOTH_ENDS = auto()
    ERGEBNIS_SIDE_EMPTIED = auto()
    RETIRE_BLOCKED = auto()
    # A played fixture never blocks: its `ort` is an embedded record.
    SPIELORT_STILL_BOOKED = auto()
    # A played fixture never blocks: its `schiedsrichter` is a record of who officiated.
    SCHIEDSRICHTER_STILL_ASSIGNED = auto()
    # The routing layer's own refusals, raised before any handler runs.
    NO_ROUTE = auto()
    METHOD_NOT_SERVED = auto()
    RULES_BRACKET_IMPOSSIBLE = auto()
    RULES_GRUPPEN_IN_USE = auto()
    RULES_CAPACITY_BELOW_USE = auto()
    RULES_QUALIFIERS_BELOW_WIRING = auto()
    # The freeze on points, tiebreak and qualifiers, once the season has started or is `past`.
    RULES_SAISON_STARTED = auto()
    RULES_SPIELTAG_OVER_ITS_PHASE = auto()
    RULES_QUALIFIERS_ABOVE_GRUPPE = auto()
    RULES_UNENTSCHIEDEN_OUTVALUES_WIN = auto()
    RULES_KADER_BELOW_USE = auto()
    RULES_FORFEIT_DRAWS_A_KNOCKOUT = auto()
    RULES_SHAPE_AFTER_SPIELPLAN = auto()
    RULES_SPIELE_OVER_ONE_READ = auto()
    # The draw's twin of a code it shares with a season write: the draw judges the STORED rules beneath
    # its shape, so a refusal reading a stored value is a conflict with state, a 409.
    RULES_FORFEIT_DRAWS_A_KNOCKOUT_AS_STORED = auto()
    SCHIEDSRICHTER_RETIRED = auto()
    SCHIEDSRICHTER_KEINE_ADRESSE = auto()
    # Its own code and never `duplicate_key`, which the ban list's client words as a second ban of one
    # address: two conditions under one code are two a frontend cannot part.
    SCHIEDSRICHTER_ADRESSE_GESPERRT = auto()
    SCHIEDSRICHTER_ADRESSE_NUR_PER_WECHSEL = auto()
    SPERRLISTE_KEINE_SAISON = auto()
    SPERRLISTE_VERWALTUNG = auto()
    SPIELPLAN_ALREADY_DRAWN = auto()
    SPIELPLAN_SPIELTAGE_HELD = auto()
    # One code, because one repair reaches all three: every offered group holding exactly
    # `teams_per_group`, short or over, and no club standing outside them.
    SPIELPLAN_GRUPPEN_OFF_RULES = auto()
    # ONE code for both halves of the window -- `future`, and nothing recorded.
    SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW = auto()
    SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW = auto()
    # A code of its own beside the window's: a report is no field of a fixture.
    SPIELPLAN_BERICHTE_EINGEREICHT = auto()
    SPIELTAG_OCCUPIED = auto()
    # Its own code beside `SPIELTAG_OCCUPIED`, because the repair differs and no side of this save named
    # the club: a resend answers the same, and the way out is the wiring the resolution followed or a
    # result that changes who advances.
    SPIELTAG_OCCUPIED_BY_THE_RESOLUTION = auto()
    # The same dangling reference `eligibility_team_not_in_saison` refuses on the match side.
    KADER_TEAM_NOT_IN_SAISON = auto()
    KADER_FULL = auto()
    # One code for both roles, as `booking_unknown_resource` covers a venue and a referee: this is one rule read
    # against two values rather than two failure modes.
    KADER_ROLLE_TAKEN = auto()
    # A representative's edit is held to the season's list, where the administrator's form is trusted to
    # offer it.
    KADER_STUFE_NICHT_ERLAUBT = auto()
    STATE_ERGEBNIS_ON_A_NON_EVENT = auto()
    STATE_NICHTANTRETEN_WITHOUT_TWO_SIDES = auto()
    # A swap is neither an entry nor the move `entry_gruppe_locked` locks, so it carries codes of its own.
    # One code covers every pick of two clubs that is no swap, one club twice or a pair the season
    # decides is none: the person's pick is what is refused, so a 422 naming both boxes.
    SWAP_NOT_A_SWAP = auto()
    SWAP_SAISON_STARTED = auto()
    SWAP_SPIELTAG_CLASH = auto()
    # FORWARDS ONLY, exactly as `eligibility_disqualified` is: the past is left alone.
    SWAP_FIELDS_DISQUALIFIED = auto()
    PAYLOAD_REFUSED = auto()
    # A body no field could be read from: malformed syntax, RFC 9110's 400, never a refused payload's 422.
    BODY_UNREADABLE = auto()
    WIRING_UNSUPPORTED = auto()
    # Its own code because the repair differs from `find_wiring_refusal`'s: nothing moves a fixture's round,
    # so a resend answers the same. The way out is a different source on that side, or a hand-set team.
    WIRING_SEED_PAST_THE_OPENING_ROUND = auto()
    # Its own code again: the picker offers only the season's groups, so this arriving means the season
    # was redrawn narrower under the open form, and the repair is a reload rather than another source.
    WIRING_GRUPPE_NOT_RUN = auto()
    UNHANDLED_CRASH = auto()
    STORED_DATA_INVALID = auto()
