from collections.abc import Mapping, Sequence
from http import HTTPStatus
from typing import Any, Final

from app.api.bewerbungen.services import days_after
from app.api.schiedsrichter.schemas import FLSchiedsrichterBestaetigungZustand
from app.api.spiele.schemas import unplayed_filter
from app.core.collections import Collection
from app.core.exceptions import WriteRefusal
from app.core.sentinels import GHOST_INACTIVE_SINCE, GHOST_SCHIEDSRICHTER_ID
from app.shared.alter import whole_years_between
from app.shared.folding import canonical_address, mailbox_key
from app.shared.schemas.bounds import (
    BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
    MEDIEN_MIN_AGE_YEARS,
    SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE,
    SCHIEDSRICHTER_MIN_AGE_YEARS,
)
from app.shared.schemas.kontakt import FLKontakt

# A played fixture never blocks: its `schiedsrichter` is a record of who officiated.
REFEREE_STILL_ASSIGNED = "REQ-RETIRE-004"

# Its own code rather than the 404 every other endpoint answers for this id: an administrator who
# reached the ghost is owed the reason it cannot be erased, not the claim that it is not there.
GHOST_ERASED = "REQ-ANONYMISE-004"


def build_ghost_schiedsrichter() -> dict[str, Any]:
    """The row an erased referee's fixtures are repointed to, as it is first written.

    Retired, so `REQ-BOOKING-001` refuses it every new fixture under the rule a retired referee
    already meets rather than under one written for the ghost.
    """

    return {
        "_id": GHOST_SCHIEDSRICHTER_ID,
        "name": None,
        "schule": None,
        # Zero rather than a rate: no fee was ever agreed with nobody, and each fixture keeps the
        # `payment` it recorded (`docs/backend/spec.md :: I6`).
        "default_payment": 0,
        # Read off the model, so a contact field added later arrives null here rather than missing.
        "kontakt": dict.fromkeys(FLKontakt.model_fields),
        "inactive_since": GHOST_INACTIVE_SINCE,
    }


# The one term excluding the ghost, spelled once for the list read and for the by-id filter below.
_NOT_THE_GHOST: Mapping[str, Any] = {"$ne": GHOST_SCHIEDSRICHTER_ID}


def build_real_referees_filter() -> Mapping[str, Any]:
    """Every referee a person stands behind, which is the whole collection but the ghost."""

    return {"_id": dict(_NOT_THE_GHOST)}


def build_referee_filter(schiedsrichter_id: Any) -> Mapping[str, Any]:
    """One real referee by id, answering nothing for the ghost.

    One spelling for the read, the edit, the retirement and the reactivation: reached by any, the
    ghost takes a name onto every erased referee's fixtures or returns to the picker.
    """

    return {"_id": {"$eq": schiedsrichter_id, **_NOT_THE_GHOST}}


def build_assignment_filter(schiedsrichter_id: Any) -> Mapping[str, Any]:
    """Every fixture naming this referee, played or not — the set the erasure repoints."""

    return {"schiedsrichter.schiedsrichter_id": schiedsrichter_id}


def build_unplayed_assignment_filter(schiedsrichter_id: Any) -> Mapping[str, Any]:
    """Every fixture this referee holds that is still to be played, which is what the retirement's refusal judges.

    Composed from `build_assignment_filter` rather than spelled again, so the path cannot be
    narrowed on one seam alone.
    """

    return {**build_assignment_filter(schiedsrichter_id), **unplayed_filter()}


def build_ghost_repoint() -> Mapping[str, Any]:
    """What a fixture's booking becomes once the person behind it is deleted.

    `payment` stays: it records what THIS match agreed (`docs/backend/spec.md :: I6`). The ghost has
    no name, and every surface reads a null one.
    """

    return {"$set": {"schiedsrichter.schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID, "schiedsrichter.name": None}}


def build_booked_image_filter(schiedsrichter_id: Any) -> Mapping[str, Any]:
    """Every `spiele` log row whose pre-image names this referee.

    Selected inside the image rather than by the fixtures they hold today: a reassigned fixture, and a
    removed one, each leave an image naming them that no id can reach.
    """

    # `collection` first, the one half an index serves — nothing indexes inside `before`, as the
    # contact erasure's orphan sweep also finds
    # (`app/api/kontakte/services.py :: build_orphaned_images_pipeline`). A `delete_many` row's image is
    # an ARRAY, matched on its members.
    return {"collection": str(Collection.SPIELE), "before.schiedsrichter.schiedsrichter_id": schiedsrichter_id}


def first_stamped(*, stored: Mapping[str, Any], field: str, today: str) -> str:
    """The day already stamped, or today.

    A second press of the retirement would otherwise move the day a referee stopped officiating,
    which is the day a fee is reconciled against.
    """

    stamped = stored.get(field)

    return today if stamped is None else str(stamped)


def find_ghost_erasure_refusal(*, schiedsrichter_id: Any) -> WriteRefusal | None:
    """Why erasing this id must be refused, or `None`."""

    if schiedsrichter_id != GHOST_SCHIEDSRICHTER_ID:
        return None

    return WriteRefusal(
        error_code=GHOST_ERASED,
        status=HTTPStatus.CONFLICT,
        message=(
            "this row stands behind nobody: it is what the fixtures of every already-erased referee name, so it holds "
            "no personal data to delete and deleting it would leave those fixtures naming a referee that is gone"
        ),
    )


def find_referee_retire_refusal(*, upcoming_spiel_nrs: Sequence[int]) -> WriteRefusal | None:
    """Why retiring this referee must be refused, or `None`.

    `upcoming_spiel_nrs` is `unplayed_spiel_nrs`'s definition of "still to come".
    """

    if not upcoming_spiel_nrs:
        return None

    named = ", ".join(str(nr) for nr in upcoming_spiel_nrs[:5])
    rest = f" and {len(upcoming_spiel_nrs) - 5} more" if len(upcoming_spiel_nrs) > 5 else ""

    return WriteRefusal(
        error_code=REFEREE_STILL_ASSIGNED,
        status=HTTPStatus.CONFLICT,
        message=(
            f"{len(upcoming_spiel_nrs)} unplayed fixture(s) are assigned to them (spiel_nr {named}{rest}); "
            "reassign or cancel those fixtures first"
        ),
    )


# --- The CONFIRMATION LINK. Every predicate below reads a missing `bestaetigung` block as "nothing
# was ever mailed": a referee entered before this flow is neither refused nor swept.

# What every code below refuses is `fl_backend/app/core/domain.py :: RULES`.
SCHIEDSRICHTER_RETIRED = "REQ-SCHIEDSRICHTER-001"
SCHIEDSRICHTER_TOKEN_UNKNOWN = "REQ-SCHIEDSRICHTER-002"
SCHIEDSRICHTER_TOKEN_EXPIRED = "REQ-SCHIEDSRICHTER-003"
SCHIEDSRICHTER_ALREADY_CONFIRMED = "REQ-SCHIEDSRICHTER-004"
SCHIEDSRICHTER_ALTER = "REQ-SCHIEDSRICHTER-005"
SCHIEDSRICHTER_KEINE_ADRESSE = "REQ-SCHIEDSRICHTER-006"
# Its own code and never `app/api/sperrliste/services.py :: SPERRLISTE_ADRESSE_GESPERRT`, which a
# client already maps to a second ban of one address: two conditions under one code are two a
# frontend cannot part.
SCHIEDSRICHTER_ADRESSE_GESPERRT = "REQ-SCHIEDSRICHTER-007"
SCHIEDSRICHTER_MEDIEN_ALTER = "REQ-SCHIEDSRICHTER-008"

# The carrier key, which `app/api/zustellung/services.py :: ZIEL_PFADE` also spells for this kind.
# A test holds the two equal: parted, a bounce would be filed under a path no link is stored at.
BESTAETIGUNG_FELD: Final = "bestaetigung"

EINWILLIGUNG_FELD: Final = "einwilligung"

# What a referee's own confirmation records. `volljaehrig` on every row: nobody else may answer for
# them, so this flow writes neither of the other two sources.
SCHIEDSRICHTER_ERTEILT_VON: Final = "volljaehrig"


def bestaetigung_frist_from(*, today: str) -> str:
    """The day the link stops working, counted from the mint -- a re-send restarts it."""

    return days_after(day=today, days=SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE)


def compose_bestaetigung(*, token_hash: str, today: str) -> dict[str, Any]:
    """The bookkeeping every mint writes: a live hash, handed out today, nobody reminded."""

    return {"token_hash": token_hash, "verschickt_am": today, "erinnert_am": None, "frist": bestaetigung_frist_from(today=today)}


def compose_mint_update(*, token_hash: str, today: str) -> dict[str, Any]:
    """The WHOLE block, so the delivery state of the message the old link went out in goes with it.

    A refusal recorded against a replaced address would otherwise hold the fresh link's referee
    unreachable for ever.
    """

    return {BESTAETIGUNG_FELD: compose_bestaetigung(token_hash=token_hash, today=today)}


def compose_einwilligung(*, umfang: str, medien: bool, text_version: str, today: str) -> dict[str, Any]:
    """The record as the person's own press writes it.

    `datum` and `bestaetigt_am` are one day here where a pupil's are two: nobody enters this record
    administratively, so it is given and confirmed in the same press.
    """

    return {
        "umfang": umfang,
        "erteilt_von": SCHIEDSRICHTER_ERTEILT_VON,
        "datum": today,
        "bestaetigt_am": today,
        "text_version": text_version,
        "medien": medien,
    }


def compose_confirmation_update(*, geburtsdatum: str, umfang: str, medien: bool, text_version: str, today: str) -> Mapping[str, Any]:
    """The ONE `$set` a confirmation is.

    Never two writes: between them the row would hold a birthdate nobody had yet consented to the
    league keeping.
    """

    return {
        "$set": {
            "geburtsdatum": geburtsdatum,
            EINWILLIGUNG_FELD: compose_einwilligung(umfang=umfang, medien=medien, text_version=text_version, today=today),
        }
    }


def build_token_filter(*, token_hash: str) -> Mapping[str, Any]:
    """The hash alone finds the referee. No `inactive_since` term: a person retired after the mint still owns the answer they give."""

    return {f"{BESTAETIGUNG_FELD}.token_hash": token_hash}


def vorname_of(name: Any) -> str | None:
    """The forename inside the one `name` field this collection stores.

    Split rather than stored apart, because every other referee surface reads and writes the whole
    name; a leaked link learns this much and no more (`docs/backend/spec.md :: READ-REFEREE-002`).
    """

    parts = str(name).split() if isinstance(name, str) else []

    return parts[0] if parts else None


def _stamp_of(einwilligung: Any) -> Any:
    return einwilligung.get("bestaetigt_am") if isinstance(einwilligung, Mapping) else None


def is_confirmed(*, einwilligung: Any) -> bool:
    """Whether this referee has answered. The STAMP and never a nulled hash: the hash stays live so a second press is told why."""

    return _stamp_of(einwilligung) is not None


def link_is_over(*, frist: Any, today: str) -> bool:
    """Whether the deadline has passed. A block carrying no readable deadline is over: nothing can say it is still running."""

    return not isinstance(frist, str) or frist < today


def frist_of(bestaetigung: Any) -> Any:
    return bestaetigung.get("frist") if isinstance(bestaetigung, Mapping) else None


def zustand_of(*, einwilligung: Any, bestaetigung: Any, today: str) -> FLSchiedsrichterBestaetigungZustand:
    """What a reopened link shows. A stamp outranks the deadline: a person who answered on the last valid day is shown that they did."""

    if is_confirmed(einwilligung=einwilligung):
        return "bestaetigt"

    return "abgelaufen" if link_is_over(frist=frist_of(bestaetigung), today=today) else "gueltig"


def find_unknown_token_refusal(*, found: bool) -> WriteRefusal | None:
    """Why this token opens nothing, or `None`.

    ONE answer for unknown, replaced by a later mint, and deleted with the referee: nothing
    distinguishes them from a stranger's guess, and naming which would say more than the guess knew.
    """

    if found:
        return None

    return WriteRefusal(
        error_code=SCHIEDSRICHTER_TOKEN_UNKNOWN,
        status=HTTPStatus.CONFLICT,
        message="this link opens no referee's entry; it may have been replaced by a newer one, or the entry is gone",
    )


def find_expired_token_refusal(*, frist: Any, today: str) -> WriteRefusal | None:
    """Why this link is over, or `None`."""

    if not link_is_over(frist=frist, today=today):
        return None

    return WriteRefusal(
        error_code=SCHIEDSRICHTER_TOKEN_EXPIRED,
        status=HTTPStatus.CONFLICT,
        message="this link has expired; the administration can send a fresh one",
    )


def find_already_confirmed_refusal(*, einwilligung: Any) -> WriteRefusal | None:
    """Why this entry takes no second answer, or `None`. The single use: a stamp is what spends the link."""

    if not is_confirmed(einwilligung=einwilligung):
        return None

    return WriteRefusal(
        error_code=SCHIEDSRICHTER_ALREADY_CONFIRMED,
        status=HTTPStatus.CONFLICT,
        message="this entry has already been confirmed; an answer is given once",
    )


def find_alter_refusal(*, geburtsdatum: str, today: str) -> WriteRefusal | None:
    """Why the typed date is refused, or `None`. Judged BEFORE any write, so a mistyped year spends nothing."""

    age = whole_years_between(born=geburtsdatum, today=today)

    if age < SCHIEDSRICHTER_MIN_AGE_YEARS:
        return WriteRefusal(
            error_code=SCHIEDSRICHTER_ALTER,
            status=HTTPStatus.CONFLICT,
            message=f"this consent is given from {SCHIEDSRICHTER_MIN_AGE_YEARS} years of age, and the date entered does not reach it",
        )

    if age > BEWERBUNG_KONTAKT_MAX_AGE_YEARS:
        return WriteRefusal(
            error_code=SCHIEDSRICHTER_ALTER,
            status=HTTPStatus.CONFLICT,
            message=f"a date giving an age over {BEWERBUNG_KONTAKT_MAX_AGE_YEARS} years is a mistyped century rather than a birthdate",
        )

    return None


def find_medien_refusal(*, geburtsdatum: str, medien: bool, today: str) -> WriteRefusal | None:
    """Why this referee's media consent is refused, or `None`.

    Only a `True` is judged: a `False` publishes nothing, and refusing it would refuse the answer the
    page sends every referee below the floor.
    """

    if not medien or whole_years_between(born=geburtsdatum, today=today) >= MEDIEN_MIN_AGE_YEARS:
        return None

    return WriteRefusal(
        error_code=SCHIEDSRICHTER_MEDIEN_ALTER,
        status=HTTPStatus.CONFLICT,
        message=f"a consent to publishing photographs, video and interviews is taken from {MEDIEN_MIN_AGE_YEARS} years of age only",
    )


def find_retired_refusal(*, inactive_since: Any) -> WriteRefusal | None:
    """Why a retired referee takes no fresh link, or `None`.

    A refusal to COLLECT and never a retire-first gate: a row taking no new booking would be asked
    to consent to a role nobody can give them.
    """

    if inactive_since is None:
        return None

    return WriteRefusal(
        error_code=SCHIEDSRICHTER_RETIRED,
        status=HTTPStatus.CONFLICT,
        message="this referee is retired and takes no new fixtures, so there is nothing left to collect a consent for; reactivate them first",
    )


def find_missing_address_refusal(*, email: Any) -> WriteRefusal | None:
    """Why there is nobody to send to, or `None`.

    Refused here and not at the calling surface alone: a mint that wrote `verschickt_am` for a row
    with no address would record a message that was never composed.
    """

    # A stored value the fold cannot canonicalise is no address either: the placeholder under
    # `.invalid` a row without one is given, which the ban-list hash would otherwise meet as a 500.
    if email is not None:
        try:
            canonical_address(str(email))
        except ValueError:
            pass
        else:
            return None

    return WriteRefusal(
        error_code=SCHIEDSRICHTER_KEINE_ADRESSE,
        status=HTTPStatus.CONFLICT,
        message="this referee has no usable email address, so no confirmation link can be sent; enter one first",
    )


def find_gesperrt_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """Why no link may be sent to this address, or `None`. Worded for the administrator who typed it, every site raising it being admin-tier."""

    if not gesperrt:
        return None

    return WriteRefusal(
        error_code=SCHIEDSRICHTER_ADRESSE_GESPERRT,
        status=HTTPStatus.CONFLICT,
        message="this email address is on the ban list, so no confirmation link may be sent to it; lift the entry first",
    )


def compose_korrektur_update(
    *, stored: Mapping[str, Any], payload: Mapping[str, Any], payload_email: str, token_hash: str, today: str
) -> tuple[dict[str, Any], bool]:
    """The save's update, and whether it minted.

    A RETIRED referee's new address is stored and mailed nothing, and their old link goes, its
    mailbox replaced; the reactivation is what asks them.
    """

    # A CONFIRMED referee keeps their link, the record being already given; the administrator tells
    # them the address moved (`docs/ops/runbooks.md` §5).
    if is_confirmed(einwilligung=stored.get(EINWILLIGUNG_FELD)):
        return {"$set": dict(payload)}, False

    # One inbox rather than one string: a domain has no case (RFC 5321 §2.4), so a raw compare re-mails
    # an address nobody moved wherever the stored row and the payload spell its domain differently.
    stored_email = (stored.get("kontakt") or {}).get("email")
    if stored_email is not None and mailbox_key(payload_email) == mailbox_key(str(stored_email)):
        return {"$set": dict(payload)}, False

    if stored.get("inactive_since") is not None:
        return {"$set": dict(payload), "$unset": {BESTAETIGUNG_FELD: ""}}, False

    # An UNCONFIRMED referee's old link went to a mailbox nobody reads, and leaving it live is a
    # credential in the wrong inbox.
    return {"$set": {**payload, **compose_mint_update(token_hash=token_hash, today=today)}}, True


def owes_reactivation_mint(*, stored: Mapping[str, Any]) -> bool:
    """Whether bringing this referee back mints them a link: retired, unanswered, and holding an address a link can go to.

    A row with no such address comes back unasked; entering one is the save that mints.
    """

    return (
        stored.get("inactive_since") is not None
        and not is_confirmed(einwilligung=stored.get(EINWILLIGUNG_FELD))
        and find_missing_address_refusal(email=(stored.get("kontakt") or {}).get("email")) is None
    )


# An INCLUSION and never an exclusion: a base-tier caller holds the whole credential, so the rest
# of the row is what must not reach them (`docs/backend/spec.md :: READ-REFEREE-002`).
BESTAETIGUNG_ANSICHT_FIELDS: Mapping[str, int] = {
    # Read whole and cut by `vorname_of` before the response: no `find` projection splits a string.
    "name": 1,
    f"{EINWILLIGUNG_FELD}.bestaetigt_am": 1,
    f"{EINWILLIGUNG_FELD}.text_version": 1,
    f"{BESTAETIGUNG_FELD}.frist": 1,
    # Suppressed here alone: this endpoint stores nothing, so it needs no key to patch on.
    "_id": 0,
}

# Narrower than the view's: the answer takes its wording from the payload rather than the row.
BESTAETIGUNG_ANTWORT_FIELDS: Mapping[str, int] = {
    "name": 1,
    f"{EINWILLIGUNG_FELD}.bestaetigt_am": 1,
    f"{BESTAETIGUNG_FELD}.frist": 1,
}

# What the re-send judges, and the address it hashes against the ban list.
EINLADEN_FIELDS: Mapping[str, int] = {"inactive_since": 1, "kontakt.email": 1, f"{EINWILLIGUNG_FELD}.bestaetigt_am": 1}
