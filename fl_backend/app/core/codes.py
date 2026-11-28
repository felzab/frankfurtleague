"""Every refusal code a failure body carries, each the one spelling of its reason.

A code's value is its member's own name in lower snake case, which `StrEnum`'s `auto()` derives. The
published document lists them once, as the failure body's `error_code`. A 4xx answer promises that
the request wrote nothing, and the frontend clears the site's cache by that promise; a write that
may stand answers `unknown_outcome` with a 500, which promises nothing.

A code a box shows is a `FieldCode` member.
"""

from enum import StrEnum, auto
from typing import Literal


class Code(StrEnum):
    DOCUMENT_NOT_FOUND = auto()
    DUPLICATE_KEY = auto()
    # A save carrying the `version` its form was read at, which another write has since raised: the record changed since it
    # was opened, a removal included.
    VERSION_STALE = auto()
    DATABASE_FAILED = auto()
    # A write that may stand: its own code, because a page told "failed" sends the person to repeat a
    # write that is already there.
    UNKNOWN_OUTCOME = auto()
    # Activating demotes the incumbent to `past`, whose rules then stay frozen (`rules_saison_started`).
    ACTIVATE_SAISON_UNFINISHED = auto()
    # A season created while a `future` one stands: the next season is the one a create makes, so a league holds at
    # most one planned season, and the planned one is where its next season is set up.
    CREATE_SAISON_FUTURE_STANDS = auto()
    # A write a `past` season refuses, though not every write: a club's contacts and an invitation's revocation stay open
    # on purpose, and the season's own edit refuses by the rules' freeze and the fixed start. No escape, and no demotion
    # endpoint beside it: both keep the state reachable, and activating is the one operation that can reopen a finished
    # season's points, groups and table. A season closed by mistake is repaired at the database.
    SAISON_PAST = auto()
    # The pair to `saison_past` on the draw: that one lets a running season still be drawn, and this one
    # keeps a season from going live undrawn in the first place.
    ACTIVATE_TARGET_UNDRAWN = auto()
    # Every matchday rather than the first alone: a season goes public with a whole calendar, and a
    # league running `active` with nothing dated enters every late addition as an ordinary one.
    ACTIVATE_SPIELTAGE_UNDATED = auto()
    # One code for a link no record holds on every link page, a guess and a spent link alike: nothing
    # tells a stranger's guess from a spent link, and naming which would say more than the guess knew.
    LINK_INVALID = auto()
    ADDRESS_CHANGE_ENDED = auto()
    # A link whose deadline passed, or whose application was decided: either spends it for good, a re-send minting
    # another token.
    LINK_EXPIRED = auto()
    # The new address is a pupil's, an entry's or a grant's, which the start, the re-send and the press answer alike.
    ADDRESS_CHANGE_TAKEN = auto()
    ADDRESS_CHANGE_UNCHANGED = auto()
    # A 429: a person's own start pressed again inside the interval its last mail stands for.
    ADDRESS_CHANGE_STARTED_RECENTLY = auto()
    ADDRESS_CHANGE_NOTHING = auto()
    # A party's answer to a row that takes none: answered, closed, its Ansetzung left or decided, or its deadline gone by.
    # One code, since a page tells the reader alike that the question moved on, and the row as it stands says why.
    ANSETZUNG_UNANSWERABLE = auto()
    ANSETZUNG_VORSCHLAG_PAST = auto()
    # A decline proposing the slot the fixture already holds: adopted, it would save nothing and leave the proposal open.
    ANSETZUNG_VORSCHLAG_UNCHANGED = auto()
    # An administrator's settle, discard or adoption of a row that no longer takes it, one code for the three as for a
    # party's answer: a 409, the row's current state refusing the act.
    ANSETZUNG_NOT_ACTIONABLE = auto()
    ANSETZUNG_FOREIGN_ROW = auto()
    # A tier's key missing or wrong, whichever tier: the path names the tier.
    ACCESS_KEY_REFUSED = auto()
    MISSING_ACTOR = auto()
    ACTOR_NOT_ADMIN = auto()
    SESSION_REFUSED = auto()
    GRANT_EXISTS = auto()
    # A removal never takes the `owner` row, and a handover never names it: the role leaves only by a handover to another.
    GRANT_OWNER = auto()
    GRANT_BARRED = auto()
    # An address the ban list already holds, typed into the ban list's own add: `grant_barred`'s twin, which a grant
    # keeps for its own.
    ADDRESS_BARRED = auto()
    # 403 and not 409: the refusal is about who asks, and a handover to the asker is what lifts it.
    GRANT_ONLY_OWNER = auto()
    # 409: stopping the waiting handover is what lifts it.
    GRANT_HANDOVER_WAITING = auto()
    # 409: the addition's wait running out is what lifts it, so a handover waits its own days after the addition's.
    GRANT_NOT_IN_EFFECT = auto()
    BERICHT_NOT_PLAYED = auto()
    BERICHT_NOT_OFFICIATED = auto()
    BERICHT_CANCELLED = auto()
    BERICHT_ELFMETER_IN_THE_GRUPPE = auto()
    # A seat's save from one hour before kick-off: the line-up is the administration's from then. Never an
    # administrator's refusal, and never a line-up's being due or overdue, which refuses nothing.
    AUFSTELLUNG_LOCKED = auto()
    # A fixture holding no day or no hour owes no line-up and takes none, from a seat or an administrator.
    AUFSTELLUNG_SPIEL_UNDATED = auto()
    # A nominee named beside eleven regular players, or more nominees than the regular players leave open of eleven.
    AUFSTELLUNG_NOMINEE_WITHOUT_SHORTAGE = auto()
    BEWERBUNG_ALREADY_DECIDED = auto()
    BEWERBUNG_SCHULE_UNUSABLE = auto()
    BEWERBUNG_WINDOW_CLOSED = auto()
    BEWERBUNG_SUBMISSION_SUBJECT_UNRESOLVED = auto()
    BEWERBUNG_PICKED_TEAM_UNUSABLE = auto()
    BEWERBUNG_PICKED_TEAM_ALREADY_ENTERED = auto()
    # A seat whose person has confirmed or objected, on their link's second answer and on a re-send of the seat's link.
    BEWERBUNG_SEAT_ALREADY_ANSWERED = auto()
    # A seat erased at its person's request, on an administrator's write into it and a re-send of its link: its own code
    # beside `bewerbung_seat_already_answered`, since nobody answered and no write reopens the seat.
    BEWERBUNG_SEAT_ERASED = auto()
    CONFIRMATION_AGE = auto()
    BEWERBUNG_KONTAKTE_UNCONFIRMED = auto()
    BEWERBUNG_KONTAKT_REPEATED = auto()
    TRIKOT_FARBE_TAKEN = auto()
    # Judged on a reference the save moves, or keeps on a fixture it reopens: `spielort_still_booked` lets a venue
    # retire while only played or called-off fixtures hold it, so refusing an unrelated edit of one would be false.
    BOOKING_UNKNOWN_RESOURCE = auto()
    # Judged on the same references: a referee booked before confirming would be mailed an Einteilung for a panel that
    # address cannot open. A code of its own, the way out being the person's confirmation rather than a reactivation.
    BOOKING_UNCONFIRMED_SCHIEDSRICHTER = auto()

    SPIEL_DOUBLE_BOOKED = auto()
    SPIEL_OUTSIDE_SPIELTAG = auto()
    SPIELTAG_OUTSIDE_SAISON = auto()
    # `spiel_outside_spieltag`'s mirror: shrinking the span is the other way to break the same containment.
    SPIELTAG_SPAN_BELOW_SPIELE = auto()
    SAISON_SPAN_BELOW_SPIELTAGE = auto()
    # Derived, never an arbitrary floor: no two matchdays share a day. A one-day matchday stays legal.
    SAISON_SPAN_BELOW_SPIELPLAN = auto()
    # `position` and `start` order a phase independently, so nothing else stops a season from showing
    # its matchdays in one order and dating them in another. `end` is left free: it is the escape a
    # postponement takes.
    SPIELTAG_START_OUT_OF_ORDER = auto()
    # The start every start lock reads, fixed once a fixture of the season has taken place: moved after play, it would
    # reopen the rules, the swap and the replacement on a season somebody already played.
    SAISON_START_TAKEN_PLACE = auto()
    # A start moved later while a club's exit is stored: the season would read as not started again, reopening the group
    # swap, which would field a departed club, on a season whose exits are recorded only once it has started.
    SAISON_START_AUSTRITT_STORED = auto()
    INVITATION_TEAM_NOT_ENTERED = auto()
    # A consent press whose page was served choices that have moved since, on any of the account page's records: one
    # code, so the page maps one refusal however many writes share it.
    CHOICES_STALE = auto()
    # One code for every write taking a person's media consent, the account presses and the three
    # confirmations alike, so each page maps one refusal.
    MEDIA_AGE = auto()
    # A grant on a record that is the person's own and takes a withdrawal alone: its own code, not `role_not_held`'s, since
    # the record was found and naming the cause hides nothing.
    GIVING_NOT_ALLOWED = auto()
    ELIGIBILITY_DISQUALIFIED = auto()
    ELIGIBILITY_TEAM_NOT_IN_SAISON = auto()
    ENTRY_SAISON_NOT_FUTURE = auto()
    ENTRY_GRUPPE_NOT_OFFERED = auto()
    ENTRY_GRUPPE_FULL = auto()
    ENTRY_GRUPPE_LOCKED = auto()
    TEAM_RETIRED = auto()
    # The first refusal every person endpoint on a team's panel raises: who the caller is, so a 403
    # rather than a 409, whatever the team's own state.
    ROLE_NOT_HELD = auto()
    KONTAKT_SEAT_WITHOUT_CONFIRMATION = auto()
    # A seat's address or number another seat's person holds, on a season row's seat or an application's alike.
    KONTAKT_EMAIL_TAKEN = auto()
    KONTAKT_PHONE_TAKEN = auto()
    KONTAKT_ROW_WITHOUT_SAISON = auto()
    KONTAKT_SAISON_PAST = auto()
    # 403 and not 409, `grant_only_owner`'s precedent: the refusal is about who asks. An administrator's
    # own records go through their account page, or through an owner (`admin_address`).
    OWN_ADDRESS = auto()
    # Refused rather than warned of: with no owner nobody may name one again, and only a database paste
    # could hand the administration on.
    OWNER_ERASURE = auto()
    # 403 for who asks, as `own_address`: without it an administrator ends another's grant, which a revoke
    # reserves to an owner (`grant_only_owner`).
    ADMIN_ADDRESS = auto()
    # 403 for who asks, as `admin_address`: an erasure ends every change naming its address, and ending a grant
    # holder's change is a discard, which only an owner may make of it.
    FOREIGN_ADDRESS_CHANGE = auto()
    # Refused rather than answered: a league always holds a live `owner`,
    # so grants holding none were read from an empty or foreign database, which would answer every address
    # unreferenced.
    NO_OWNER = auto()
    REGISTRIERUNG_CLOSED = auto()
    REGISTRIERUNG_STUFE_NOT_ALLOWED = auto()
    CONFIRMATION_EXISTS = auto()
    REGISTRIERUNG_UNCONFIRMED = auto()
    REGISTRIERUNG_PERSON_NOT_NAMED = auto()
    REGISTRIERUNG_ALREADY_IN_KADER = auto()
    # A replacement is neither an entry nor a swap: one junction row changes hands and the season's
    # fixtures follow it, so it carries codes of its own.
    REPLACE_SAISON_STARTED = auto()
    REPLACE_INCOMING_ALREADY_ENTERED = auto()
    # Apart from `replace_incoming_already_entered`, being the payload's own fault: no season makes a club its own
    # replacement.
    REPLACE_ONE_TEAM_ON_BOTH_ENDS = auto()
    ERGEBNIS_SIDE_EMPTIED = auto()
    # Goals, a shoot-out, a no-show or an abandonment a save would store while the season has not started: refused,
    # because the swap and a replacement, which the start locks, rewrite a fixture's side and would hand its record to
    # another club.
    ERGEBNIS_BEFORE_SAISON_START = auto()
    RETIRE_BLOCKED = auto()
    # A played fixture never blocks: its `spielort` is a record of where it was played.
    SPIELORT_STILL_BOOKED = auto()
    # A played fixture never blocks: its `schiedsrichter` is a record of who officiated.
    SCHIEDSRICHTER_STILL_ASSIGNED = auto()
    # The routing layer's own refusals, raised before any handler runs.
    NO_ROUTE = auto()
    METHOD_NOT_SERVED = auto()
    RULES_BRACKET_IMPOSSIBLE = auto()
    RULES_GRUPPEN_IN_USE = auto()
    RULES_CAPACITY_BELOW_USE = auto()
    # The freeze on points, tiebreak and qualifiers, once the season has started or is `past`.
    RULES_SAISON_STARTED = auto()
    RULES_QUALIFIERS_ABOVE_GRUPPE = auto()
    RULES_UNENTSCHIEDEN_OUTVALUES_WIN = auto()
    RULES_NIEDERLAGE_OUTVALUES_UNENTSCHIEDEN = auto()
    RULES_KADER_BELOW_USE = auto()
    RULES_FORFEIT_UNENTSCHIEDEN_IN_A_KNOCKOUT = auto()
    RULES_SHAPE_AFTER_SPIELPLAN = auto()
    SCHIEDSRICHTER_RETIRED = auto()
    SCHIEDSRICHTER_NO_ADDRESS = auto()
    SCHIEDSRICHTER_ADDRESS_ONLY_PER_CHANGE = auto()
    BAN_LIST_NO_SAISON = auto()
    BAN_LIST_ADMIN = auto()
    SPIELPLAN_ALREADY_DRAWN = auto()
    # One code, because one repair reaches all three: every offered group holding exactly
    # `teams_per_gruppe`, short or over, and no club standing outside them.
    SPIELPLAN_GRUPPEN_OFF_RULES = auto()
    # One code for both halves of the window -- `future`, and nothing recorded.
    SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW = auto()
    SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW = auto()
    # A code of its own beside the window's: a report is no field of a fixture.
    SPIELPLAN_BERICHTE_SUBMITTED = auto()
    SPIELTAG_OCCUPIED = auto()
    # Its own code beside `SPIELTAG_OCCUPIED`, because the repair differs and no side of this save named
    # the club: a resend answers the same, and the way out is the wiring the resolution followed or a
    # result that changes who advances.
    SPIELTAG_OCCUPIED_BY_THE_RESOLUTION = auto()
    # A fixture's save deleting later results other than those its body confirms (`voided_ergebnisse`), judged inside its
    # transaction: the question its dry run asked is of a season that has moved since, so no result goes unasked.
    VOIDED_RESULTS_STALE = auto()
    # The same dangling reference `eligibility_team_not_in_saison` refuses on the match side.
    KADER_TEAM_NOT_IN_SAISON = auto()
    KADER_FULL = auto()
    # One code for both roles, as `booking_unknown_resource` covers a venue and a referee: this is one rule read
    # against two values rather than two failure modes.
    KADER_ROLLE_TAKEN = auto()
    # A representative's edit is held to the season's list, where the administrator's form is trusted to
    # offer it.
    KADER_STUFE_NOT_ALLOWED = auto()
    # A pupil a report or a line-up newly names on a side whom that side's live squad of the season does not hold: one
    # code for both writes, which read one rule against one squad.
    SPIELER_NOT_IN_KADER = auto()
    STATE_ERGEBNIS_ON_A_NON_EVENT = auto()
    STATE_NICHTANTRETEN_WITHOUT_TWO_SIDES = auto()
    # A swap is neither an entry nor the move `entry_gruppe_locked` locks, so it carries codes of its own.
    # One code covers every pick of two clubs that is no swap, one club twice or a pair the season
    # decides is none: the person's pick is what is refused, so a 422.
    SWAP_NOT_A_SWAP = auto()
    SWAP_SAISON_STARTED = auto()
    # An exit recorded before the season's start date: before the start a club out of the season is replaced, so no
    # fixture of an unstarted season, which the swap alone rewrites, fields a departed club.
    AUSTRITT_BEFORE_SAISON_START = auto()
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


# Every domain rule's kind: a refused payload's field carries one where a `PydanticCustomError` broke it. Published as
# the API's `Rule`, so the frontend's rule phrases are keyed by it as its code phrases are by `Code`. A `Literal`, not a
# `StrEnum`: pydantic takes the error's kind as a `LiteralString`, which no enum member is.
type Rule = Literal[
    "acceptance_with_proposal",
    "acceptance_with_reason",
    "bewerbung_window_ends_before_start",
    "date_not_in_calendar",
    "decline_without_proposal",
    "decline_without_reason",
    "elfmeterschiessen_without_draw",
    "elfmeterschiessen_without_winner",
    "email_not_accepted",
    "good_spieler_exceed_kader",
    "nichtantreten_with_elfmeterschiessen",
    "nichtantreten_with_scorers",
    "registrierung_window_reaches_saison_start",
    "saison_ends_before_start",
    "spieler_named_twice",
    "spieltag_ends_before_start",
    "starters_exceed_eleven",
    "text_version_of_another_wording",
    "url_not_accepted",
]


# Every code a judge raises on a box, as a `FieldFault`'s code: published as the API's `FieldCode`, so the frontend's
# field phrases are keyed by every member and a member added without one fails its type check.
type FieldCode = Literal[
    Code.DUPLICATE_KEY,
    Code.KONTAKT_EMAIL_TAKEN,
    Code.KONTAKT_PHONE_TAKEN,
    Code.BEWERBUNG_KONTAKT_REPEATED,
    Code.TRIKOT_FARBE_TAKEN,
    Code.KADER_ROLLE_TAKEN,
    Code.SPIEL_DOUBLE_BOOKED,
    Code.ADDRESS_CHANGE_TAKEN,
    Code.ADDRESS_BARRED,
    Code.GRANT_BARRED,
    Code.ADMIN_ADDRESS,
    Code.BAN_LIST_ADMIN,
    Code.GRANT_EXISTS,
    Code.OWN_ADDRESS,
    Code.ADDRESS_CHANGE_UNCHANGED,
    Code.ANSETZUNG_VORSCHLAG_UNCHANGED,
    Code.BOOKING_UNKNOWN_RESOURCE,
    Code.BOOKING_UNCONFIRMED_SCHIEDSRICHTER,
    Code.PAYLOAD_REFUSED,
    Code.BEWERBUNG_SUBMISSION_SUBJECT_UNRESOLVED,
    Code.SPIELER_NOT_IN_KADER,
    Code.ELIGIBILITY_DISQUALIFIED,
    Code.STATE_NICHTANTRETEN_WITHOUT_TWO_SIDES,
    Code.STATE_ERGEBNIS_ON_A_NON_EVENT,
    Code.MEDIA_AGE,
    Code.AUFSTELLUNG_NOMINEE_WITHOUT_SHORTAGE,
    Code.RULES_QUALIFIERS_ABOVE_GRUPPE,
    Code.RULES_UNENTSCHIEDEN_OUTVALUES_WIN,
    Code.RULES_NIEDERLAGE_OUTVALUES_UNENTSCHIEDEN,
    Code.RULES_FORFEIT_UNENTSCHIEDEN_IN_A_KNOCKOUT,
    Code.RULES_GRUPPEN_IN_USE,
    Code.RULES_CAPACITY_BELOW_USE,
    Code.RULES_KADER_BELOW_USE,
    Code.SAISON_SPAN_BELOW_SPIELPLAN,
    Code.AUSTRITT_BEFORE_SAISON_START,
    Code.ANSETZUNG_VORSCHLAG_PAST,
    Code.SAISON_START_AUSTRITT_STORED,
    Code.CONFIRMATION_AGE,
    Code.SPIEL_OUTSIDE_SPIELTAG,
    Code.SAISON_SPAN_BELOW_SPIELTAGE,
    Code.SAISON_START_TAKEN_PLACE,
    Code.SPIELTAG_OUTSIDE_SAISON,
    Code.SPIELTAG_SPAN_BELOW_SPIELE,
    Code.SPIELTAG_START_OUT_OF_ORDER,
]
