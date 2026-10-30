import hashlib
import json
from collections.abc import Collection, Iterable, Mapping, Sequence
from datetime import date, timedelta
from http import HTTPStatus
from typing import Any, Final, Literal, cast, get_args

from pydantic import BaseModel, ValidationError

from app.api.bewerbungen.schemas import (
    FLBewerbungEinwilligungZustand,
    FLBewerbungEntscheidung,
    FLBewerbungSaisonReference,
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
from app.api.teams.schemas import FLPostTeamPayload
from app.core.codes import Code
from app.core.collections import Collection as Sammlung
from app.core.crud import build_sort
from app.core.exceptions import WriteRefusal
from app.shared.einwilligung import is_confirmed
from app.shared.einwilligung_nachweis import compose_choices
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import (
    BEWERBUNG_CONFIRMATION_DEADLINE_DAYS,
    BEWERBUNG_KONTAKT_MIN_AGE_YEARS,
    BEWERBUNG_REMINDER_DAYS,
    LIST_LIMIT_MAX,
    SAISON_ID_LENGTH,
    VERTRETUNG_MIN_AGE_YEARS,
)
from app.shared.schemas.custom import fold_shorthand
from app.shared.schemas.literals import KONTAKT_ROLLEN, FLKontaktEnteredBy, FLKontaktRolle, FLTrikotFarbe


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


# The school's field names in the club's. `team_name` becomes the club's `name`; the other five are
# spelled alike on both sides, and `description` is on neither.
_CLUB_FIELDS_FROM_SCHULE = {
    "team_name": "name",
    "full_name": "full_name",
    "shorthand": "shorthand",
    "schulform": "schulform",
    "address": "address",
    "website_url": "website_url",
}


def compose_new_club(*, schule: Any) -> dict[str, Any]:
    """The club document acceptance would create, from the school's block AS STORED.

    Raw so `find_new_club_refusal` judges every field: a `str()` here makes a club named `'None'`
    from a null with no undo, and a subscript 500s where the rule promises 409.
    """

    fields = schule if isinstance(schule, Mapping) else {}

    return {
        # Empty rather than composed from the application: `description` is the club's own public
        # blurb, and a sentence the league wrote would stand on the team page as though the school
        # had written it.
        "description": "",
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


def window_is_running(*, bewerbung: Any, today: str) -> bool:
    """Whether this season's application window runs on `today`: `offen`, AND the day inside the span.

    Both ends are compared rather than assuming `von <= bis`: span ordering is enforced on the
    season PAYLOAD alone, so a stored reversal is reachable.
    """

    if bewerbung is None:
        return False

    return bool(bewerbung["offen"]) and str(bewerbung["von"]) <= today <= str(bewerbung["bis"])


def saison_nimmt_bewerbungen_an(*, saison_status: Any, bewerbung: Any, today: str) -> bool:
    """Whether this season takes an application on `today`.

    A finished season's window is over for good, whatever dates it still stores: the payload names
    the season, and the dates alone would still admit an application into one that has ended.
    """

    return not season_has_ended(saison_status=saison_status) and window_is_running(bewerbung=bewerbung, today=today)


# `season_has_ended`'s negation for a read that narrows in the query. Every write stores a season's status, which is why
# the readers of this filter's rows subscript it.
SAISON_NOT_ENDED_FILTER: Final[Mapping[str, Any]] = {"status": {"$ne": "past"}}


def find_window_refusal(*, saison_status: Any, bewerbung: Any, today: str) -> WriteRefusal | None:
    """Why this season is taking no application today, or `None`.

    ONE code for every way `saison_nimmt_bewerbungen_an` says no: naming which would report a
    season's administrative state to an anonymous visitor.
    """

    if saison_nimmt_bewerbungen_an(saison_status=saison_status, bewerbung=bewerbung, today=today):
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
    """Why this club may not apply for this season, or `None`.

    A club already holding the season's junction row is IN it, so an application would ask for
    something already granted. A shared season is not refused: two schools may apply on one day.
    """

    if entered:
        return WriteRefusal(
            error_code=Code.BEWERBUNG_PICKED_TEAM_ALREADY_ENTERED,
            status=HTTPStatus.CONFLICT,
        )

    return None


def find_shorthand_refusal(*, taken: bool) -> WriteRefusal | None:
    """Why the proposed Kürzel cannot be the new school's, or `None`.

    Asked here as well as by the availability check, which narrows the collision without preventing
    it: acceptance would otherwise fail on a duplicate key, the school already told it applied.
    """

    if taken:
        return WriteRefusal(
            error_code=Code.BEWERBUNG_SHORTHAND_TAKEN,
            status=HTTPStatus.CONFLICT,
        )

    return None


# --- The SUBMISSION KEY, which the registration's submission takes from here.


def payload_fingerabdruck(payload: BaseModel) -> str:
    """The digest a replayed key's payload is compared by.

    Over the VALIDATED payload: two spellings the model stores alike, or one body serialised in two
    key orders, are one request. Keys sorted, so a mapping-typed field cannot reorder it.
    """

    canonical = json.dumps(payload.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False)

    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def build_schluessel_filter(*, key: str) -> Mapping[str, Any]:
    """The key lookup, carrying the unique index's partial term.

    An equality alone does not imply `$type`, so without the term the planner scans the whole collection.
    """

    return {"idempotency_key": {"$eq": key, "$type": "string"}}


def find_abweichender_fingerabdruck_refusal(*, gespeichert: Any, fingerabdruck: str) -> WriteRefusal | None:
    """Why this key cannot be replayed, or `None`: it already carries an application sent with other details.

    Refused rather than answered as the stored one, which would tell the applicant a changed field
    had arrived.
    """

    if gespeichert == fingerabdruck:
        return None

    return WriteRefusal(
        error_code=Code.BEWERBUNG_KEY_DIFFERING,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
    )


def compose_einwilligung(*, text_version: str, today: str, entered_by: FLKontaktEnteredBy) -> dict[str, Any]:
    """The contact seat's record as the server writes it: who seated the person, and nothing they answered.

    Named by no client, who could otherwise dress a transcription as a signature.
    """

    # `medien` written false rather than left off: nobody filling a seat for another person may give
    # that person's media consent.
    return {
        "umfang": "kontaktdaten",
        "text_version": text_version,
        "datum": today,
        "confirmed_at": None,
        "medien": False,
        "entered_by": entered_by,
    }


# Every seat, so a fourth one is a `KeyError` at the confirmation rather than a silent sixteen.
SEAT_MIN_AGE_YEARS: Mapping[str, int] = {
    "trainer": BEWERBUNG_KONTAKT_MIN_AGE_YEARS,
    "ansprechperson": VERTRETUNG_MIN_AGE_YEARS,
    "stellvertretung": VERTRETUNG_MIN_AGE_YEARS,
}


def mindestalter_for(seats: Sequence[str]) -> int:
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
            **{field: value for field, value in kontakte[seat].items() if field != "einwilligung"},
            # Written null rather than left off, as `wunschgegner` is: the key marks a date not yet
            # entered, and the confirmation fills it.
            "geburtsdatum": None,
            "einwilligung": compose_einwilligung(
                text_version=kontakte[seat]["einwilligung"]["text_version"], today=today, entered_by="bewerbung"
            ),
        }
        for seat in KONTAKT_ROLLEN
    }
    composed["trainer_is_also"] = kontakte["trainer_is_also"]

    return composed


# --- The CONFIRMATION.

KONTAKT_UMFANG = "kontaktdaten"
KONTAKT_UMFANG_WHATSAPP = "kontaktdaten_whatsapp"


def days_after(*, day: str, days: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=days)).isoformat()


def bestaetigungsfrist_from(*, today: str) -> str:
    """The day the links stop working and the application is deleted, counted from the mint -- a re-send restarts it."""

    return days_after(day=today, days=BEWERBUNG_CONFIRMATION_DEADLINE_DAYS)


def compose_bestaetigung(*, today: str) -> dict[str, Any]:
    """One seat's bookkeeping as the create and the re-send write it: mailed today, nobody reminded, nobody declined.

    No link yet: the hand-out of the mail the same write owes mints it into `token_hashes`, so a link replaced here opens
    nothing from this write on.
    """

    return {"token_hashes": [], "sent_at": today, "reminded_at": None, "declined_at": None}


def compose_bestaetigungen(*, today: str) -> dict[str, Any]:
    return {seat: compose_bestaetigung(today=today) for seat in KONTAKT_ROLLEN}


# The admin reads' projection, and the FIRST exclusion projection in this tree: an inclusion list
# would have to restate every field an application holds. Each seat keeps the hash of every link it
# was mailed, a reminder's beside the first, and only an administrator's re-send voids them.
WITHOUT_TOKEN_HASHES: Mapping[str, int] = {f"confirmations.{seat}.token_hashes": 0 for seat in KONTAKT_ROLLEN}


def _per_seat(block: str, *fields: str) -> dict[str, int]:
    """Each seat's copy of these paths, included, so a fourth seat cannot fall out of a read."""

    return {f"{block}.{seat}.{field}": 1 for seat in KONTAKT_ROLLEN for field in fields}


# What decides which page a seat's link opens (`kontakt_seite_of`): who seated its person.
KONTAKT_SEITE_FIELDS: Final = ("einwilligung.entered_by",)


# What an answer moves on each seat, read before it: a withdrawal keeps the grant it ended.
KONTAKT_WAHL_FIELDS: Final = ("einwilligung.umfang", "einwilligung.medien", "einwilligung.nachweis")


# An INCLUSION, and never the exclusion above inverted: these two answer a closed handful, so the
# rest of the document is what a base-tier read must not hold.
# Every hash, which `seat_holding` compares.
EINWILLIGUNG_ANSICHT_FIELDS: Mapping[str, int] = {
    **_per_seat("confirmations", "token_hashes", "declined_at"),
    # The address for the ban list alone, as the answer's read takes it: the response model declares
    # no field to carry it.
    **_per_seat("kontakte", "email", "einwilligung.confirmed_at", *KONTAKT_SEITE_FIELDS),
    # A declaration naming a seat, holding nobody's details: `paired_seat` reads it, and the view
    # serves only the pair it resolves for this link's own seat.
    "kontakte.trainer_is_also": 1,
    "saison_id": 1,
    "status": 1,
    "confirmation_deadline": 1,
    "schule.team_name": 1,
    "team_id": 1,
    # Suppressed here alone: an inclusion projection answers `_id` unasked, and only the answer's
    # read below has a patch filter to key on it.
    "_id": 0,
}

# Narrower than the view's: the answer takes its wording from the payload and names no school. The
# address is what a consent asks the ban list of, and no answer carries it.
EINWILLIGUNG_ANTWORT_FIELDS: Mapping[str, int] = {
    **_per_seat("confirmations", "token_hashes", "declined_at"),
    # The choices and their evidence, so a withdrawal names the grant it ends (`compose_choices`).
    **_per_seat("kontakte", "vorname", "email", "einwilligung.confirmed_at", *KONTAKT_WAHL_FIELDS, *KONTAKT_SEITE_FIELDS),
    "kontakte.trainer_is_also": 1,
    "saison_id": 1,
    "status": 1,
    "confirmation_deadline": 1,
}


def build_token_filter(*, token_hash: str) -> Mapping[str, Any]:
    """Every seat path, so the hash alone finds the seat. No status term: a reopened link shows its own state."""

    return {"$or": [{f"confirmations.{seat}.token_hashes": token_hash} for seat in KONTAKT_ROLLEN]}


def seat_named(value: Any) -> FLKontaktRolle | None:
    """The seat this value names, or `None`: a path segment and a stored key are both only as trustworthy as whatever wrote them."""

    return cast(FLKontaktRolle, value) if value in get_args(FLKontaktRolle.__value__) else None


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


def seat_opens_nobody(*, slot: Any, state: FLBewerbungEinwilligungZustand) -> bool:
    """Whether an open link's seat holds nobody, emptied without a Widerspruch: the view answers it as a token no seat holds.

    Told apart, it would tell a guess that a person once sat there, and offer a press `bewerbung_seat_already_answered` refuses.
    """

    return state in ("valid", "saison_past") and not isinstance(slot, Mapping)


def _is_decided(status: Any) -> bool:
    return status != "submitted"


def _deadline_passed(*, confirmation_deadline: Any, today: str) -> bool:
    return isinstance(confirmation_deadline, str) and confirmation_deadline < today


def bestaetigungsfrist_passed(*, confirmation_deadline: Any, today: str) -> bool:
    """Whether an application's confirmation deadline has passed today, by the rule its seats' links refuse on."""

    return _deadline_passed(confirmation_deadline=confirmation_deadline, today=today)


def link_is_over(*, confirmation_deadline: Any, status: Any, today: str) -> bool:
    """Whether the link is over: the deadline has passed, or the application was decided while the seat stood open."""

    return _is_decided(status) or _deadline_passed(confirmation_deadline=confirmation_deadline, today=today)


def find_expired_token_refusal(*, confirmation_deadline: Any, status: Any, today: str) -> WriteRefusal | None:
    """Why this link is over, or `None`. Judged before the seat: a seat on a decided application is never answered again."""

    if _is_decided(status):
        return WriteRefusal(
            error_code=Code.LINK_EXPIRED,
            status=HTTPStatus.GONE,
        )

    # The deadline is the application's one field, and a re-send of any seat restarts it, so every
    # other seat's link answers again (`compose_erneut_update`): a conflict with state, not a spent link.
    if _deadline_passed(confirmation_deadline=confirmation_deadline, today=today):
        return WriteRefusal(
            error_code=Code.BEWERBUNG_TOKEN_PAST_DEADLINE,
            status=HTTPStatus.CONFLICT,
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


def find_alter_refusal(*, geburtsdatum: str, today: str, minimum_age: int) -> WriteRefusal | None:
    """Why the typed date is refused, or `None`.

    Its own code rather than a `payload_refused`, whose mark on the field names no floor. Judged BEFORE any write, so
    a mistyped year spends nothing.
    """

    if age_outside_the_bounds(geburtsdatum=geburtsdatum, today=today, minimum_age=minimum_age):
        return WriteRefusal(
            error_code=Code.CONFIRMATION_AGE,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            fields=(("geburtsdatum",),),
        )

    return None


def _zustand(*, kontakte: Any, confirmations: Any, seat: str, over: bool, barred: bool) -> FLBewerbungEinwilligungZustand:
    """The one ranking both records' links are shown in: the ban first, then a stamp."""

    if barred:
        return "barred"

    if _seat_is_confirmed(kontakte, seat):
        return "confirmed"

    if _declined_on(confirmations, seat) is not None:
        return "declined"

    return "expired" if over else "valid"


def zustand_of(*, bewerbung_raw: Mapping[str, Any], seat: str, today: str, barred: bool) -> FLBewerbungEinwilligungZustand:
    """What a reopened link shows. A confirmed seat on an accepted application reads as confirmed."""

    over = link_is_over(confirmation_deadline=bewerbung_raw.get("confirmation_deadline"), status=bewerbung_raw.get("status"), today=today)

    return _zustand(
        kontakte=bewerbung_raw.get("kontakte"), confirmations=bewerbung_raw.get("confirmations"), seat=seat, over=over, barred=barred
    )


# --- A TEAM'S SEASON ROW. A contact seat an administrator typed in is mailed its own link, resolved
# by the application's two operations: the slots and stamps are one shape, only the deadline's home
# differing.


def build_saison_token_filter(*, token_hash: str) -> Mapping[str, Any]:
    """Every seat path, so the hash alone finds the seat on whichever row holds it."""

    return {"$or": [{f"confirmations.{seat}.token_hashes": token_hash} for seat in KONTAKT_ROLLEN]}


# An INCLUSION for `EINWILLIGUNG_ANSICHT_FIELDS`' reason: the rest of the row is what a base-tier read
# must not hold. The address is the ban list's alone, and the club's season name is the page's
# `schule`.
SAISON_EINWILLIGUNG_FIELDS: Mapping[str, int] = {
    **_per_seat("confirmations", "token_hashes", "declined_at", "frist"),
    **_per_seat("kontakte", "email", "einwilligung.confirmed_at", *KONTAKT_SEITE_FIELDS),
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
# and their evidence as `EINWILLIGUNG_ANTWORT_FIELDS` does.
SAISON_EINWILLIGUNG_ANTWORT_FIELDS: Mapping[str, int] = {
    **SAISON_EINWILLIGUNG_FIELDS,
    **_per_seat("kontakte", *KONTAKT_WAHL_FIELDS),
    "_id": 1,
}


def saison_frist_of(*, confirmations: Any, seat: str) -> Any:
    """The deadline the seat's own link carries: each seat is minted on its own day, so the row holds none."""

    entry = confirmations.get(seat) if isinstance(confirmations, Mapping) else None

    return entry.get("frist") if isinstance(entry, Mapping) else None


def saison_link_is_over(*, frist: Any, today: str) -> bool:
    """Whether a season row's seat link is past its own deadline: what its press refuses (`link_expired`) and the editor shows."""

    return _deadline_passed(confirmation_deadline=frist, today=today)


def row_takes_confirmations(*, saison_status: Any, austritt: Any) -> bool:
    """Whether a season row's seat still asks its person to confirm it: not once its season ended or its team left it.

    Such a seat grants no panel, and a confirmation collects a birthdate for nothing.
    """

    return saison_status != "past" and austritt is None


def saison_zustand_of(*, row: Mapping[str, Any], seat: str, today: str, barred: bool, saison_status: Any) -> FLBewerbungEinwilligungZustand:
    """What a reopened season-row link shows, its own deadline ending it, a closed row stopping its consent."""

    bestaetigungen = row.get("confirmations")
    over = saison_link_is_over(frist=saison_frist_of(confirmations=bestaetigungen, seat=seat), today=today)
    zustand = _zustand(kontakte=row.get("kontakte"), confirmations=bestaetigungen, seat=seat, over=over, barred=barred)

    # Below the deadline, as the press refuses: past it the link takes no Widerspruch either
    # (`link_expired`), while a closed row's link still takes one (`kontakt_saison_past`).
    if zustand == "valid" and not row_takes_confirmations(saison_status=saison_status, austritt=row.get("austritt")):
        return "saison_past"

    return zustand


def find_saison_frist_refusal(*, frist: Any, today: str) -> WriteRefusal | None:
    """Why a season row's link takes no answer past its own deadline, or `None`.

    410, never the application's 409: no write moves this deadline, a re-send minting another token.
    """

    if not saison_link_is_over(frist=frist, today=today):
        return None

    return WriteRefusal(
        error_code=Code.LINK_EXPIRED,
        status=HTTPStatus.GONE,
    )


def find_saison_vorbei_einwilligung_refusal(*, saison_status: Any, austritt: Any) -> WriteRefusal | None:
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


def ausstehende_seats(*, kontakte: Any) -> list[FLKontaktRolle]:
    """Every seat without a stamp, in declaration order. An emptied slot counts: the application cannot complete without it."""

    return [seat_named(seat) or cast(FLKontaktRolle, seat) for seat in KONTAKT_ROLLEN if not _seat_is_confirmed(kontakte, seat)]


def find_unconfirmed_kontakte_refusal(*, kontakte: Any) -> WriteRefusal | None:
    """Why this application is not yet one the league may accept, or `None`."""

    outstanding = ausstehende_seats(kontakte=kontakte)
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

    zugleich = kontakte.get("trainer_is_also") if isinstance(kontakte, Mapping) else None
    if zugleich is None:
        return None

    other = seat_named(zugleich) if seat == "trainer" else (cast(FLKontaktRolle, "trainer") if seat == zugleich else None)

    # An emptied seat is nobody's: a dotted `$set` under its null slot or its null entry is
    # `PathNotViable`, and the abort takes the answer for the seat that IS this person's with it.
    return other if other is not None and seat_stands(kontakte=kontakte, confirmations=confirmations, seat=other) else None


def seat_adressen(*, kontakte: Any, seats: Iterable[str]) -> set[str]:
    """The stored address of each of these seats that still holds one.

    One helper for the consent and the view, so the page shows the ban for exactly the addresses a
    press would be refused on.
    """

    slots = [kontakte.get(seat) for seat in seats] if isinstance(kontakte, Mapping) else []

    return {str(slot["email"]) for slot in slots if isinstance(slot, Mapping) and slot.get("email")}


def seat_vorname(*, kontakte: Any, seat: str) -> str:
    """The first name in a seat's slot, or `""` where the slot is empty."""

    slot = kontakte.get(seat) if isinstance(kontakte, Mapping) else None

    return str(slot.get("vorname") or "") if isinstance(slot, Mapping) else ""


def ansprechperson_mailbox(*, kontakte: Any) -> tuple[str | None, list[FLKontaktRolle]]:
    """The Ansprechperson's address as stored, and every seat that same inbox holds.

    `None` where that seat is empty: the message this addresses has nowhere to go, and a substitute
    recipient would mail a third party.
    """

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
    held = [seat for seat in KONTAKT_ROLLEN if addresses.get(seat) == anchor]

    return anchor, [seat_named(seat) or cast(FLKontaktRolle, seat) for seat in held]


def compose_confirmation_update(
    *,
    kontakte: Mapping[str, Any],
    seats: Sequence[str],
    geburtsdatum: str,
    today: str,
    text_version: str,
    whatsapp: bool,
    medien: bool,
    am: str,
) -> Mapping[str, Any]:
    """The ONE update a confirmation is, on every seat the person holds.

    The date and the stamp land together, which is why
    this is one update and never two.
    """

    written: dict[str, Any] = {}
    for seat in seats:
        pfad = f"kontakte.{seat}.einwilligung"
        written[f"kontakte.{seat}.geburtsdatum"] = geburtsdatum
        # Field by field, never the block whole: `entered_by` and `datum` are the seating's, and
        # what it tells stands after the answer.
        written[f"{pfad}.confirmed_at"] = today
        written[f"{pfad}.text_version"] = text_version
        written.update(
            compose_choices(
                path=pfad,
                saved=kontakte[seat]["einwilligung"],
                gesetzt={"umfang": KONTAKT_UMFANG_WHATSAPP if whatsapp else KONTAKT_UMFANG, "medien": medien},
                am=am,
                text_version=text_version,
            )
        )

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


def build_eigene_bewerbung_filter(*identifiers: str) -> Mapping[str, Any]:
    """Every PENDING application one of whose seats names one of these addresses.

    Pending alone: an accepted application's seats are its season row's, and a declined one's go with it.
    """

    return {"status": "submitted", **rows_seating(*identifiers)}


# The pages a contact seat's link opens, named as the registry names them: the applicant's, and one
# for a person the administration seated on each home.
KontaktSeite = Literal["bestaetigung_kontakt", "bestaetigung_kontakt_verwaltung", "bestaetigung_kontakt_saison"]


def kontakt_seite_of(*, einwilligung: Mapping[str, Any], verwaltet: KontaktSeite) -> KontaktSeite:
    """The page this seat's link opens: the applicant's where the applicant named the person, else its home's own.

    Read off `entered_by`, which nothing after the seating moves.
    """

    return "bestaetigung_kontakt" if einwilligung.get("entered_by") == "bewerbung" else verwaltet


def _einwilligung_of(kontakte: Any, seat: str) -> Mapping[str, Any]:
    slot = kontakte.get(seat) if isinstance(kontakte, Mapping) else None
    einwilligung = slot.get("einwilligung") if isinstance(slot, Mapping) else None

    return einwilligung if isinstance(einwilligung, Mapping) else {}


def bewerbung_kontakt_seite(*, bewerbung_raw: Mapping[str, Any], seat: str) -> KontaktSeite:
    return kontakt_seite_of(einwilligung=_einwilligung_of(bewerbung_raw.get("kontakte"), seat), verwaltet="bestaetigung_kontakt_verwaltung")


def antwort_seite(*, seiten: Sequence[KontaktSeite], verwaltet: KontaktSeite) -> KontaktSeite:
    """The one page a link answering seats of these pages opens, which its answer is judged against.

    The applicant's only where every seat's is: one press is one person's answer to one page.
    """

    return "bestaetigung_kontakt" if seiten and all(seite == "bestaetigung_kontakt" for seite in seiten) else verwaltet


def bewerbung_antwort_seite(*, bewerbung_raw: Mapping[str, Any], seats: Sequence[str]) -> KontaktSeite:
    return antwort_seite(
        seiten=[bewerbung_kontakt_seite(bewerbung_raw=bewerbung_raw, seat=seat) for seat in seats], verwaltet="bestaetigung_kontakt_verwaltung"
    )


def saison_kontakt_seite(*, row: Mapping[str, Any], seat: str) -> KontaktSeite:
    """The page a season row's seat opens: the applicant's for a person the applicant named, else the row's own."""

    return kontakt_seite_of(einwilligung=_einwilligung_of(row.get("kontakte"), seat), verwaltet="bestaetigung_kontakt_saison")


def saison_antwort_seite(*, row: Mapping[str, Any], seats: Sequence[str]) -> KontaktSeite:
    """The page a season row's link opens for the seats its answer writes: the view's and the press's one source."""

    return antwort_seite(seiten=[saison_kontakt_seite(row=row, seat=seat) for seat in seats], verwaltet="bestaetigung_kontakt_saison")


def objection_is_announced(*, kontakte: Any, seats: Sequence[str]) -> bool:
    """Whether a decline of these seats is told to an Ansprechperson who still stands, in a notice naming the deletion day."""

    return "ansprechperson" not in seats and ansprechperson_mailbox(kontakte=kontakte)[0] is not None


def compose_decline_update(*, seats: Sequence[str], today: str, angekuendigt: bool) -> Mapping[str, Any]:
    """A decline empties the person's slot and records the day beside it, where the emptying cannot reach.

    `angekuendigt` where the objection notice goes out: it names the deletion day, so it is the deletion notice too.
    """

    written: dict[str, Any] = {}
    for seat in seats:
        written[f"kontakte.{seat}"] = None
        written[f"confirmations.{seat}.declined_at"] = today
    if angekuendigt:
        written["erasure_announced_at"] = today

    # The submission's digest was taken over this person's details too, and a hash of personal data is
    # still personal data. A replay then meets the refusal of other details, which stays true.
    return {"$set": written, "$unset": {"idempotency_fingerprint": ""}}


def compose_erneut_update(*, seats: Sequence[str], today: str, confirmation_deadline: str) -> Mapping[str, Any]:
    """A re-send: one fresh entry per seat this person holds, and the deadline restarts.

    Both seats one person holds, as the confirmation writes both: one entry left standing would keep
    the replaced address's link alive through `paired_seat`.
    """

    # The WHOLE entry, its links with it: the old link opens nothing from here, and the mail this write owes mints the fresh one.
    written: dict[str, Any] = {f"confirmations.{seat}": compose_bestaetigung(today=today) for seat in seats}

    # The deadline restarts, so a notice that named the old one no longer announces the deletion.
    return {"$set": {**written, "confirmation_deadline": confirmation_deadline, "erasure_announced_at": None}}


def build_erneut_filter(*, bewerbung_id: Any, seats: Sequence[str]) -> Mapping[str, Any]:
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


def find_gesperrt_refusal(*, barred: bool) -> WriteRefusal | None:
    """`bewerbung_adresse_barred`: the ban list holds one of the addresses a submission names.

    Takes the answer rather than the lookup, so the caller's reads run in the caller's transaction.
    """

    if not barred:
        return None

    # NEUTRAL and naming no seat, as the registration's refusal is: a stranger learns nothing about a
    # list, and 403 because what fails is who is applying rather than the season's state.
    return WriteRefusal(
        error_code=Code.BEWERBUNG_ADRESSE_BARRED,
        status=HTTPStatus.FORBIDDEN,
    )


def find_kontakt_gesperrt_refusal(*, barred: bool) -> WriteRefusal | None:
    """`bewerbung_kontakt_barred`: an administrator's correction or reseat names an address the ban list holds.

    409 where the public form's is 403: an administrator's write naming it is about the entry it writes,
    as the referee editor's `schiedsrichter_adresse_barred` is.
    """

    if not barred:
        return None

    return WriteRefusal(
        error_code=Code.BEWERBUNG_KONTAKT_BARRED,
        status=HTTPStatus.CONFLICT,
    )


def find_einwilligung_gesperrt_refusal(*, barred: bool) -> WriteRefusal | None:
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


def find_kontakt_email_refusal(*, kontakte: Any, seats: Sequence[str], email: str) -> WriteRefusal | None:
    """Why this address cannot be the seat's, or `None`.

    The submission's own distinctness rule asked again -- two DIFFERENT people are not reachable at
    one mailbox -- because a correction is the one path that could put them there afterwards.
    """

    slots = kontakte if isinstance(kontakte, Mapping) else {}
    # The seats this correction writes are left out: they are one person, and their blocks are equal
    # by the submission's own rule.
    others = [slots.get(seat) for seat in KONTAKT_ROLLEN if seat not in seats]
    # On the sign-in fold, as `FLBewerbungKontaktePayload` compares it: a third spelling of "one
    # mailbox" here would refuse where the form accepted, or the reverse.
    held = {sign_in_identifier(str(slot.get("email") or "")) for slot in others if isinstance(slot, Mapping)}

    if sign_in_identifier(email) in held:
        return WriteRefusal(
            error_code=Code.BEWERBUNG_KONTAKT_EMAIL_TAKEN,
            status=HTTPStatus.CONFLICT,
        )

    return None


def find_sitz_inhaber_refusal(*, kontakte: Any, seat: str, previous_email: str) -> WriteRefusal | None:
    """Why this correction may not land, or `None`.

    A Widerspruch and a reseat since the page's read hand the seat to someone the address was not typed for.
    """

    slots = kontakte if isinstance(kontakte, Mapping) else {}
    slot = slots.get(seat)
    # On the sign-in fold, as `find_kontakt_email_refusal` compares one mailbox to another.
    held = sign_in_identifier(str(slot.get("email") or "")) if isinstance(slot, Mapping) else None

    if held == sign_in_identifier(previous_email):
        return None

    return WriteRefusal(
        error_code=Code.BEWERBUNG_SEAT_DIFFERENTLY_SEATED,
        status=HTTPStatus.CONFLICT,
    )


def compose_kontakt_email_update(*, seats: Sequence[str], email: str, today: str, confirmation_deadline: str) -> Mapping[str, Any]:
    """The corrected address and a fresh link, in ONE `$set`.

    Never two writes: between them the seat would hold the new address beside the link the old one
    was mailed, which is the live credential the correction exists to retire.
    """

    erneut = compose_erneut_update(seats=seats, today=today, confirmation_deadline=confirmation_deadline)

    return {"$set": {**{f"kontakte.{seat}.email": email for seat in seats}, **erneut["$set"]}}


# --- The RESEAT: another person in a seat its own holder stepped out of.


def seat_awaits_a_replacement(*, confirmations: Any, seat: str) -> bool:
    """Whether this seat is empty because its person exercised their Widerspruch.

    The ONE place an ERASED seat is refused: an erasure clears the whole entry, so the `declined_at`
    a decline leaves behind is all that parts the two empty slots.
    """

    return _declined_on(confirmations, seat) is not None


def find_reseat_refusal(*, confirmations: Any, seats: Sequence[str]) -> WriteRefusal | None:
    """Why no other person may be seated here, or `None`.

    Its own predicate beside `find_already_answered_refusal`, which refuses the declined seat this
    one exists for: widening that one would let the re-send mint against an emptied slot.
    """

    # EVERY seat, because a claimed pair is one person: a mirror in another state is refused rather
    # than written unjudged, or dropped from a write that asked for both.
    for seat in seats:
        if not seat_awaits_a_replacement(confirmations=confirmations, seat=seat):
            return WriteRefusal(
                error_code=Code.BEWERBUNG_SEAT_ALREADY_ANSWERED,
                status=HTTPStatus.CONFLICT,
            )

    return None


def claimed_pair_seat(*, kontakte: Any, seat: str) -> FLKontaktRolle | None:
    """The other seat `trainer_is_also` claims for this person, standing or emptied.

    `paired_seat` without its `seat_stands` half, which answers `None` for exactly the emptied slots
    a reseat runs on and would leave one of them holding the other's link.
    """

    zugleich = kontakte.get("trainer_is_also") if isinstance(kontakte, Mapping) else None
    if zugleich is None:
        return None

    return seat_named(zugleich) if seat == "trainer" else (cast(FLKontaktRolle, "trainer") if seat == zugleich else None)


def compose_kontakt_seat_update(
    *, seats: Sequence[str], person: Mapping[str, Any], text_version: str, today: str, confirmation_deadline: str
) -> Mapping[str, Any]:
    """The new person and their fresh link, in ONE `$set`. Two writes would seat them behind the link the seat's last holder still holds."""

    erneut = compose_erneut_update(seats=seats, today=today, confirmation_deadline=confirmation_deadline)
    # Born afresh: nothing of the person who stepped out travels to the one seated.
    einwilligung = compose_einwilligung(text_version=text_version, today=today, entered_by="liga")
    # Null rather than left off, as the submission writes it: the key marks a date not yet entered,
    # and the confirmation fills it.
    slot = {**person, "geburtsdatum": None, "einwilligung": einwilligung}

    # The WHOLE slot per seat, never a dotted path under it: a decline nulled the slot, and a dotted
    # `$set` under a null is `PathNotViable`, which aborts the transaction.
    return {"$set": {**{f"kontakte.{seat}": dict(slot) for seat in seats}, **erneut["$set"]}}


# --- The retention SWEEP. Six clocks, each a pure predicate over one document and `today`, so
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


def seat_reminder_is_due(*, kontakte: Any, confirmations: Any, seat: str, today: str, unerreichbar: bool) -> bool:
    """Whether this seat's one reminder is owed today: open, unanswered, never reminded, mailed three or more days ago, and reachable.

    `unerreichbar` is `lage_unzustellbar` of the seat's last mail (`seat_lage`).

    A re-sent seat carries a later `sent_at` and reaches its mark on its own; one already
    reminded never is again.
    """

    entry = _entry_of(confirmations, seat)
    if entry is None or _seat_is_confirmed(kontakte, seat) or entry.get("declined_at") is not None:
        return False

    if entry.get("reminded_at") is not None or not isinstance(entry.get("sent_at"), str):
        return False

    # A seat gets ONE chase, and spending it on an address the provider has refused, or whose person reported the mail
    # as spam, spends it on nobody; a correction is what makes the seat due again, its mail being the seat's last.
    if unerreichbar:
        return False

    return days_after(day=entry["sent_at"], days=BEWERBUNG_REMINDER_DAYS) <= today


def reminder_seats(*, bewerbung_raw: Mapping[str, Any], today: str, unerreichbar: Collection[str]) -> list[FLKontaktRolle]:
    """Every seat of this application owed a reminder today, in declaration order; none once the link is over.

    `unerreichbar` names the seats whose last mail did not arrive.
    """

    if link_is_over(confirmation_deadline=bewerbung_raw.get("confirmation_deadline"), status=bewerbung_raw.get("status"), today=today):
        return []

    kontakte, bestaetigungen = bewerbung_raw.get("kontakte"), bewerbung_raw.get("confirmations")

    return [
        seat_named(seat) or cast(FLKontaktRolle, seat)
        for seat in KONTAKT_ROLLEN
        if seat_reminder_is_due(kontakte=kontakte, confirmations=bestaetigungen, seat=seat, today=today, unerreichbar=seat in unerreichbar)
    ]


def group_seats_by_mailbox(*, kontakte: Any, seats: Sequence[str]) -> list[tuple[str, list[FLKontaktRolle]]]:
    """The seats as the mails go out: one message per stored address, in first-seen order."""

    slots = kontakte if isinstance(kontakte, Mapping) else {}
    grouped: dict[str, tuple[str, list[FLKontaktRolle]]] = {}

    for seat in seats:
        slot = slots.get(seat)
        email = str(slot.get("email") or "").strip() if isinstance(slot, Mapping) else ""
        if not email:
            continue
        address, held = grouped.setdefault(email, (email, []))
        held.append(seat_named(seat) or cast(FLKontaktRolle, seat))

    return list(grouped.values())


def compose_erinnerung_update(*, seats: Sequence[str], today: str) -> Mapping[str, Any]:
    """The reminder's stamp per seat. `sent_at` and the deadline stay: a reminder is not a re-send, and its link joins the first."""

    return {"$set": {f"confirmations.{seat}.reminded_at": today for seat in seats}}


def deletion_is_due(*, bewerbung_raw: Mapping[str, Any], today: str, undeliverable: bool) -> bool:
    """Whether the fourteen-day clock takes this application: submitted, past its deadline, a seat outstanding, the notice deliverable.

    `undeliverable` is `app/api/outbox/schemas.py :: FLOutboxStatus.undeliverable` of the last mail owed the Ansprechperson: the
    deletion notice could not reach the submitter. An EMPTY Ansprechperson slot is not this case: no mailbox is left to
    tell, and the deadline takes the application unannounced.

    STRICTLY past: the link answers on the deadline's own day, so the deletion waits a day. An
    emptied seat is outstanding.
    """

    if bewerbung_raw.get("status") != "submitted":
        return False

    frist = bewerbung_raw.get("confirmation_deadline")
    if not isinstance(frist, str) or frist >= today:
        return False

    # HELD rather than erased: an administrator corrects the address, and the correction's mail makes it due again.
    if undeliverable:
        return False

    return bool(ausstehende_seats(kontakte=bewerbung_raw.get("kontakte")))


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
        # `$not` rather than `$gte`: a row carrying no readable deadline has a link that is not over.
        "confirmation_deadline": {"$not": {"$lt": today}},
        "$or": [_seat_reminder_term(seat=seat, today=today) for seat in KONTAKT_ROLLEN],
    }


def build_deletion_filter(*, saison_id: str, today: str) -> Mapping[str, Any]:
    """Every application the fourteen-day clock may take, as a query: a confirmed one would otherwise fill the page ahead of a due one.

    A held one stays in it, its delivery being the Postausgang's, so `deletion_is_due` judges each row read.
    """

    return {
        "saison_id": saison_id,
        "status": "submitted",
        "confirmation_deadline": {"$lt": today},
        "$or": [{f"kontakte.{seat}.einwilligung.confirmed_at": None} for seat in KONTAKT_ROLLEN],
    }


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


def acceptance_loeschung_is_due(*, bewerbung_raw: Mapping[str, Any], later_saison_status: Any) -> bool:
    return bewerbung_raw.get("status") == "accepted" and season_after_has_ended(later_saison_status=later_saison_status)


def undecided_loeschung_is_due(*, bewerbung_raw: Mapping[str, Any], saison_status: Any) -> bool:
    """Whether the season's own end takes this application: undecided, and its season is over.

    Nothing else is asked: a confirmed seat, a missing deadline and a refused notice each drop an
    application out of the fourteen-day clock.
    """

    return bewerbung_raw.get("status") == "submitted" and season_has_ended(saison_status=saison_status)


def schule_name(*, bewerbung_raw: Mapping[str, Any], club_names: Mapping[Any, str]) -> str:
    """The school's name as submitted, or the picked club's as the router resolved it; empty where neither resolves."""

    schule = bewerbung_raw.get("schule")
    if isinstance(schule, Mapping):
        return str(schule.get("team_name") or "")

    return club_names.get(bewerbung_raw.get("team_id"), "")


def vorname_of(*, kontakte: Any, seat: str) -> str | None:
    slot = kontakte.get(seat) if isinstance(kontakte, Mapping) else None

    return str(slot.get("vorname") or "") or None if isinstance(slot, Mapping) else None


# --- The MAILS an application owes, each to one person: an address is one person (one seat, or two the Trainer holds).


def bewerbung_link(seats: Sequence[str], *, replaced: bool) -> FLOutboxLink:
    """Where one person's mailed link lives on the application, and the addresses it is minted for while they still stand.

    Every seat the person holds, so one press answers both. A reminder's link joins the first (`replaced` clear); every
    other mail's supersedes what the seat holds at its hand-out, so a link owed before a re-send and handed out after it
    opens nothing, as the re-send's write promised.
    """

    return FLOutboxLink(
        paths=[f"confirmations.{seat}.token_hashes" for seat in seats],
        adressen=[f"kontakte.{seat}.email" for seat in seats],
        replaced=replaced,
    )


def bewerbung_bezug(bewerbung_id: Any, seats: Sequence[FLKontaktRolle]) -> FLOutboxReference:
    """The application and the person's seat a delivery is read by: the one the Trainer mirrors, where they hold two."""

    return FLOutboxReference(collection=Sammlung.BEWERBUNGEN, id=bewerbung_id, seat=min(seats, key=lambda seat: seat == "trainer"))


def lage_unzustellbar(lage: FLOutboxStatus | None) -> bool:
    """`app/api/outbox/schemas.py :: FLOutboxStatus.undeliverable` of the last mail owed one seat, `False` where none was owed."""

    return lage is not None and lage.undeliverable


def ausstehende_personen(*, kontakte: Any, seats: Sequence[str]) -> list[FLBewerbungPerson]:
    """These seats as the people holding them, the Trainer folded into the seat it mirrors: a mail names one person once.

    An emptied seat counts, its first name `None`: the application cannot complete without it.
    """

    zugleich = kontakte.get("trainer_is_also") if isinstance(kontakte, Mapping) else None
    personen: list[FLBewerbungPerson] = []

    for seat in KONTAKT_ROLLEN:
        if seat not in seats or (seat == "trainer" and zugleich in seats):
            continue
        rollen = [seat, "trainer"] if seat == zugleich and "trainer" in seats else [seat]
        personen.append(FLBewerbungPerson(vorname=vorname_of(kontakte=kontakte, seat=seat), rollen=cast(list[FLKontaktRolle], rollen)))

    return personen


def personen_mit_adresse(*, kontakte: Any, seats: Sequence[str] = KONTAKT_ROLLEN) -> list[tuple[str, list[FLKontaktRolle]]]:
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
    frist: str,
    key: str,
    art: Literal["bewerbung_confirmation", "bewerbung_reminder"] = "bewerbung_confirmation",
) -> OwedMail:
    """One person's confirmation link, or its one reminder, the address read off the seat the write left."""

    return OwedMail(
        key=key,
        an=str(kontakte[seats[0]]["email"]),
        data=FLBewerbungLinkData(art=art, saison_id=saison_id, schule=schule, rollen=list(seats), frist=frist),
        reference=bewerbung_bezug(bewerbung_id, seats),
        link=bewerbung_link(seats, replaced=art != "bewerbung_reminder"),
    )


def owed_at_submission(*, bewerbung_id: Any, kontakte: Any, saison_id: str, schule: str, frist: str) -> list[OwedMail]:
    """Every person's first mail: the Ansprechperson the receipt naming who is still to answer, each other person their link.

    Keyed by the application and the person's first seat, so a retried transaction owes nothing twice.
    """

    mails: list[OwedMail] = []
    for email, seats in personen_mit_adresse(kontakte=kontakte):
        stamm = f"{Sammlung.BEWERBUNGEN}/{bewerbung_id}"
        if "ansprechperson" not in seats:
            mails.append(
                owed_link(
                    bewerbung_id=bewerbung_id,
                    kontakte=kontakte,
                    seats=seats,
                    saison_id=saison_id,
                    schule=schule,
                    frist=frist,
                    key=f"{stamm}/confirmation/{seats[0]}",
                )
            )
            continue
        andere = [seat for seat in KONTAKT_ROLLEN if seat not in seats]
        mails.append(
            OwedMail(
                key=f"{stamm}/received",
                an=email,
                data=FLBewerbungReceivedData(
                    art="bewerbung_received",
                    saison_id=saison_id,
                    rollen=seats,
                    pending=ausstehende_personen(kontakte=kontakte, seats=andere),
                    frist=frist,
                ),
                reference=bewerbung_bezug(bewerbung_id, seats),
                link=bewerbung_link(seats, replaced=True),
            )
        )

    return mails


def owed_loeschung(*, bewerbung_raw: Mapping[str, Any], saison_id: str) -> OwedMail | None:
    """The fourteen-day clock's notice to the submitter, naming who never confirmed.

    `None` where the Ansprechperson slot is empty, which leaves nobody to tell, or where a Widerspruch's notice already named
    the deletion.
    """

    kontakte = bewerbung_raw.get("kontakte")
    email, rollen = ansprechperson_mailbox(kontakte=kontakte)
    if email is None or deletion_was_announced(bewerbung_raw=bewerbung_raw):
        return None

    return OwedMail(
        key=f"{Sammlung.BEWERBUNGEN}/{bewerbung_raw['_id']}/erasure",
        an=email,
        data=FLBewerbungErasureData(
            art="bewerbung_erasure",
            saison_id=saison_id,
            rollen=rollen,
            pending=ausstehende_personen(kontakte=kontakte, seats=ausstehende_seats(kontakte=kontakte)),
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

    # The form excludes what this returns, and a season may field at least as many teams as the palette
    # has colours. `fl_frontend/src/features/teams/utils.ts :: offeredTrikotFarben` then hands the whole
    # palette back once every colour is assigned.
    return [farbe for farbe in get_args(FLTrikotFarbe.__value__) if farbe in held]


def build_bewerbungen_saisonbezug_terms(*, saison_id: str | None) -> dict[FLBewerbungSaisonReference, dict[str, Any]]:
    """Each relation's own term, for the count its option is told.

    A request naming no season is answered against `None`, which no application carries, so every row
    falls under `other_saison` -- where
    `fl_frontend/src/features/bewerbungen/utils.ts :: buildBewerbungRows` files those same rows.
    """

    return {"diese_saison": {"saison_id": saison_id}, "other_saison": {"saison_id": {"$ne": saison_id}}}


def build_bewerbungen_saison_term(*, saison_id: str | None, saisonbezug: Sequence[str] | None) -> dict[str, Any]:
    """Which seasons the read covers, as the bar's relation to the season the caller named.

    A relation rather than the id alone, the bar offering a complement no `saison_id` can express.
    """

    if saison_id is None:
        return {}

    # The parameter's older meaning, kept: a caller naming no relation asked for that season's queue.
    if saisonbezug is None:
        return {"saison_id": saison_id}

    picked = [relation for relation in get_args(FLBewerbungSaisonReference.__value__) if relation in saisonbezug]

    # Every relation picked is every season, and so the facet turned off.
    if len(picked) != 1:
        return {}

    return build_bewerbungen_saisonbezug_terms(saison_id=saison_id)[picked[0]]


def build_bewerbungen_status_term(status: Sequence[str] | None) -> dict[str, Any]:
    """`$in` rather than an equality, so a facet that offers all three has a request expressing any two of them.

    The leading key of `app/core/constraints.py :: SUPPORT_INDEXES`' `bewerbungen_status_queue`
    serves it either way.
    """

    return {} if status is None else {"status": {"$in": list(status)}}


def build_bewerbungen_sort(*, sort_by: str, order: str) -> list[tuple[str, int]]:
    """The triage queue's order, tie-broken by `_id`."""

    # `_id` breaks the tie in `order`'s OWN direction, so same-day rows read the way the queue does
    # and the pair is the index's key or its exact inverse. Pinned descending, `order=asc` would
    # match neither and scan the whole archive.
    direction = 1 if order == "asc" else -1

    return build_sort(sort_by=sort_by, order=order, chain=(("_id", direction),))


# One `$group` over the raw fields a collision is decided on, and never a `$match` on the count
# beside it: two groups parted by a Kürzel's case are one collision, which only
# `dubletten_schluessel_of`'s fold can see.
DUBLETTEN_TALLY: Final[Sequence[Mapping[str, Any]]] = (
    {
        "$group": {
            "_id": {"saison_id": "$saison_id", "team_id": "$team_id", "shorthand": "$schule.shorthand"},
            "anzahl": {"$sum": 1},
        }
    },
)


def build_dubletten_pipeline(beyond_status: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """Every open application the request's other terms leave, grouped and never bounded."""

    # `submitted` whatever status the page was narrowed to, and no `$limit`: the collision is a fact
    # about the queue, and a pass stopping where the page stops leaves a split pair unseen at both ends.
    return [{"$match": {**beyond_status, "status": "submitted"}}, *DUBLETTEN_TALLY]


def _dublette_schluessel(gruppe: Mapping[str, Any]) -> str | None:
    """One application's collision key, `None` where it names neither a club nor a Kürzel.

    Composed the way `fl_frontend/src/features/bewerbungen/duplicates.ts :: dublettenSchluessel`
    composes a served row's, which is the comparison that marks the row.
    """

    team_id = gruppe.get("team_id")

    if team_id is not None:
        return f"{gruppe.get('saison_id')} team {team_id}"

    kuerzel = fold_shorthand(str(gruppe.get("shorthand") or ""))

    return None if kuerzel == "" else f"{gruppe.get('saison_id')} kuerzel {kuerzel}"


def dubletten_schluessel_of(cells: Sequence[Mapping[str, Any]]) -> list[str]:
    """Which keys more than one open application holds, over every row the tally covered.

    `fold_shorthand` and never a collation: the tally groups the stored codes, a row written before the
    input fold among them, while `CustomShorthand` folds each as it is served and
    `fl_frontend/src/features/bewerbungen/duplicates.ts` keys a row by the served code, so a pair
    parted only by a stored code's case or padding is one collision at both ends.
    """

    gehalten: dict[str, int] = {}

    for cell in cells:
        schluessel = _dublette_schluessel(cell["_id"])

        if schluessel is None:
            continue

        gehalten[schluessel] = gehalten.get(schluessel, 0) + cell["anzahl"]

    # Sorted, so an unchanged queue answers the same list twice.
    return sorted(schluessel for schluessel, anzahl in gehalten.items() if anzahl > 1)


def entscheider_adressen(rows: Iterable[Mapping[str, Any]]) -> list[str]:
    """Every administrator these stored applications name as their decider, folded as the ban list is asked."""

    return [sign_in_identifier(FLBewerbungEntscheidung.model_validate(row["decision"]).von) for row in rows if row.get("decision") is not None]


def mit_vorenthaltener_entscheidung(row: Mapping[str, Any], barred: Collection[str]) -> dict[str, Any]:
    """A stored application with its decision as every read serves it."""

    if row.get("decision") is None:
        return dict(row)

    # As stored first, so a decision the stored shape refuses fails rather than being served withheld.
    entscheidung = FLBewerbungEntscheidung.model_validate(row["decision"])
    von = withheld_actor(entscheidung.von, barred)

    return {**row, "decision": {**entscheidung.model_dump(), "von": von, "by_barred": von is None}}


def seat_lage(*, row: Mapping[str, Any], lagen: Mapping[tuple[Any, str | None], FLOutboxStatus], seat: str) -> FLOutboxStatus | None:
    """The last mail owed this seat of a stored application, `None` where none was.

    A Trainer who is another seat's person reads that seat's mail: one person is sent one mail for both, read by the
    seat it mirrors (`bewerbung_bezug`).
    """

    kontakte = row.get("kontakte")
    zugleich = kontakte.get("trainer_is_also") if isinstance(kontakte, Mapping) else None
    gespiegelt = lagen.get((row["_id"], zugleich)) if seat == "trainer" and zugleich else None

    return gespiegelt or lagen.get((row["_id"], seat))


def unerreichbare_seats(*, row: Mapping[str, Any], lagen: Mapping[tuple[Any, str | None], FLOutboxStatus]) -> set[str]:
    """The seats of a stored application whose last mail did not arrive."""

    return {seat for seat in KONTAKT_ROLLEN if lage_unzustellbar(seat_lage(row=row, lagen=lagen, seat=seat))}


def mit_zustellung(row: Mapping[str, Any], lagen: Mapping[tuple[Any, str | None], FLOutboxStatus]) -> dict[str, Any]:
    """A stored application with each seat's last mail beside its bookkeeping, as every read serves it."""

    bestaetigungen = row.get("confirmations")
    if not isinstance(bestaetigungen, Mapping):
        return dict(row)

    return {
        **row,
        "confirmations": {
            seat: {**entry, "delivery": seat_lage(row=row, lagen=lagen, seat=seat)} if isinstance(entry, Mapping) else entry
            for seat, entry in bestaetigungen.items()
        },
    }
