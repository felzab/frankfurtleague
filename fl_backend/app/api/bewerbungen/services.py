import hashlib
import hmac
import json
from collections.abc import Container, Iterable, Mapping, Sequence
from datetime import date, timedelta
from http import HTTPStatus
from typing import Any, Final, Literal, TypeIs, get_args

from pydantic import BaseModel, SecretStr, ValidationError

from app.api.bewerbungen.schemas import (
    FLBewerbungDecision,
    FLBewerbungEinwilligungState,
    FLBewerbungWindowState,
    age_outside_the_bounds,
)
from app.api.kontakte.services import rows_seating
from app.api.outbox.schemas import (
    FLBewerbungErasureData,
    FLBewerbungLinkData,
    FLBewerbungPerson,
    FLBewerbungReceivedData,
    FLOutboxLink,
    FLOutboxReference,
    FLOutboxStatus,
)
from app.api.outbox.services import OwedMail
from app.api.sperrliste.services import withheld_actor
from app.api.teams.schemas import FLPostTeamPayload, normalise_phone
from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import build_sort, literal_pattern
from app.core.exceptions import WriteRefusal
from app.shared.einwilligung import is_confirmed
from app.shared.einwilligung_evidence import TextVersions, compose_choices
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import (
    BEWERBUNG_CONFIRMATION_DEADLINE_DAYS,
    BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
    BEWERBUNG_KONTAKT_MIN_AGE_YEARS,
    BEWERBUNG_REMINDER_DAYS,
    LIST_LIMIT_MAX,
    SAISON_ID_LENGTH,
    SIGNATORY_MIN_AGE_YEARS,
)
from app.shared.schemas.literals import KONTAKT_ROLLEN, FLKontaktEnteredBy, FLKontaktRolle, FLTrikotFarbe
from app.shared.sub_keys import derive_sub_key


def find_triage_refusal(*, status: str) -> WriteRefusal | None:
    """Why this application may no longer be decided, or `None`.

    ONE code for both endpoints: which of the two arrived second is nothing an administrator can act
    on differently. Without it a second press re-enters the club, failing on a duplicate key.
    """

    if status != "submitted":
        return WriteRefusal(
            error_code=Code.BEWERBUNG_ALREADY_DECIDED,
            status=HTTPStatus.CONFLICT,
        )

    return None


def find_acceptance_subject_refusal(*, team_id: Any | None, schule: Mapping[str, Any] | None) -> WriteRefusal | None:
    """Why this application resolves to no single club to enter, or `None`.

    While it is `submitted`, EXACTLY one of the two carries a value -- a rule the write path holds
    because types and enums cannot state it.
    """

    if (team_id is None) == (schule is None):
        return WriteRefusal(
            error_code=Code.BEWERBUNG_SUBJECT_UNRESOLVED,
            status=HTTPStatus.CONFLICT,
        )

    return None


# The school's field names in the club's. `team_name` becomes the club's `name`; the other three are
# spelled alike on both sides, and `description` and `shorthand` are on neither.
_CLUB_FIELDS_FROM_SCHULE = {
    "team_name": "name",
    "full_name": "full_name",
    "schulform": "schulform",
    "address": "address",
    "website_url": "website_url",
}


def find_acceptance_code_refusal(*, new_school: bool, shorthand: str | None) -> WriteRefusal | None:
    """Why this acceptance's code is refused, or `None`: a new school takes one, and a picked club keeps its own.

    A body's fault, which only the stored application can show: the dialog asks the code of a new school alone.
    """

    if new_school == (shorthand is None):
        return WriteRefusal(error_code=Code.PAYLOAD_REFUSED, status=HTTPStatus.UNPROCESSABLE_CONTENT, fields=(("shorthand",),))

    return None


def compose_new_club(*, schule: Any, shorthand: str | None) -> dict[str, Any]:
    """The club document acceptance would create, from the school's block AS STORED and the code the administrator set.

    Raw so `find_new_club_refusal` judges every field: a `str()` here makes a club named `'None'`
    from a null with no undo, and a subscript 500s where the rule promises 409.
    """

    fields = schule if isinstance(schule, Mapping) else {}

    return {
        # Empty rather than composed from the application: `description` is the club's own public
        # blurb, and a sentence the league wrote would stand on the team page as though the school
        # had written it.
        "description": "",
        "shorthand": shorthand,
        # A key the block has not got is left OUT rather than defaulted, so the guard names it
        # "Field required" rather than judging a null nobody submitted.
        **{club_field: fields[schule_field] for schule_field, club_field in _CLUB_FIELDS_FROM_SCHULE.items() if schule_field in fields},
    }


def parse_new_club(*, club_document: Mapping[str, Any]) -> dict[str, Any]:
    """The club document AS STORED, from one the guard has already passed.

    Parsed, not composed: `website_url`'s validator strips tab, return and newline, so the raw
    block leaves `teams` holding what `POST /teams` never stores for the same school.
    """

    return FLPostTeamPayload.model_validate(club_document).model_dump(mode="json")


def find_new_club_refusal(*, club_document: Mapping[str, Any]) -> WriteRefusal | None:
    """Why the school's details make no club, or `None`.

    Through the payload itself, never a copy: nothing else judges them, so a scheme-less `website_url` would reach
    storage, and `FLTeam` 500s every club read.
    """

    try:
        FLPostTeamPayload.model_validate(club_document)
    # NARROW on purpose: anything else raised here is a fault in this code, and a 409 blaming the
    # school for one is a refusal nobody can act on.
    except ValidationError:
        return WriteRefusal(
            error_code=Code.BEWERBUNG_SCHULE_UNUSABLE,
            status=HTTPStatus.CONFLICT,
        )

    return None


# --- The PUBLIC submission. Every refusal below is judged before the one write, in the order the
# router asks them in.


def saison_takes_bewerbungen(*, saison_status: Any, bewerbung: Any, today: str) -> bool:
    """Whether this season takes an application on `today`: a season not yet ended, its window not paused, `today` inside its span.

    The window is null or the whole object the season form writes, both ends included. Both ends are compared rather
    than assuming `start <= end`: span ordering is enforced on the season PAYLOAD alone, so a stored reversal is
    reachable. A finished season's window is over for good, whatever dates it still stores: the payload names the
    season, and the dates alone would still admit an application into one that has ended.
    """

    if bewerbung is None or not bewerbung["open"] or season_has_ended(saison_status=saison_status):
        return False

    return str(bewerbung["start"]) <= today <= str(bewerbung["end"])


def form_window_state(*, saison_status: Any, bewerbung: Mapping[str, Any], today: str) -> FLBewerbungWindowState:
    """Where this stored window stands today, as the form's page says it: a pause opens on no day, so its `start` is never its promise."""

    if season_has_ended(saison_status=saison_status):
        return "ended"

    if saison_takes_bewerbungen(saison_status=saison_status, bewerbung=bewerbung, today=today):
        return "running"

    return "upcoming" if bewerbung["open"] and today < str(bewerbung["start"]) else "closed"


# `season_has_ended`'s negation for a read that narrows in the query. Every write stores a season's status, which is why
# the readers of this filter's rows subscript it.
SAISON_NOT_ENDED_FILTER: Final[Mapping[str, Any]] = {"status": {"$ne": "past"}}


def find_window_refusal(*, saison_status: Any, bewerbung: Any, today: str) -> WriteRefusal | None:
    """Why this season is taking no application today, or `None`.

    ONE code for every way `saison_takes_bewerbungen` says no: naming which would report a
    season's administrative state to an anonymous visitor.
    """

    if saison_takes_bewerbungen(saison_status=saison_status, bewerbung=bewerbung, today=today):
        return None

    return WriteRefusal(
        error_code=Code.BEWERBUNG_WINDOW_CLOSED,
        status=HTTPStatus.CONFLICT,
    )


def find_submission_subject_refusal(*, team_id: Any | None, schule: Any | None) -> WriteRefusal | None:
    """Why this submission resolves to no single school, or `None`.

    Its OWN code beside `find_acceptance_subject_refusal`, which asks this of a STORED application:
    one code would leave a public refusal and a triage refusal alike in the log.
    """

    if (team_id is None) == (schule is None):
        return WriteRefusal(
            error_code=Code.BEWERBUNG_SUBMISSION_SUBJECT_UNRESOLVED,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            fields=(("team_id",), ("schule",)),
        )

    return None


def find_picked_club_refusal(*, team_raw: Mapping[str, Any] | None) -> WriteRefusal | None:
    """Why the club the applicant picked is not one to apply as, or `None`.

    ONE code for a club that does not exist and one that has left: the picker offers neither, so
    either answer means the same thing -- a client sending an id it was never given.
    """

    if team_raw is None or team_raw.get("inactive_since") is not None:
        return WriteRefusal(
            error_code=Code.BEWERBUNG_PICKED_TEAM_UNUSABLE,
            status=HTTPStatus.CONFLICT,
        )

    return None


def find_already_entered_refusal(*, entered: bool) -> WriteRefusal | None:
    """Why this club may not apply for this season or be entered into it, or `None`.

    A club already holding the season's junction row is IN it, so an application would ask for
    something already granted. A shared season is not refused: two schools may apply on one day.
    """

    if entered:
        return WriteRefusal(
            error_code=Code.BEWERBUNG_PICKED_TEAM_ALREADY_ENTERED,
            status=HTTPStatus.CONFLICT,
        )

    return None


# --- The SUBMISSION KEY, which the registration's submission takes from here.


def payload_fingerprint(payload: BaseModel) -> str:
    """The digest a replayed key's payload is compared by.

    Over the VALIDATED payload: two spellings the model stores alike, or one body serialised in two
    key orders, are one request. Keys sorted, so a mapping-typed field cannot reorder it.
    """

    canonical = json.dumps(payload.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False)

    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def build_key_filter(*, key: str) -> Mapping[str, Any]:
    """The key lookup, carrying the unique index's partial term.

    An equality alone does not imply `$type`, so without the term the planner scans the whole collection.
    """

    return {"idempotency_key": {"$eq": key, "$type": "string"}}


def find_abweichender_fingerabdruck_refusal(*, saved: Any, fingerabdruck: str) -> WriteRefusal | None:
    """Why this key cannot be replayed, or `None`: it already carries an application sent with other details.

    Refused rather than answered as the stored one, which would tell the applicant a changed field
    had arrived.
    """

    if saved == fingerabdruck:
        return None

    return WriteRefusal(
        error_code=Code.BEWERBUNG_KEY_DIFFERING,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
    )


def compose_einwilligung(*, today: str, entered_by: FLKontaktEnteredBy) -> dict[str, Any]:
    """The contact seat's record as the server writes it: who seated the person, and nothing they answered.

    Named by no client, who could otherwise dress a transcription as a signature.
    """

    # `media` written false rather than left off: nobody filling a seat for another person may give
    # that person's media consent.
    return {
        "scope": "kontakt_data",
        "date": today,
        "confirmed_at": None,
        "media": False,
        "entered_by": entered_by,
    }


# Every seat, so a fourth one is a `KeyError` at the confirmation rather than a silent sixteen.
SEAT_MIN_AGE_YEARS: Mapping[str, int] = {
    "trainer": BEWERBUNG_KONTAKT_MIN_AGE_YEARS,
    "ansprechperson": SIGNATORY_MIN_AGE_YEARS,
    "stellvertretung": SIGNATORY_MIN_AGE_YEARS,
}


def minimum_age_for(seats: Sequence[str]) -> int:
    """The floor the PERSON clears: the highest any seat they hold asks for.

    Never the pressed seat's, or a Trainer sitting in one of the other two passes at sixteen.
    """

    return max(SEAT_MIN_AGE_YEARS[seat] for seat in seats)


def compose_kontakte(*, kontakte: Mapping[str, Any], today: str) -> dict[str, Any]:
    """The three people as `saison_teams` stores them, each seat's record recomposed here.

    Taken as the DUMPED payload rather than the model: this module composes documents, and every
    other function here takes one.
    """

    composed: dict[str, Any] = {
        seat: {
            **kontakte[seat],
            # Written null rather than left off, as `wunschgegner` is: the key marks a date not yet
            # entered, and the confirmation fills it.
            "birth_date": None,
            "einwilligung": compose_einwilligung(today=today, entered_by="bewerbung"),
        }
        for seat in KONTAKT_ROLLEN
    }
    composed["trainer_is_also"] = kontakte["trainer_is_also"]

    return composed


# --- The CONFIRMATION.

KONTAKT_SCOPE = "kontakt_data"
KONTAKT_SCOPE_WHATSAPP = "kontakt_data_whatsapp"


def days_after(*, day: str, days: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=days)).isoformat()


def confirmation_deadline_from(*, today: str) -> str:
    """The day a seat's link stops working, counted from its mail -- a re-send of that seat restarts it."""

    return days_after(day=today, days=BEWERBUNG_CONFIRMATION_DEADLINE_DAYS)


def compose_bestaetigung(*, today: str) -> dict[str, Any]:
    """One seat's bookkeeping as the create and the re-send write it: mailed today, its 14 days from today, nobody reminded or declined.

    No link yet: the hand-out of the mail the same write owes mints it into `token_hashes`, so a link replaced here opens
    nothing from this write on.
    """

    return {"token_hashes": [], "sent_at": today, "deadline": confirmation_deadline_from(today=today), "reminded_at": None, "declined_at": None}


def compose_confirmations(*, today: str, unmailed: Container[str] = ()) -> dict[str, Any]:
    """Every seat's bookkeeping at the submission. An `unmailed` seat's `sent_at` is null, which no reminder reaches: no mail was owed it."""

    return {seat: {**compose_bestaetigung(today=today), **({"sent_at": None} if seat in unmailed else {})} for seat in KONTAKT_ROLLEN}


# The admin reads' projection, and the FIRST exclusion projection in this tree: an inclusion list
# would have to restate every field an application holds. Each seat keeps the hash of every link it
# was mailed, a reminder's beside the first, and only an administrator's re-send voids them.
WITHOUT_TOKEN_HASHES: Mapping[str, int] = {f"confirmations.{seat}.token_hashes": 0 for seat in KONTAKT_ROLLEN}


def _per_seat(block: str, *fields: str) -> dict[str, int]:
    """Each seat's copy of these paths, included, so a fourth seat cannot fall out of a read."""

    return {f"{block}.{seat}.{field}": 1 for seat in KONTAKT_ROLLEN for field in fields}


# What an answer moves on each seat, read before it: a withdrawal keeps the grant it ended.
KONTAKT_CHOICE_FIELDS: Final = ("einwilligung.scope", "einwilligung.media", "einwilligung.evidence")


# An INCLUSION, and never the exclusion above inverted: these two answer a closed handful, so the
# rest of the document is what a base-tier read must not hold.
# Every hash, which `seat_holding` compares.
EINWILLIGUNG_VIEW_FIELDS: Mapping[str, int] = {
    **_per_seat("confirmations", "token_hashes", "declined_at", "deadline"),
    # The address for the ban list alone, as the answer's read takes it: the response model declares
    # no field to carry it.
    **_per_seat("kontakte", "email", "einwilligung.confirmed_at"),
    # A declaration naming a seat, holding nobody's details: `paired_seat` reads it, and the view
    # serves only the pair it resolves for this link's own seat.
    "kontakte.trainer_is_also": 1,
    "saison_id": 1,
    "status": 1,
    "schule.team_name": 1,
    "team_id": 1,
    # Suppressed here alone: an inclusion projection answers `_id` unasked, and only the answer's
    # read below has a patch filter to key on it.
    "_id": 0,
}

# Narrower than the view's: the answer takes its wording from the payload and names no school. The
# address is what a consent asks the ban list of, and no answer carries it. `sent_at` says whether a
# decline's notice has anybody to tell (`ansprechperson_mailbox`).
EINWILLIGUNG_ANSWER_FIELDS: Mapping[str, int] = {
    **_per_seat("confirmations", "token_hashes", "declined_at", "deadline", "sent_at"),
    # The choices and their evidence, so a withdrawal names the grant it ends (`compose_choices`).
    **_per_seat("kontakte", "first_name", "email", "einwilligung.confirmed_at", *KONTAKT_CHOICE_FIELDS),
    "kontakte.trainer_is_also": 1,
    "saison_id": 1,
    "status": 1,
}


def build_token_filter(*, token_hash: str) -> Mapping[str, Any]:
    """Every seat path, so the hash alone finds the seat. No status term: a reopened link shows its own state."""

    return {"$or": [{f"confirmations.{seat}.token_hashes": token_hash} for seat in KONTAKT_ROLLEN]}


def is_seat(value: object) -> TypeIs[FLKontaktRolle]:
    """Whether this value names a seat: a path segment and a stored key are both only as trustworthy as whatever wrote them."""

    return value in KONTAKT_ROLLEN


def seat_named(value: Any) -> FLKontaktRolle | None:
    """The seat this value names, or `None`."""

    return value if is_seat(value) else None


def seat_holding(*, bewerbung_raw: Mapping[str, Any], token_hash: str) -> FLKontaktRolle | None:
    """Which seat's hash this is, read off the document the filter found rather than off a second query."""

    block = bewerbung_raw.get("confirmations")
    if not isinstance(block, Mapping):
        return None

    for seat in KONTAKT_ROLLEN:
        entry = block.get(seat)
        if isinstance(entry, Mapping) and token_hash in (entry.get("token_hashes") or ()):
            return seat_named(seat)

    return None


def find_unknown_token_refusal(*, seat: FLKontaktRolle | None) -> WriteRefusal | None:
    """Why this token opens nothing, or `None`.

    ONE answer for unknown, voided by a re-send, and deleted with the application: nothing
    distinguishes them from a stranger's guess, and naming which would say more than the guess knew.
    """

    if seat is None:
        return WriteRefusal(
            error_code=Code.LINK_INVALID,
            status=HTTPStatus.NOT_FOUND,
        )

    return None


def seat_opens_nobody(*, slot: Any, state: FLBewerbungEinwilligungState) -> bool:
    """Whether an open link's seat holds nobody, emptied without a Widerspruch: the view answers it as a token no seat holds.

    Told apart, it would tell a guess that a person once sat there, and offer a press `bewerbung_seat_already_answered` refuses.
    """

    return state in ("valid", "saison_past") and not isinstance(slot, Mapping)


def _is_decided(status: Any) -> bool:
    return status != "submitted"


def _deadline_passed(*, deadline: Any, today: str) -> bool:
    return isinstance(deadline, str) and deadline < today


def seat_deadline_of(*, confirmations: Any, seat: str) -> Any:
    """The deadline the seat's own link carries: each seat is minted on its own day, so the record holds none."""

    entry = confirmations.get(seat) if isinstance(confirmations, Mapping) else None

    return entry.get("deadline") if isinstance(entry, Mapping) else None


def link_is_over(*, deadline: Any, status: Any, today: str) -> bool:
    """Whether the link is over: its seat's deadline has passed, or the application was decided while the seat stood open."""

    return _is_decided(status) or _deadline_passed(deadline=deadline, today=today)


def find_expired_token_refusal(*, deadline: Any, status: Any, today: str) -> WriteRefusal | None:
    """Why this link is over, or `None`. Judged before the seat: a seat on a decided application is never answered again.

    410: no write moves a live link's deadline, a re-send minting another token.
    """

    if link_is_over(deadline=deadline, status=status, today=today):
        return WriteRefusal(
            error_code=Code.LINK_EXPIRED,
            status=HTTPStatus.GONE,
        )

    return None


def _seat_is_confirmed(kontakte: Any, seat: str) -> bool:
    slot = kontakte.get(seat) if isinstance(kontakte, Mapping) else None

    return is_confirmed(slot.get("einwilligung") if isinstance(slot, Mapping) else None)


def _declined_on(confirmations: Any, seat: str) -> Any:
    entry = confirmations.get(seat) if isinstance(confirmations, Mapping) else None

    return entry.get("declined_at") if isinstance(entry, Mapping) else None


def seat_is_answered(*, kontakte: Any, confirmations: Any, seat: str) -> bool:
    """Whether this seat's person has spoken: a stamp on the slot, a decline beside it, or no bookkeeping.

    No bookkeeping is an emptied seat, or a season row's seat no link was minted for: nothing to answer.
    """

    if _seat_is_confirmed(kontakte, seat) or _declined_on(confirmations, seat) is not None:
        return True

    return not isinstance(confirmations, Mapping) or not isinstance(confirmations.get(seat), Mapping)


def find_already_answered_refusal(*, kontakte: Any, confirmations: Any, seat: str) -> WriteRefusal | None:
    """Why this seat takes no second answer, or `None`. The single use: the stamps are what spend a link, never a nulled hash."""

    if seat_is_answered(kontakte=kontakte, confirmations=confirmations, seat=seat):
        return WriteRefusal(
            error_code=Code.BEWERBUNG_SEAT_ALREADY_ANSWERED,
            status=HTTPStatus.CONFLICT,
        )

    return None


def find_alter_refusal(*, birth_date: str, today: str, minimum_age: int) -> WriteRefusal | None:
    """Why the typed date is refused, or `None`.

    Its own code rather than a `payload_refused`, whose mark on the field names no floor. Judged BEFORE any write, so
    a mistyped year spends nothing.
    """

    if age_outside_the_bounds(birth_date=birth_date, today=today, minimum_age=minimum_age):
        return WriteRefusal(
            error_code=Code.CONFIRMATION_AGE,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            fields=(("birth_date",),),
            bounds={"min": minimum_age, "max": BEWERBUNG_KONTAKT_MAX_AGE_YEARS},
        )

    return None


def _seat_state_of(*, kontakte: Any, confirmations: Any, seat: str, over: bool, barred: bool) -> FLBewerbungEinwilligungState:
    """The one ranking both records' links are shown in: the ban first, then a stamp."""

    if barred:
        return "barred"

    if _seat_is_confirmed(kontakte, seat):
        return "confirmed"

    if _declined_on(confirmations, seat) is not None:
        return "declined"

    return "expired" if over else "valid"


def zustand_of(*, bewerbung_raw: Mapping[str, Any], seat: str, today: str, barred: bool) -> FLBewerbungEinwilligungState:
    """What a reopened link shows. A confirmed seat on an accepted application reads as confirmed."""

    confirmations = bewerbung_raw.get("confirmations")
    over = link_is_over(deadline=seat_deadline_of(confirmations=confirmations, seat=seat), status=bewerbung_raw.get("status"), today=today)

    return _seat_state_of(kontakte=bewerbung_raw.get("kontakte"), confirmations=confirmations, seat=seat, over=over, barred=barred)


# --- A TEAM'S SEASON ROW. A contact seat an administrator typed in is mailed its own link, resolved
# by the application's two operations: the slots, the stamps and each seat's deadline are one shape.


def build_saison_token_filter(*, token_hash: str) -> Mapping[str, Any]:
    """Every seat path, so the hash alone finds the seat on whichever row holds it."""

    return {"$or": [{f"confirmations.{seat}.token_hashes": token_hash} for seat in KONTAKT_ROLLEN]}


# An INCLUSION for `EINWILLIGUNG_VIEW_FIELDS`' reason: the rest of the row is what a base-tier read
# must not hold. The address is the ban list's alone, and the club's season name is the page's
# `schule`.
SAISON_EINWILLIGUNG_FIELDS: Mapping[str, int] = {
    **_per_seat("confirmations", "token_hashes", "declined_at", "deadline"),
    **_per_seat("kontakte", "email", "einwilligung.confirmed_at"),
    "kontakte.trainer_is_also": 1,
    "saison_id": 1,
    "name": 1,
    # A team that left the season holds no seat a consent could be given for.
    "austritt": 1,
    # Suppressed as the application's view suppresses it: an inclusion answers `_id` unasked, and only
    # the answer's read below keys a patch on it.
    "_id": 0,
}

# The answer's read writes on the row, so it keys the patch on `_id`, and reads each seat's choices
# and their evidence as `EINWILLIGUNG_ANSWER_FIELDS` does.
SAISON_EINWILLIGUNG_ANSWER_FIELDS: Mapping[str, int] = {
    **SAISON_EINWILLIGUNG_FIELDS,
    **_per_seat("kontakte", *KONTAKT_CHOICE_FIELDS),
    "_id": 1,
}


def saison_link_is_over(*, deadline: Any, today: str) -> bool:
    """Whether a season row's seat link is past its own deadline: what its press refuses (`link_expired`) and the editor shows."""

    return _deadline_passed(deadline=deadline, today=today)


def row_takes_confirmations(*, saison_status: Any, austritt: Any) -> bool:
    """Whether a season row's seat still asks its person to confirm it: not once its season ended or its team left it.

    Such a seat grants no panel, and a confirmation collects a birthdate for nothing.
    """

    return saison_status != "past" and austritt is None


def saison_state_of(*, row: Mapping[str, Any], seat: str, today: str, barred: bool, saison_status: Any) -> FLBewerbungEinwilligungState:
    """What a reopened season-row link shows, its own deadline ending it, a closed row stopping its consent."""

    confirmations = row.get("confirmations")
    over = saison_link_is_over(deadline=seat_deadline_of(confirmations=confirmations, seat=seat), today=today)
    state = _seat_state_of(kontakte=row.get("kontakte"), confirmations=confirmations, seat=seat, over=over, barred=barred)

    # Below the deadline, as the press refuses: past it the link takes no Widerspruch either
    # (`link_expired`), while a closed row's link still takes one (`kontakt_saison_past`).
    if state == "valid" and not row_takes_confirmations(saison_status=saison_status, austritt=row.get("austritt")):
        return "saison_past"

    return state


def find_saison_deadline_refusal(*, deadline: Any, today: str) -> WriteRefusal | None:
    """Why a season row's link takes no answer past its own deadline, or `None`.

    410: no write moves this deadline, a re-send minting another token.
    """

    if not saison_link_is_over(deadline=deadline, today=today):
        return None

    return WriteRefusal(
        error_code=Code.LINK_EXPIRED,
        status=HTTPStatus.GONE,
    )


def find_saison_past_einwilligung_refusal(*, saison_status: Any, austritt: Any) -> WriteRefusal | None:
    """Why a season row's link takes no consent once its season has ended or its team left it, or `None`.

    410: no write reopens a past season, and a Widerspruch is still taken, the person removing
    themselves.
    """

    if row_takes_confirmations(saison_status=saison_status, austritt=austritt):
        return None

    return WriteRefusal(
        error_code=Code.KONTAKT_SAISON_PAST,
        status=HTTPStatus.GONE,
    )


def saison_link_pair(*, kontakte: Any, confirmations: Any, seat: str, token_hash: str) -> FLKontaktRolle | None:
    """The other seat this season-row link was minted for, still unconfirmed, or `None`.

    Never `paired_seat`: a Trainer confirmed before taking a second seat is minted a link for that seat
    alone, and answering both overwrites the earlier stamp.
    """

    other = claimed_pair_seat(kontakte=kontakte, seat=seat)
    if other is None or not seat_stands(kontakte=kontakte, confirmations=confirmations, seat=other):
        return None

    entry = confirmations[other]
    if token_hash not in (entry.get("token_hashes") or ()) or _seat_is_confirmed(kontakte, other):
        return None

    return other


def compose_saison_decline_update(*, seats: Sequence[str], today: str) -> Mapping[str, Any]:
    """A Widerspruch empties the person's slots and records the day on the link entry beside each, where the emptying cannot reach."""

    written: dict[str, Any] = {}
    for seat in seats:
        written[f"kontakte.{seat}"] = None
        written[f"confirmations.{seat}.declined_at"] = today

    return {"$set": written}


def pending_seats(*, kontakte: Any) -> list[FLKontaktRolle]:
    """Every seat without a stamp, in declaration order. An emptied slot counts: the application cannot complete without it."""

    return [seat for seat in KONTAKT_ROLLEN if not _seat_is_confirmed(kontakte, seat)]


def find_unconfirmed_kontakte_refusal(*, kontakte: Any) -> WriteRefusal | None:
    """Why this application is not yet one the league may accept, or `None`."""

    outstanding = pending_seats(kontakte=kontakte)
    if outstanding:
        return WriteRefusal(
            error_code=Code.BEWERBUNG_KONTAKTE_UNCONFIRMED,
            status=HTTPStatus.CONFLICT,
        )

    return None


def seat_stands(*, kontakte: Any, confirmations: Any, seat: str) -> bool:
    """Whether both halves of a seat are there for a dotted `$set` to reach: the slot, and the bookkeeping entry beside it."""

    slot = kontakte.get(seat) if isinstance(kontakte, Mapping) else None
    entry = confirmations.get(seat) if isinstance(confirmations, Mapping) else None

    return isinstance(slot, Mapping) and isinstance(entry, Mapping)


def paired_seat(*, kontakte: Any, confirmations: Any, seat: str) -> FLKontaktRolle | None:
    """The other seat the same person still holds, or `None`: one click answers for the person, not for one of their two seats."""

    other = claimed_pair_seat(kontakte=kontakte, seat=seat)

    # An emptied seat is nobody's: a dotted `$set` under its null slot or its null entry is
    # `PathNotViable`, and the abort takes the answer for the seat that IS this person's with it.
    return other if other is not None and seat_stands(kontakte=kontakte, confirmations=confirmations, seat=other) else None


def seat_answered_at(*, kontakte: Any, confirmations: Any, seat: str) -> Any:
    """The day this seat's person answered, a stamp on the slot or a decline beside it, or `None`."""

    slot = kontakte.get(seat) if isinstance(kontakte, Mapping) else None
    einwilligung = slot.get("einwilligung") if isinstance(slot, Mapping) else None
    confirmed_at = einwilligung.get("confirmed_at") if isinstance(einwilligung, Mapping) else None

    return confirmed_at or _declined_on(confirmations, seat)


def seat_addresses(*, kontakte: Any, seats: Iterable[str]) -> set[str]:
    """The stored address of each of these seats that still holds one.

    One helper for the consent and the view, so the page shows the ban for exactly the addresses a
    press would be refused on.
    """

    slots = [kontakte.get(seat) for seat in seats] if isinstance(kontakte, Mapping) else []

    return {str(slot["email"]) for slot in slots if isinstance(slot, Mapping) and slot.get("email")}


def seat_first_name(*, kontakte: Any, seat: str) -> str:
    """The first name in a seat's slot, or `""` where the slot is empty."""

    slot = kontakte.get(seat) if isinstance(kontakte, Mapping) else None

    return str(slot.get("first_name") or "") if isinstance(slot, Mapping) else ""


def _was_mailed(confirmations: Any, seat: str) -> bool:
    return (_entry_of(confirmations, seat) or {}).get("sent_at") is not None


def mailed_seats(*, confirmations: Any) -> list[FLKontaktRolle]:
    """The seats a mail has reached. A seat past `OPEN_LINKS_PER_MAILBOX` is none of them: its person has heard of no application."""

    return [seat for seat in KONTAKT_ROLLEN if _was_mailed(confirmations, seat)]


def ansprechperson_mailbox(*, kontakte: Any, confirmations: Any) -> tuple[str | None, list[FLKontaktRolle]]:
    """The Ansprechperson's address as stored, and every seat that same inbox holds.

    `None` where that seat is empty: the message this addresses has nowhere to go, and a substitute
    recipient would mail a third party. `None` too where the seat was never mailed: that person has heard of no
    application, and a stranger's own Widerspruch would otherwise reach a mailbox past `OPEN_LINKS_PER_MAILBOX`.
    """

    if not _was_mailed(confirmations, "ansprechperson"):
        return None, []

    slots = kontakte if isinstance(kontakte, Mapping) else {}
    addresses: dict[str, str] = {}

    for seat in KONTAKT_ROLLEN:
        slot = slots.get(seat)
        email = str(slot.get("email") or "").strip() if isinstance(slot, Mapping) else ""
        if email:
            addresses[seat] = email

    anchor = addresses.get("ansprechperson")
    if anchor is None:
        return None, []

    # One inbox is one stored address, each the fold every payload stores.
    held: list[FLKontaktRolle] = [seat for seat in KONTAKT_ROLLEN if addresses.get(seat) == anchor]

    return anchor, held


def compose_confirmation_update(
    *,
    kontakte: Mapping[str, Any],
    seats: Sequence[str],
    birth_date: str,
    today: str,
    text_versions: TextVersions,
    whatsapp: bool,
    media: bool,
    at: str,
    takes_the_notice_back: bool,
) -> Mapping[str, Any]:
    """The ONE update a confirmation is, on every seat the person holds.

    The date and the stamp land together, which is why
    this is one update and never two. `takes_the_notice_back` where the answer moves the day a deletion notice named
    (`leaving_moves_the_deletion_day`).
    """

    written: dict[str, Any] = {}
    for seat in seats:
        path = f"kontakte.{seat}.einwilligung"
        written[f"kontakte.{seat}.birth_date"] = birth_date
        # Field by field, never the block whole: `entered_by` and `date` are the seating's, and
        # what it tells stands after the answer.
        written[f"{path}.confirmed_at"] = today
        written.update(
            compose_choices(
                path=path,
                saved=kontakte[seat]["einwilligung"],
                set_fields={"scope": KONTAKT_SCOPE_WHATSAPP if whatsapp else KONTAKT_SCOPE, "media": media},
                at=at,
                text_versions=text_versions,
            )
        )
    if takes_the_notice_back:
        written["erasure_announced_at"] = None

    return {"$set": written}


# The two pages' own fills: the account page states a seat's words with these too, so each confirmation
# page and the account page fill `{schule}` alike.
def saison_schule(row: Mapping[str, Any]) -> str:
    """What the season row's confirmation page fills `{schule}` with: the name the club carries that season."""

    return str(row.get("name") or "")


def bewerbung_schule(*, bewerbung_raw: Mapping[str, Any], club_name: Any) -> str:
    """What the application's confirmation page fills `{schule}` with: the school as submitted, or the picked club's own name."""

    schule = bewerbung_raw.get("schule")
    if isinstance(schule, Mapping):
        return str(schule.get("team_name") or "")

    return str(club_name or "")


def build_own_bewerbung_filter(*identifiers: str) -> Mapping[str, Any]:
    """Every PENDING application one of whose seats names one of these addresses.

    Pending alone: an accepted application's seats are its season row's, and a declined one's go with it.
    """

    return {"status": "submitted", **rows_seating(*identifiers)}


# The form's unanswered links of one season a mailbox may hold before a press naming it mails that mailbox nothing. What a
# stranger can do through a public form is make the league mail an address, and each link owes a reminder and a notice
# after it, so this bounds the mail and refuses nobody: a refusal would be a lock a stranger can aim at a real school. An
# answer frees its link, and two schools sharing a person stay under it. A real person's seat can still stand past it behind a
# stranger's presses, unmailed until an administrator sends its link, which is why both lists say so. The application form
# and the registration form each count their own and each season its own, so two forms or two running seasons double it.
# The count is exact: a press it leaves room writes that mailbox's document (`mailbox_anchor_ids`), so a rival committed
# since the transaction's snapshot, which the count read, is a write conflict and the retry reads its row. After the count
# and never before it, the snapshot keeping that order exact: a press finding the mailbox full mails nothing and so writes
# nothing, and a flood contends only until the bound, where a write ahead of the count serves one mailbox one press a second
# at production's round trip and fails the rest, a real school's among them, at the request's deadline. One document a
# mailbox, because one on the season stalls every school's press and every season write the same way.
OPEN_LINKS_PER_MAILBOX: Final = 3

# One label per purpose (`app/api/sperrliste/services.py :: BAN_LIST_KEY_VERSION`).
MAILBOX_ANCHOR_KEY_VERSION: Final = "mailbox-anchor-v1"


def mailbox_of(address: str) -> str:
    """The mailbox a stored address reaches, its plus-tag off. A provider's own aliases, such as Gmail's dots, stay out of reach."""

    local, _, domain = address.rpartition("@")

    return f"{local.partition('+')[0]}@{domain}"


def mailbox_anchor_ids(*, addresses: Iterable[str], key: SecretStr) -> list[str]:
    """Each of these addresses' mailbox as its document's `_id`, sorted so two presses meet in one order.

    Keyed, as a ban is (`app/api/sperrliste/services.py :: address_hash`): an address is a dictionary word.
    """

    sub_key = derive_sub_key(key, MAILBOX_ANCHOR_KEY_VERSION)

    return sorted({hmac.new(sub_key, mailbox_of(address).encode("utf-8"), hashlib.sha256).hexdigest() for address in addresses})


def mailbox_pattern(address: str) -> str:
    """A `$regex` matching this address's mailbox and each plus-tagged form of it, on the stored fold; its fixed prefix keeps it on an index."""

    local, _, domain = mailbox_of(address).rpartition("@")

    return f"^{literal_pattern(local)}(\\+[^@]*)?@{literal_pattern(domain)}$"


# What `open_links_on` judges a row by.
OPEN_LINK_FIELDS: Mapping[str, int] = {**_per_seat("kontakte", "email", "einwilligung.confirmed_at"), **_per_seat("confirmations", "sent_at")}


def build_open_links_filter(*, saison_id: str, address: str) -> Mapping[str, Any]:
    """The season's open applications holding a mailed, unconfirmed seat at this address's mailbox: a Widerspruch empties the slot and leaves.

    Each seat's terms together, so a row a flood stored unmailed stays out of a read bounded by what was mailed.
    """

    pattern = {"$regex": mailbox_pattern(address)}

    return {
        "saison_id": saison_id,
        "status": "submitted",
        "$or": [
            {
                f"kontakte.{seat}.email": pattern,
                f"kontakte.{seat}.einwilligung.confirmed_at": None,
                f"confirmations.{seat}.sent_at": {"$ne": None},
            }
            for seat in KONTAKT_ROLLEN
        ],
    }


def open_links_on(*, row: Mapping[str, Any], mailbox: str) -> int:
    """The unanswered links this application's mails left in this mailbox: one a person, and one application can name its plus-tagged forms."""

    kontakte, confirmations = row.get("kontakte"), row.get("confirmations")
    waiting: list[FLKontaktRolle] = [
        seat for seat in KONTAKT_ROLLEN if _was_mailed(confirmations, seat) and not _seat_is_confirmed(kontakte, seat)
    ]

    return sum(mailbox_of(address) == mailbox for address, _ in people_with_address(kontakte=kontakte, seats=waiting))


def seats_past_the_bound(*, kontakte: Any, open_links: Mapping[str, int]) -> list[FLKontaktRolle]:
    """The seats this submission owes no mail, each person after the first taking a link of the mailbox's count, in the mails' order."""

    held = dict(open_links)
    past: list[FLKontaktRolle] = []
    for address, seats in people_with_address(kontakte=kontakte):
        mailbox = mailbox_of(address)
        if held[mailbox] >= OPEN_LINKS_PER_MAILBOX:
            past += seats
        else:
            held[mailbox] += 1

    return past


def objection_is_announced(*, kontakte: Any, confirmations: Any, seats: Sequence[str]) -> bool:
    """Whether a decline of these seats is told to an Ansprechperson who still stands, in a notice naming the deletion day."""

    return "ansprechperson" not in seats and ansprechperson_mailbox(kontakte=kontakte, confirmations=confirmations)[0] is not None


def compose_decline_update(*, seats: Sequence[str], today: str, announced: bool) -> Mapping[str, Any]:
    """A decline empties the person's slot and records the day beside it, where the emptying cannot reach.

    `announced` where the objection notice goes out: it names the deletion day, so it is the deletion notice too.
    """

    written: dict[str, Any] = {}
    for seat in seats:
        written[f"kontakte.{seat}"] = None
        written[f"confirmations.{seat}.declined_at"] = today
    if announced:
        written["erasure_announced_at"] = today

    # The submission's digest was taken over this person's details too, and a hash of personal data is
    # still personal data. A replay then meets the refusal of other details, which stays true.
    return {"$set": written, "$unset": {"idempotency_fingerprint": ""}}


def _fresh_links(*, seats: Sequence[str], today: str) -> dict[str, Any]:
    # The WHOLE entry, its links with it: the old link opens nothing from here, and the mail this write owes mints the fresh one.
    return {f"confirmations.{seat}": compose_bestaetigung(today=today) for seat in seats}


def _moves_the_deletion_day(*, kontakte: Any, confirmations: Any, seats: Sequence[str], today: str) -> bool:
    """Whether fresh links on these seats move `deletion_day`, the earliest day and not always the declining seat's, which a notice named."""

    fresh = {**(confirmations if isinstance(confirmations, Mapping) else {}), **{seat: compose_bestaetigung(today=today) for seat in seats}}
    unanswered = {**(kontakte if isinstance(kontakte, Mapping) else {}), **dict.fromkeys(seats)}

    return deletion_day(kontakte=unanswered, confirmations=fresh) != deletion_day(kontakte=kontakte, confirmations=confirmations)


def leaving_moves_the_deletion_day(*, kontakte: Any, confirmations: Any, seats: Sequence[str]) -> bool:
    """Whether these seats going moves `deletion_day`, whose earliest may be theirs.

    A confirmed seat stops counting, and an erased one holds no day.
    """

    outstanding = pending_seats(kontakte=kontakte)
    staying = [seat for seat in outstanding if seat not in seats]

    return _earliest_deadline(confirmations=confirmations, seats=staying) != _earliest_deadline(confirmations=confirmations, seats=outstanding)


def compose_resend_update(*, seats: Sequence[str], today: str, kontakte: Any, confirmations: Any) -> Mapping[str, Any]:
    """A re-send: one fresh entry per seat this person holds, restarting those seats' 14 days and no other's.

    Both seats one person holds, as the confirmation writes both: one entry left standing would keep
    the replaced address's link alive through `paired_seat`.
    """

    moved = _moves_the_deletion_day(kontakte=kontakte, confirmations=confirmations, seats=seats, today=today)

    # A day that stands keeps its announcement, since a second notice would announce one deletion twice; a moved one is told afresh.
    return {"$set": {**_fresh_links(seats=seats, today=today), **({"erasure_announced_at": None} if moved else {})}}


def build_resend_filter(*, bewerbung_id: Any, seats: Sequence[str]) -> Mapping[str, Any]:
    """`seat_is_answered` negated per seat, as the re-send's own filter.

    The re-send reads outside any transaction and replaces the WHOLE entry, so an answer or an
    erasure committed after its read would otherwise lose its record under a live link.
    """

    unanswered: dict[str, Any] = {}
    for seat in seats:
        unanswered[f"confirmations.{seat}"] = {"$type": "object"}
        unanswered[f"confirmations.{seat}.declined_at"] = None
        unanswered[f"kontakte.{seat}.einwilligung.confirmed_at"] = None

    return {"_id": bewerbung_id, "status": "submitted", **unanswered}


def find_barred_refusal(*, barred: bool) -> WriteRefusal | None:
    """`bewerbung_address_barred`: the ban list holds one of the addresses a submission names.

    Takes the answer rather than the lookup, so the caller's reads run in the caller's transaction.
    """

    if not barred:
        return None

    # NEUTRAL and naming no seat, as the registration's refusal is: a stranger learns nothing about a
    # list, and 403 because what fails is who is applying rather than the season's state.
    return WriteRefusal(
        error_code=Code.BEWERBUNG_ADDRESS_BARRED,
        status=HTTPStatus.FORBIDDEN,
    )


def find_kontakt_barred_refusal(*, barred: bool) -> WriteRefusal | None:
    """`bewerbung_kontakt_barred`: an administrator's seat write names an address the ban list holds.

    409 where the public form's is 403: an administrator's write naming it is about the entry it writes,
    as the referee editor's `schiedsrichter_address_barred` is.
    """

    if not barred:
        return None

    return WriteRefusal(
        error_code=Code.BEWERBUNG_KONTAKT_BARRED,
        status=HTTPStatus.CONFLICT,
    )


def find_einwilligung_barred_refusal(*, barred: bool) -> WriteRefusal | None:
    """`link_barred`: the ban list holds the address a confirmation link was mailed to, however long ago it was minted.

    Asked of a consent alone: a Widerspruch empties the seat, which is what a barred person is owed.
    """

    if not barred:
        return None

    # 403 and named plainly, where the form's is neutral: whoever holds the mailed token holds that
    # mailbox, as a sign-in code's holder does, and the ban's own mail has told them.
    return WriteRefusal(
        error_code=Code.LINK_BARRED,
        status=HTTPStatus.FORBIDDEN,
    )


def find_repeated_contact_refusal(*, kontakte: Mapping[str, Any]) -> WriteRefusal | None:
    """Why this submission's block holds two people reachable alike, or `None`: every box repeating an earlier person's address or number.

    A body's fault, judged here rather than on the payload: a model's rule can name the block alone, and the form marks
    the box. The seat the Trainer also holds is that person and is compared with nobody; the mark lands on the later
    seat, the box the applicant reaches next and the one to change.
    """

    addresses: set[str] = set()
    numbers: set[str] = set()
    boxes: list[tuple[str, ...]] = []

    for seat in KONTAKT_ROLLEN:
        if seat == kontakte["trainer_is_also"]:
            continue
        # On the sign-in fold: two seats one sign-in reaches are one identity.
        address, number = sign_in_identifier(kontakte[seat]["email"]), normalise_phone(kontakte[seat]["phone"])
        boxes += [("kontakte", seat, field) for field, seen in (("email", address in addresses), ("phone", number in numbers)) if seen]
        addresses.add(address)
        numbers.add(number)

    if boxes:
        return WriteRefusal(error_code=Code.BEWERBUNG_KONTAKT_REPEATED, status=HTTPStatus.UNPROCESSABLE_CONTENT, fields=tuple(boxes))

    return None


def find_seat_contact_refusal(*, kontakte: Any, seats: Sequence[str], email: str, phone: str) -> WriteRefusal | None:
    """Why this address or this number cannot be the seat's, or `None`.

    `find_repeated_contact_refusal`'s rule asked again -- two DIFFERENT people are not reachable alike -- because a seat
    write is the one path that could put them there afterwards.
    """

    slots = kontakte if isinstance(kontakte, Mapping) else {}
    # The seats this write reaches are left out: they are one person, and their blocks are equal
    # by the submission's own rule.
    others = [slot for seat in KONTAKT_ROLLEN if seat not in seats and isinstance(slot := slots.get(seat), Mapping)]

    # The fold `find_repeated_contact_refusal` compares by: a third spelling of "one mailbox" here would refuse where the
    # form accepted, or the reverse.
    if sign_in_identifier(email) in {sign_in_identifier(str(slot.get("email") or "")) for slot in others}:
        return WriteRefusal(error_code=Code.BEWERBUNG_KONTAKT_EMAIL_TAKEN, status=HTTPStatus.CONFLICT, fields=(("email",),))

    if normalise_phone(phone) in {normalise_phone(str(slot.get("phone") or "")) for slot in others}:
        return WriteRefusal(error_code=Code.BEWERBUNG_KONTAKT_PHONE_TAKEN, status=HTTPStatus.CONFLICT, fields=(("phone",),))

    return None


# --- The SEAT WRITE: „Sitz bearbeiten“, one write judged by the seat's state.


def find_seat_write_refusal(*, confirmations: Any, seats: Sequence[str]) -> WriteRefusal | None:
    """Why no person may be written into these seats, or `None`: one of them was erased at its person's request.

    Every other state takes the write, a standing seat's person replaced, a seat a Widerspruch emptied filled. The
    erasure clears the whole entry, which is all that parts it from the slot a Widerspruch empties, and a seat the
    league cannot reopen stays shut. EVERY seat, because a claimed pair is one person.
    """

    for seat in seats:
        if _entry_of(confirmations, seat) is None:
            return WriteRefusal(
                error_code=Code.BEWERBUNG_SEAT_ALREADY_ANSWERED,
                status=HTTPStatus.CONFLICT,
            )

    return None


def claimed_pair_seat(*, kontakte: Any, seat: str) -> FLKontaktRolle | None:
    """The other seat `trainer_is_also` claims for this person, standing or emptied.

    `paired_seat` without its `seat_stands` half, which answers `None` for exactly the emptied slots
    a seat write fills and would leave one of them holding the other's link.
    """

    zugleich = kontakte.get("trainer_is_also") if isinstance(kontakte, Mapping) else None
    if zugleich is None:
        return None

    return seat_named(zugleich) if seat == "trainer" else ("trainer" if seat == zugleich else None)


def compose_kontakt_seat_update(
    *, seats: Sequence[str], person: Mapping[str, Any], today: str, kontakte: Any, confirmations: Any
) -> Mapping[str, Any]:
    """The person and their fresh link, in ONE `$set`. Two writes would seat them behind the link the seat's last holder still holds."""

    # A Widerspruch on a seat this write leaves still stands, and so does the deletion its notice announced, on the day it named.
    stands = any(_declined_on(confirmations, seat) is not None for seat in KONTAKT_ROLLEN if seat not in seats)
    moved = _moves_the_deletion_day(kontakte=kontakte, confirmations=confirmations, seats=seats, today=today)
    # The notice told the mailbox this write may replace, and a mistyped one told nobody: the person now seated is owed it.
    told = "ansprechperson" not in seats
    announced = {} if stands and not moved and told else {"erasure_announced_at": None}
    # Born afresh: nothing of the seat's last holder, a confirmed one's answer included, travels to the one seated.
    einwilligung = compose_einwilligung(today=today, entered_by="liga")
    # Null rather than left off, as the submission writes it: the key marks a date not yet entered,
    # and the confirmation fills it.
    slot = {**person, "birth_date": None, "einwilligung": einwilligung}

    # The WHOLE slot per seat, never a dotted path under it: a decline nulled the slot, and a dotted
    # `$set` under a null is `PathNotViable`, which aborts the transaction.
    return {"$set": {**{f"kontakte.{seat}": dict(slot) for seat in seats}, **_fresh_links(seats=seats, today=today), **announced}}


# --- The retention SWEEP. Seven clocks, each a pure predicate over one document and `today`, so
# every boundary is pinned without a container. Dates, never instants: an instant would move the
# boundary with the hour a pass happens to run.


def next_saison_id(saison_id: str) -> str:
    """The lowest id the next season can hold.

    Raises rather than answering nothing: the accepted clock and the contact block both hang off the
    successor, so an absent one stops both for ever with nothing in any log.
    """

    # `isascii()` beside `isdigit()`, which alone is true of Arabic-Indic and fullwidth digits: `int`
    # reads those as a year and returns an ASCII successor, naming a season the original cannot be
    # matched to.
    if not (saison_id.isascii() and saison_id.isdigit() and len(saison_id) == SAISON_ID_LENGTH):
        raise ValueError(f"the retention sweep needs a season id of {SAISON_ID_LENGTH} ASCII digits, and this season's is not one")

    return f"{int(saison_id) + 1:0{SAISON_ID_LENGTH}d}"


def one_month_after(*, day: str) -> str:
    """The same day of the next month, clamped to that month's end.

    The bound is one calendar month, and thirty days is not that.
    """

    start = date.fromisoformat(day)
    year, month = (start.year + 1, 1) if start.month == 12 else (start.year, start.month + 1)
    last_day = (date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)) - timedelta(days=1)

    return date(year, month, min(start.day, last_day.day)).isoformat()


def latest_decision_due(*, today: str) -> str:
    """The last decision day whose month is behind it today.

    Found through `one_month_after`, never a month counted back from today: that month CLAMPS to a
    short month's end and drops the due decisions of the days past it.
    """

    day = date.fromisoformat(today)
    while one_month_after(day=day.isoformat()) > today:
        day -= timedelta(days=1)

    return day.isoformat()


def _entry_of(confirmations: Any, seat: str) -> Mapping[str, Any] | None:
    entry = confirmations.get(seat) if isinstance(confirmations, Mapping) else None

    return entry if isinstance(entry, Mapping) else None


def seat_reminder_is_due(*, kontakte: Any, confirmations: Any, seat: str, today: str, unreachable: bool) -> bool:
    """Whether this seat's one reminder is owed today: open, unanswered, never reminded, mailed three or more days ago, link live, reachable.

    `unreachable` is `state_undeliverable` of the seat's last mail (`seat_state`).

    A re-sent seat carries a later `sent_at` and reaches its mark on its own; one already
    reminded never is again.
    """

    entry = _entry_of(confirmations, seat)
    if entry is None or _seat_is_confirmed(kontakte, seat) or entry.get("declined_at") is not None:
        return False

    if entry.get("reminded_at") is not None or not isinstance(entry.get("sent_at"), str):
        return False

    if _deadline_passed(deadline=entry.get("deadline"), today=today):
        return False

    # A seat gets ONE chase, and spending it on an address the provider has refused, or whose person reported the mail
    # as spam, spends it on nobody: the clock closes it (`closed_chases`), and a re-send or a seat write opens it again.
    if unreachable:
        return False

    return days_after(day=entry["sent_at"], days=BEWERBUNG_REMINDER_DAYS) <= today


def reminder_seats(*, bewerbung_raw: Mapping[str, Any], today: str, unreachable: Container[str]) -> list[FLKontaktRolle]:
    """Every seat of this application owed a reminder today, in declaration order; none once it is decided.

    `unreachable` names the seats whose last mail did not arrive.
    """

    if _is_decided(bewerbung_raw.get("status")):
        return []

    kontakte, confirmations = bewerbung_raw.get("kontakte"), bewerbung_raw.get("confirmations")

    return [
        seat
        for seat in KONTAKT_ROLLEN
        if seat_reminder_is_due(kontakte=kontakte, confirmations=confirmations, seat=seat, today=today, unreachable=seat in unreachable)
    ]


def closed_chases(*, bewerbung_raw: Mapping[str, Any], today: str, unreachable: Container[str]) -> list[FLKontaktRolle]:
    """The seats due today but for a last mail that did not arrive, whose one chase the clock stamps over.

    No query reads the Postausgang, so unstamped they stay in the clock's read until their deadline, and a page of them
    hides every newer row. The stamp costs nobody a link: the next one a seat is mailed comes from a re-send or a seat
    write, each replacing the entry with the stamp in it.
    """

    return [seat for seat in reminder_seats(bewerbung_raw=bewerbung_raw, today=today, unreachable=()) if seat in unreachable]


def group_seats_by_mailbox(*, kontakte: Any, seats: Sequence[FLKontaktRolle]) -> list[tuple[str, list[FLKontaktRolle]]]:
    """The seats as the mails go out: one message per stored address, in first-seen order."""

    slots = kontakte if isinstance(kontakte, Mapping) else {}
    grouped: dict[str, tuple[str, list[FLKontaktRolle]]] = {}

    for seat in seats:
        slot = slots.get(seat)
        email = str(slot.get("email") or "").strip() if isinstance(slot, Mapping) else ""
        if not email:
            continue
        address, held = grouped.setdefault(email, (email, []))
        held.append(seat)

    return list(grouped.values())


def compose_erinnerung_update(*, seats: Sequence[str], today: str) -> Mapping[str, Any]:
    """The reminder's stamp per seat. `sent_at` and the seat's deadline stay: a reminder is not a re-send, and its link joins the first."""

    return {"$set": {f"confirmations.{seat}.reminded_at": today for seat in seats}}


def _earliest_deadline(*, confirmations: Any, seats: Iterable[str]) -> str | None:
    days = [seat_deadline_of(confirmations=confirmations, seat=seat) for seat in seats]

    return min((day for day in days if isinstance(day, str)), default=None)


def deletion_day(*, kontakte: Any, confirmations: Any) -> str | None:
    """The last day this application stands on: the earliest deadline among its outstanding seats, what a Widerspruch's notice names.

    Every write moving it takes the notice's stamp back, and so does one seating an Ansprechperson, so a stamp means the
    named day still holds and the person in that seat was told it.
    """

    return _earliest_deadline(confirmations=confirmations, seats=pending_seats(kontakte=kontakte))


def deletion_is_due(*, bewerbung_raw: Mapping[str, Any], today: str) -> bool:
    """Whether the fourteen-day clock takes this application: submitted, an outstanding seat past its own deadline.

    A seat's 14 days are that person's: past them the application goes, however long another seat's fresh link still
    runs, or a re-send of one seat would keep the others' details past their own (`build_deletion_filter`). A seat an
    erasure emptied holds no deadline and takes nobody else, so that application goes once no seat's link runs.

    Nothing about the Ansprechperson's mail holds the day up: the people named were promised it, and `owed_erasure`
    owes the notice as for any address, an empty slot or a seat never mailed leaving nobody to tell.

    STRICTLY past: the link answers on the deadline's own day, so the deletion waits a day. An
    emptied seat is outstanding.
    """

    if bewerbung_raw.get("status") != "submitted":
        return False

    kontakte, confirmations = bewerbung_raw.get("kontakte"), bewerbung_raw.get("confirmations")
    day = deletion_day(kontakte=kontakte, confirmations=confirmations)
    if _deadline_passed(deadline=day, today=today):
        return True

    days = [seat_deadline_of(confirmations=confirmations, seat=seat) for seat in KONTAKT_ROLLEN]

    return None in days and not any(isinstance(other, str) and other >= today for other in days)


def deletion_was_announced(*, bewerbung_raw: Mapping[str, Any]) -> bool:
    """Whether this application's deletion notice is behind it: a Widerspruch's notice named the deletion day, so no second goes."""

    return isinstance(bewerbung_raw.get("erasure_announced_at"), str)


# One read's ceiling, and one past it tells a full page from a truncated one
# (which the registration sweep keeps the same way).
SWEEP_PAGE: Final = LIST_LIMIT_MAX


# The terms `seat_reminder_is_due` asks of one seat, as a query, so a reminded seat leaves the read.
def _seat_reminder_term(*, seat: str, today: str) -> Mapping[str, Any]:
    return {
        f"confirmations.{seat}.sent_at": {"$lte": days_after(day=today, days=-BEWERBUNG_REMINDER_DAYS)},
        # `$not` rather than `$gte`: a seat carrying no readable deadline has a link that is not over.
        f"confirmations.{seat}.deadline": {"$not": {"$lt": today}},
        f"confirmations.{seat}.reminded_at": None,
        f"confirmations.{seat}.declined_at": None,
        f"kontakte.{seat}.einwilligung.confirmed_at": None,
    }


def build_erinnerung_filter(*, saison_id: str, today: str) -> Mapping[str, Any]:
    """Every application with a seat owed its reminder, as `reminder_seats` judges it.

    In the query: the clock stamps a share a pass, and a read keeping stamped rows hands the next
    pass the same page.
    """

    return {
        "saison_id": saison_id,
        "status": "submitted",
        "$or": [_seat_reminder_term(seat=seat, today=today) for seat in KONTAKT_ROLLEN],
    }


# A seat past its own day with no stamp, as a query: the null term reaches a seat a Widerspruch emptied as well.
def _lapsed_seat_term(*, seat: str, today: str) -> Mapping[str, Any]:
    return {f"confirmations.{seat}.deadline": {"$lt": today}, f"kontakte.{seat}.einwilligung.confirmed_at": None}


def build_deletion_filter(*, saison_id: str, today: str) -> Mapping[str, Any]:
    """Every application the fourteen-day clock may take, as a query: a confirmed one would otherwise fill the page ahead of a due one.

    Each seat's two terms are `deletion_is_due`'s two arms: its own deadline passed unconfirmed, or the entry an erasure
    emptied with no other seat's link running.
    """

    passed = [_lapsed_seat_term(seat=seat, today=today) for seat in KONTAKT_ROLLEN]
    erased = [
        {
            f"confirmations.{seat}": None,
            **{f"confirmations.{other}.deadline": {"$not": {"$gte": today}} for other in KONTAKT_ROLLEN if other != seat},
        }
        for seat in KONTAKT_ROLLEN
    ]

    return {"saison_id": saison_id, "status": "submitted", "$or": [*passed, *erased]}


def lapsed_seats(*, kontakte: Any, confirmations: Any, today: str) -> list[FLKontaktRolle]:
    """The seats of a season row whose link's day has passed with no confirmation, in declaration order.

    STRICTLY past, as `saison_link_is_over` ends the link. A confirmed seat keeps its entry, an erased one holds no
    deadline, and a seat a Widerspruch emptied still holds its link, which goes on the same day.
    """

    return [
        seat
        for seat in KONTAKT_ROLLEN
        if saison_link_is_over(deadline=seat_deadline_of(confirmations=confirmations, seat=seat), today=today)
        and not _seat_is_confirmed(kontakte, seat)
    ]


def build_lapsed_seats_filter(*, saison_id: str, today: str) -> Mapping[str, Any]:
    """Every season row of this season with a lapsed seat, as `lapsed_seats` judges it: an emptied seat leaves the read."""

    return {"saison_id": saison_id, "$or": [_lapsed_seat_term(seat=seat, today=today) for seat in KONTAKT_ROLLEN]}


def compose_lapsed_seats_update(*, kontakte: Any, seats: Sequence[str]) -> Mapping[str, Any]:
    """Null each seat and its link, the block's other members standing.

    The slots only where the block stands: a `$set` under a null is `PathNotViable`, and a row whose people an earlier
    write cleared can still hold a link.
    """

    slots = {f"kontakte.{seat}": None for seat in seats} if isinstance(kontakte, Mapping) else {}

    return {"$set": {**slots, **{f"confirmations.{seat}": None for seat in seats}}}


def addresses_leaving(*, kontakte: Any, seats: Sequence[str]) -> set[str]:
    """These seats' addresses no other seat of the row keeps, on the fold: a person staying in a seat they confirmed keeps their images."""

    staying = [seat for seat in KONTAKT_ROLLEN if seat not in seats]
    kept = {sign_in_identifier(address) for address in seat_addresses(kontakte=kontakte, seats=staying)}

    return {sign_in_identifier(address) for address in seat_addresses(kontakte=kontakte, seats=seats)} - kept


def decline_loeschung_is_due(*, bewerbung_raw: Mapping[str, Any], today: str) -> bool:
    """Whether the one-month clock takes this declined application, counted from the day the decision was taken."""

    if bewerbung_raw.get("status") != "declined":
        return False

    entscheidung = bewerbung_raw.get("decision")
    getroffen_am = entscheidung.get("made_at") if isinstance(entscheidung, Mapping) else None

    return isinstance(getroffen_am, str) and one_month_after(day=getroffen_am) <= today


def season_has_ended(*, saison_status: Any) -> bool:
    """Whether a season is over.

    Read off `saisons.status` rather than computed from a date, as the design fixes; a season not
    yet created is not past.
    """

    return saison_status == "past"


def season_after_has_ended(*, later_saison_status: Any) -> bool:
    """The accepted clock and the contact block share one test: any season after the one applied for has ended.

    The router asks it only while the season applied for is not `active`, the rule's other half.
    """

    return season_has_ended(saison_status=later_saison_status)


def acceptance_erasure_is_due(*, bewerbung_raw: Mapping[str, Any], later_saison_status: Any) -> bool:
    return bewerbung_raw.get("status") == "accepted" and season_after_has_ended(later_saison_status=later_saison_status)


def undecided_loeschung_is_due(*, bewerbung_raw: Mapping[str, Any], saison_status: Any) -> bool:
    """Whether the season's own end takes this application: undecided, and its season is over.

    Nothing else is asked: a confirmed seat drops an application out of the fourteen-day clock.
    """

    return bewerbung_raw.get("status") == "submitted" and season_has_ended(saison_status=saison_status)


def schule_name(*, bewerbung_raw: Mapping[str, Any], club_names: Mapping[Any, str]) -> str:
    """The school's name as submitted, or the picked club's as the router resolved it; empty where neither resolves."""

    schule = bewerbung_raw.get("schule")
    if isinstance(schule, Mapping):
        return str(schule.get("team_name") or "")

    return club_names.get(bewerbung_raw.get("team_id"), "")


def first_name_of(*, kontakte: Any, seat: str) -> str | None:
    slot = kontakte.get(seat) if isinstance(kontakte, Mapping) else None

    return str(slot.get("first_name") or "") or None if isinstance(slot, Mapping) else None


# --- The MAILS an application owes, each to one person: an address is one person (one seat, or two the Trainer holds).


def bewerbung_link(seats: Sequence[str], *, replaced: bool) -> FLOutboxLink:
    """Where one person's mailed link lives on the application, and the addresses it is minted for while they still stand.

    Every seat the person holds, so one press answers both. A reminder's link joins the first (`replaced` clear); every
    other mail's supersedes what the seat holds at its hand-out, so a link owed before a re-send and handed out after it
    opens nothing, as the re-send's write promised.
    """

    return FLOutboxLink(
        paths=[f"confirmations.{seat}.token_hashes" for seat in seats],
        addresses=[f"kontakte.{seat}.email" for seat in seats],
        replaced=replaced,
    )


def bewerbung_reference(bewerbung_id: Any, seats: Sequence[FLKontaktRolle]) -> FLOutboxReference:
    """The application and the person's seat a delivery is read by: the one the Trainer mirrors, where they hold two."""

    return FLOutboxReference(collection=Collection.BEWERBUNGEN, id=bewerbung_id, seat=min(seats, key=lambda seat: seat == "trainer"))


def state_undeliverable(state: FLOutboxStatus | None) -> bool:
    """`app/api/outbox/schemas.py :: FLOutboxStatus.undeliverable` of the last mail owed one seat, `False` where none was owed."""

    return state is not None and state.undeliverable


def pending_people(*, kontakte: Any, seats: Sequence[str]) -> list[FLBewerbungPerson]:
    """These seats as the people holding them, the Trainer folded into the seat it mirrors: a mail names one person once.

    An emptied seat counts, its first name `None`: the application cannot complete without it.
    """

    zugleich = kontakte.get("trainer_is_also") if isinstance(kontakte, Mapping) else None
    people: list[FLBewerbungPerson] = []

    for seat in KONTAKT_ROLLEN:
        if seat not in seats or (seat == "trainer" and zugleich in seats):
            continue
        rollen: list[FLKontaktRolle] = [seat, "trainer"] if seat == zugleich and "trainer" in seats else [seat]
        people.append(FLBewerbungPerson(first_name=first_name_of(kontakte=kontakte, seat=seat), rollen=rollen))

    return people


def people_with_address(*, kontakte: Any, seats: Sequence[FLKontaktRolle] = KONTAKT_ROLLEN) -> list[tuple[str, list[FLKontaktRolle]]]:
    """Each person these seats name who holds an address, with the seats they hold, the Trainer last.

    One address is one person (the submission refuses two people at one), so the seats sharing an address are the one
    person `trainer_is_also` names twice. The Trainer last, so the seat a delivery is read by is the one it mirrors.
    """

    return [
        (email, sorted(held, key=lambda seat: seat == "trainer"))
        for email, held in group_seats_by_mailbox(kontakte=kontakte, seats=[seat for seat in KONTAKT_ROLLEN if seat in seats])
    ]


def owed_link(
    *,
    bewerbung_id: Any,
    kontakte: Any,
    seats: Sequence[FLKontaktRolle],
    saison_id: str,
    schule: str,
    deadline: str,
    key: str,
    kind: Literal["bewerbung_confirmation", "bewerbung_reminder"] = "bewerbung_confirmation",
) -> OwedMail:
    """One person's confirmation link, or its one reminder, the address read off the seat the write left."""

    return OwedMail(
        key=key,
        to=str(kontakte[seats[0]]["email"]),
        data=FLBewerbungLinkData(kind=kind, saison_id=saison_id, schule=schule, rollen=list(seats), deadline=deadline),
        reference=bewerbung_reference(bewerbung_id, seats),
        link=bewerbung_link(seats, replaced=kind != "bewerbung_reminder"),
    )


def owed_at_submission(
    *, bewerbung_id: Any, kontakte: Any, saison_id: str, schule: str, deadline: str, unmailed: Container[str]
) -> list[OwedMail]:
    """Every person's first mail: the Ansprechperson the receipt naming who is still to answer, each other person their link.

    None to an `unmailed` seat. Keyed by the application and the person's first seat, so a retried transaction owes nothing twice.
    """

    mails: list[OwedMail] = []
    for email, seats in people_with_address(kontakte=kontakte, seats=[seat for seat in KONTAKT_ROLLEN if seat not in unmailed]):
        stem = f"{Collection.BEWERBUNGEN}/{bewerbung_id}"
        if "ansprechperson" not in seats:
            mails.append(
                owed_link(
                    bewerbung_id=bewerbung_id,
                    kontakte=kontakte,
                    seats=seats,
                    saison_id=saison_id,
                    schule=schule,
                    deadline=deadline,
                    key=f"{stem}/confirmation/{seats[0]}",
                )
            )
            continue
        andere = [seat for seat in KONTAKT_ROLLEN if seat not in seats]
        mails.append(
            OwedMail(
                key=f"{stem}/received",
                to=email,
                data=FLBewerbungReceivedData(
                    kind="bewerbung_received",
                    saison_id=saison_id,
                    rollen=seats,
                    pending=pending_people(kontakte=kontakte, seats=andere),
                    deadline=deadline,
                ),
                reference=bewerbung_reference(bewerbung_id, seats),
                link=bewerbung_link(seats, replaced=True),
            )
        )

    return mails


def owed_erasure(*, bewerbung_raw: Mapping[str, Any], saison_id: str) -> OwedMail | None:
    """The fourteen-day clock's notice to the Ansprechperson, naming who never confirmed.

    `None` where `ansprechperson_mailbox` leaves nobody to tell, or where a Widerspruch's notice already named the deletion.
    """

    kontakte = bewerbung_raw.get("kontakte")
    email, rollen = ansprechperson_mailbox(kontakte=kontakte, confirmations=bewerbung_raw.get("confirmations"))
    if email is None or deletion_was_announced(bewerbung_raw=bewerbung_raw):
        return None

    return OwedMail(
        key=f"{Collection.BEWERBUNGEN}/{bewerbung_raw['_id']}/erasure",
        to=email,
        data=FLBewerbungErasureData(
            kind="bewerbung_erasure",
            saison_id=saison_id,
            rollen=rollen,
            pending=pending_people(kontakte=kontakte, seats=pending_seats(kontakte=kontakte)),
        ),
    )


def assigned_trikot_farben(*, stored: Sequence[Any]) -> list[FLTrikotFarbe]:
    """The season's assigned colours, in the palette's own order.

    The RETURN filters through the palette rather than sorting `held` by it: a row assigned nothing
    yields a null, which the palette never holds.
    """

    # `set(stored)` is the shorthand this refuses: an unhashable BSON value would raise there, where
    # this drops it. The record model forbids one (`app/api/teams/schemas.py :: FLSaisonTeamRecord`), so this
    # holds the boundary rather than a case any test can reach.
    held = {value for value in stored if isinstance(value, str)}

    # The form disables what this returns (`fl_frontend/src/app/(classic)/bewerbung/[saison]/BewerbungFields.tsx`).
    return [colour for colour in get_args(FLTrikotFarbe.__value__) if colour in held]


# --- The VIEW READS: one a page, each serving what its page shows.


def build_form_pipeline(*, saison_id: str) -> list[Mapping[str, Any]]:
    """What the form's page needs from one aggregation over the season's row, the window's carve-out at this tier.

    A club retired out of the league is no club to apply as, and a row a club left the season on keeps its colour
    (`app/api/teams/crud.py :: refuse_a_taken_colour`).
    """

    return [
        {"$match": {"_id": saison_id}},
        {"$project": {"bewerbung": 1, "status": 1}},
        {
            "$lookup": {
                "from": Collection.SAISON_TEAMS,
                "pipeline": [{"$match": {"saison_id": saison_id}}, {"$group": {"_id": "$trikot_farbe"}}],
                "as": "colours",
            }
        },
        {
            "$lookup": {
                "from": Collection.TEAMS,
                "pipeline": [{"$match": {"inactive_since": None}}, {"$sort": {"name": 1}}, {"$project": {"name": 1}}],
                "as": "schulen",
            }
        },
    ]


def build_entry_offer_pipeline(*, saison_id: str) -> list[Mapping[str, Any]]:
    """The season's rules and status beside its rows, every row taking a place, a club that left included (`find_entry_refusal`)."""

    return [
        {"$match": {"_id": saison_id}},
        {"$project": {"status": 1, "rules": 1}},
        {
            "$lookup": {
                "from": Collection.SAISON_TEAMS,
                "pipeline": [{"$match": {"saison_id": saison_id}}, {"$project": {"gruppe": 1, "trikot_farbe": 1}}],
                "as": "rows",
            }
        },
    ]


# What the season's list shows of an application: an INCLUSION, so nobody's details cross the wire for a page that
# shows none.
BEWERBUNG_LIST_FIELDS: Mapping[str, int] = {
    **_per_seat("kontakte", "einwilligung.confirmed_at"),
    **_per_seat("confirmations", "sent_at"),
    "version": 1,
    "saison_id": 1,
    "status": 1,
    "submitted_at": 1,
    "team_id": 1,
    "schule.team_name": 1,
    "kontakte.trainer_is_also": 1,
    "trikot.wunschfarbe": 1,
    "stufengroesse": 1,
    "kader.expected_size": 1,
    "wunschgegner": 1,
}


def seats_confirmed_of(*, kontakte: Any) -> int:
    return len(KONTAKT_ROLLEN) - len(pending_seats(kontakte=kontakte))


def holds_an_unmailed_seat(*, row: Mapping[str, Any]) -> bool:
    """Whether this open application holds a seat the submission owed no mail, an erased seat, which holds no entry, not among them."""

    confirmations = row.get("confirmations")

    return row["status"] == "submitted" and any(
        _entry_of(confirmations, seat) is not None and not _was_mailed(confirmations, seat) for seat in KONTAKT_ROLLEN
    )


def bewerbung_list_row(
    *, row: Mapping[str, Any], club_names: Mapping[Any, str], club_codes: Mapping[Any, str], doubled: Container[Any]
) -> dict[str, Any]:
    """One stored application as `FLBewerbungListRow` serves it, `doubled` being the clubs `build_duplicates_pipeline` found."""

    return {
        "id": row["_id"],
        "version": row["version"],
        "status": row["status"],
        "submitted_at": row["submitted_at"],
        "name": schule_name(bewerbung_raw=row, club_names=club_names),
        "new_school": isinstance(row.get("schule"), Mapping),
        "shorthand": club_codes.get(row.get("team_id")),
        "wunschfarbe": row["trikot"]["wunschfarbe"],
        "stufengroesse": row["stufengroesse"],
        "expected_kader": row["kader"]["expected_size"],
        "wunschgegner": row.get("wunschgegner"),
        "seats_confirmed": seats_confirmed_of(kontakte=row.get("kontakte")),
        "people": len(KONTAKT_ROLLEN) - (1 if row["kontakte"].get("trainer_is_also") else 0),
        "duplicate": row["status"] == "submitted" and row.get("team_id") in doubled,
        "unmailed": holds_an_unmailed_seat(row=row),
    }


def build_bewerbungen_sort(*, order: str) -> list[tuple[str, int]]:
    """The triage queue's order, tie-broken by `_id`."""

    # `_id` breaks the tie in `order`'s OWN direction, so same-day rows read the way the queue does
    # and the pair is the index's key or its exact inverse. Pinned descending, `order=asc` would
    # match neither and scan the whole archive.
    direction = 1 if order == "asc" else -1

    return build_sort(sort_by="submitted_at", order=order, chain=(("_id", direction),))


def build_confirmed_seat_filter(*, saison_id: str) -> Mapping[str, Any]:
    """Every application of the season with a confirmed seat, the list's way back past the newest rows a flood fills.

    A flood naming strangers confirms nothing, each seat taking a mailed link and its person's birthdate. A sender holding
    the mailboxes can confirm, one link at a time, and only that fills this read too.
    """

    return {"saison_id": saison_id, "$or": [{f"kontakte.{seat}.einwilligung.confirmed_at": {"$ne": None}} for seat in KONTAKT_ROLLEN]}


def build_duplicates_pipeline(*, saison_id: str) -> list[Mapping[str, Any]]:
    """Every club more than one open application of the season names, what `bewerbung_list_row` marks.

    A new school names no club, so two of them never collide: the Dublette is a display aid, and acceptance's unique
    code is what holds two clubs apart.
    """

    # No `$limit`: the collision is a fact about the queue, and a pass stopping where the page stops leaves a split pair
    # unseen at both ends.
    return [
        {"$match": {"saison_id": saison_id, "status": "submitted", "team_id": {"$ne": None}}},
        {"$group": {"_id": "$team_id", "count": {"$sum": 1}}},
        {"$match": {"count": {"$gt": 1}}},
    ]


def decider_addresses(rows: Iterable[Mapping[str, Any]]) -> list[str]:
    """Every administrator these stored applications name as their decider, folded as the ban list is asked."""

    return [sign_in_identifier(FLBewerbungDecision.model_validate(row["decision"]).by) for row in rows if row.get("decision") is not None]


def mit_vorenthaltener_entscheidung(row: Mapping[str, Any], barred: Container[str]) -> dict[str, Any]:
    """A stored application with its decision as every read serves it."""

    if row.get("decision") is None:
        return dict(row)

    # As stored first, so a decision the stored shape refuses fails rather than being served withheld.
    entscheidung = FLBewerbungDecision.model_validate(row["decision"])
    by = withheld_actor(entscheidung.by, barred)

    return {**row, "decision": {**entscheidung.model_dump(), "by": by, "by_barred": by is None}}


def seat_state(*, row: Mapping[str, Any], states: Mapping[tuple[Any, str | None], FLOutboxStatus], seat: str) -> FLOutboxStatus | None:
    """The last mail owed this seat of a stored application, `None` where none was.

    A Trainer who is another seat's person reads that seat's mail: one person is sent one mail for both, read by the
    seat it mirrors (`bewerbung_reference`).
    """

    kontakte = row.get("kontakte")
    zugleich = kontakte.get("trainer_is_also") if isinstance(kontakte, Mapping) else None
    mirrored = states.get((row["_id"], zugleich)) if seat == "trainer" and zugleich else None

    return mirrored or states.get((row["_id"], seat))


def unreachable_seats(*, row: Mapping[str, Any], states: Mapping[tuple[Any, str | None], FLOutboxStatus]) -> set[str]:
    """The seats of a stored application whose last mail did not arrive."""

    return {seat for seat in KONTAKT_ROLLEN if state_undeliverable(seat_state(row=row, states=states, seat=seat))}


def with_delivery(row: Mapping[str, Any], states: Mapping[tuple[Any, str | None], FLOutboxStatus], *, today: str) -> dict[str, Any]:
    """A stored application with each seat's last mail and its state beside its bookkeeping, as every read serves it.

    The state is `zustand_of`'s, the one a reopened link shows, so the administrator's page and the person's never disagree.
    No ban is asked: `barred` ranks a link's page, and this page's re-send and seat write judge the list themselves.
    """

    confirmations = row.get("confirmations")
    if not isinstance(confirmations, Mapping):
        return dict(row)

    return {
        **row,
        "confirmations": {
            seat: {
                **entry,
                "delivery": seat_state(row=row, states=states, seat=seat),
                "state": zustand_of(bewerbung_raw=row, seat=seat, today=today, barred=False),
            }
            if isinstance(entry, Mapping)
            else entry
            for seat, entry in confirmations.items()
        },
    }
