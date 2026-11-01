from collections.abc import Mapping, Sequence
from http import HTTPStatus
from typing import Any, Final

from app.api.bewerbungen.services import days_after
from app.api.spiele.schemas import unplayed_filter
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import WriteRefusal
from app.core.sentinels import GHOST_INACTIVE_SINCE, GHOST_SCHIEDSRICHTER_ID
from app.shared.alter import whole_years_between
from app.shared.einwilligung import is_confirmed
from app.shared.einwilligung_nachweis import compose_geboren
from app.shared.folding import canonical_address, sign_in_identifier
from app.shared.schemas.bounds import (
    BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
    MEDIEN_MIN_AGE_YEARS,
    SCHIEDSRICHTER_CONFIRMATION_FRIST_DAYS,
    SCHIEDSRICHTER_MIN_AGE_YEARS,
)
from app.shared.schemas.kontakt import FLKontakt
from app.shared.schemas.literals import FLConfirmationState


def build_ghost_schiedsrichter() -> dict[str, Any]:
    """The row an erased referee's fixtures are repointed to, as it is first written.

    Retired, so `booking_unknown_resource` refuses it every new fixture under the rule a retired referee
    already meets rather than under one written for the ghost.
    """

    return {
        "_id": GHOST_SCHIEDSRICHTER_ID,
        "name": None,
        "schule": None,
        # Zero rather than a rate: no fee was ever agreed with nobody, and each fixture keeps the
        # `payment` it recorded.
        "default_payment": 0,
        # Read off the model, so a contact field added later arrives null here rather than missing.
        "kontakt": dict.fromkeys(FLKontakt.model_fields),
        "inactive_since": GHOST_INACTIVE_SINCE,
    }


# The one term excluding the ghost, spelled once for the list read and for the by-id filter below.
_NOT_THE_GHOST: Mapping[str, Any] = {"$ne": GHOST_SCHIEDSRICHTER_ID}


def build_real_referees_filter(terms: Mapping[str, Any] | None = None) -> Mapping[str, Any]:
    """The referees `terms` match, the ghost never among them; with none, every referee a person stands behind.

    Composed as `app/api/spieler/services.py :: build_real_spieler_filter` composes, for its reason.
    """

    composed = dict(terms or {})

    if "_id" in composed:
        return {"$and": [composed, {"_id": dict(_NOT_THE_GHOST)}]}

    return {**composed, "_id": dict(_NOT_THE_GHOST)}


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

    `payment` stays: it records what THIS match agreed. The ghost has
    no name, and every surface reads a null one.
    """

    return {"$set": {"schiedsrichter.schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID, "schiedsrichter.name": None}}


def build_booked_image_filter(schiedsrichter_id: Any) -> Mapping[str, Any]:
    """Every `spiele` log row whose pre-image names this referee.

    Selected inside the image rather than by the fixtures they hold today: a reassigned fixture, and a
    removed one, each leave an image naming them that no id can reach.
    """

    # `collection` first, the one half an index serves — nothing indexes inside `before`, as the
    # contact erasure's seat pass also finds
    # (`app/api/kontakte/services.py :: build_seat_images_filter`). A `delete_many` row's image is
    # an ARRAY, matched on its members.
    return {"collection": str(Collection.SPIELE), "before.schiedsrichter.schiedsrichter_id": schiedsrichter_id}


def booked_image_edits(image: Mapping[str, Any], schiedsrichter_id: Any) -> dict[str, Any]:
    """One fixture image booked to this referee, repointed as the fixture itself is.

    Its result and every other value stay: the match is the league's record, and only the booking
    named the person.
    """

    booking = image.get("schiedsrichter")
    if not isinstance(booking, Mapping) or booking.get("schiedsrichter_id") != schiedsrichter_id:
        return {}

    return dict(build_ghost_repoint()["$set"])


def first_stamped(*, stored: Mapping[str, Any], field: str, today: str) -> str:
    """The day already stamped, or today.

    A second press of the retirement would otherwise move the day a referee stopped officiating,
    which is the day a fee is reconciled against.
    """

    stamped = stored.get(field)

    return today if stamped is None else str(stamped)


def find_referee_retire_refusal(*, upcoming_spiel_nrs: Sequence[int]) -> WriteRefusal | None:
    """Why retiring this referee must be refused, or `None`.

    `upcoming_spiel_nrs` is `unplayed_spiel_nrs`'s definition of "still to come".
    """

    if not upcoming_spiel_nrs:
        return None

    return WriteRefusal(
        error_code=Code.SCHIEDSRICHTER_STILL_ASSIGNED,
        status=HTTPStatus.CONFLICT,
    )


# --- The CONFIRMATION LINK. Every predicate below reads a missing `confirmation` block as "nothing
# was ever mailed": a retired referee whose corrected address was stored unmailed holds none.


# The record's confirmation block, under which the hand-out stores the hashes it mints.
BESTAETIGUNG_FELD: Final = "confirmation"

# Where the hand-out stores the hashes of the links it mints, and the address it mints them for.
TOKEN_HASHES_PFAD: Final = f"{BESTAETIGUNG_FELD}.token_hashes"
ADRESSE_PFAD: Final = "kontakt.email"

EINWILLIGUNG_FELD: Final = "einwilligung"


def bestaetigung_frist_from(*, today: str) -> str:
    """The day the link stops working, counted from the mint -- a re-send restarts it."""

    return days_after(day=today, days=SCHIEDSRICHTER_CONFIRMATION_FRIST_DAYS)


def compose_bestaetigung(*, today: str) -> dict[str, Any]:
    """The bookkeeping every owed link writes: no hash until the hand-out mints one, owed today, nobody reminded."""

    return {"token_hashes": [], "sent_at": today, "reminded_at": None, "frist": bestaetigung_frist_from(today=today)}


def compose_mint_update(*, today: str) -> dict[str, Any]:
    """The WHOLE block, so every link the referee was sent before stops working at this write."""

    return {BESTAETIGUNG_FELD: compose_bestaetigung(today=today)}


def compose_einwilligung(*, umfang: str, medien: bool, text_version: str, today: str) -> dict[str, Any]:
    """The record as the person's own press writes it.

    `datum` and `confirmed_at` are one day here where a pupil's are two: nobody enters this record
    administratively, so it is given and confirmed in the same press.
    """

    return {
        "umfang": umfang,
        "datum": today,
        "confirmed_at": today,
        "text_version": text_version,
        "medien": medien,
    }


def compose_confirmation_update(*, geburtsdatum: str, umfang: str, medien: bool, text_version: str, today: str, am: str) -> Mapping[str, Any]:
    """The ONE `$set` a confirmation is.

    Never two writes: between them the row would hold a birthdate nobody had yet consented to the
    league keeping.
    """

    # Born whole rather than moved: the stamp refusal admits only a row whose stored block no answer
    # of this referee's stands on, and a dotted `$set` under a null block aborts the transaction.
    record = compose_geboren(block=compose_einwilligung(umfang=umfang, medien=medien, text_version=text_version, today=today), am=am)

    return {"$set": {"geburtsdatum": geburtsdatum, EINWILLIGUNG_FELD: record}}


def build_token_filter(*, token_hash: str) -> Mapping[str, Any]:
    """The hash alone finds the referee. No `inactive_since` term: a person retired after the mint still owns the answer they give."""

    return {TOKEN_HASHES_PFAD: token_hash}


def vorname_of(name: Any) -> str | None:
    """The forename inside the one `name` field this collection stores.

    Split rather than stored apart, as every other referee surface reads the whole name. Only the
    account page fills a slot with it.
    """

    parts = str(name).split() if isinstance(name, str) else []

    return parts[0] if parts else None


def link_is_over(*, frist: str, today: str) -> bool:
    """Whether the deadline has passed: its own day still takes the answer."""

    return frist < today


def frist_abgelaufen(block: Mapping[str, Any] | None, *, today: str) -> bool:
    """Whether the link a referee holds has passed its deadline; false where they hold none."""

    return block is not None and link_is_over(frist=block["frist"], today=today)


def zustand_of(*, einwilligung: Any, confirmation: Mapping[str, Any], today: str, barred: bool) -> FLConfirmationState:
    """What a reopened link shows: the ban first, then a stamp over the deadline.

    A person who answered on the last valid day is shown that they did.
    """

    if barred:
        return "barred"

    if is_confirmed(einwilligung=einwilligung):
        return "confirmed"

    return "expired" if link_is_over(frist=confirmation["frist"], today=today) else "valid"


def find_unknown_token_refusal(*, found: bool) -> WriteRefusal | None:
    """Why this token opens nothing, or `None`.

    ONE answer for unknown, replaced by a later mint, and deleted with the referee: nothing
    distinguishes them from a stranger's guess, and naming which would say more than the guess knew.
    """

    if found:
        return None

    return WriteRefusal(
        error_code=Code.LINK_INVALID,
        status=HTTPStatus.NOT_FOUND,
    )


def find_expired_token_refusal(*, frist: str, today: str) -> WriteRefusal | None:
    """Why this link is over, or `None`."""

    if not link_is_over(frist=frist, today=today):
        return None

    return WriteRefusal(
        error_code=Code.LINK_EXPIRED,
        status=HTTPStatus.GONE,
    )


def find_already_confirmed_refusal(*, einwilligung: Any) -> WriteRefusal | None:
    """Why this entry takes no second answer, or `None`. The single use: a stamp is what spends the link."""

    # The STAMP and never a nulled hash: the hash stays live so a second press is told why.
    if not is_confirmed(einwilligung=einwilligung):
        return None

    return WriteRefusal(
        error_code=Code.CONFIRMATION_EXISTS,
        status=HTTPStatus.CONFLICT,
    )


def find_bestaetigung_gesperrt_refusal(*, barred: bool) -> WriteRefusal | None:
    """`link_barred`: the ban list holds the address this link was mailed to, however long ago it was minted."""

    if not barred:
        return None

    # 403 where the editor's `schiedsrichter_adresse_barred` is 409: this caller is the barred person, holding the mailbox the
    # token was sent to, where the editor's is an administrator writing about an entry.
    return WriteRefusal(
        error_code=Code.LINK_BARRED,
        status=HTTPStatus.FORBIDDEN,
    )


def find_alter_refusal(*, geburtsdatum: str, today: str) -> WriteRefusal | None:
    """Why the typed date is refused, or `None`. Judged BEFORE any write, so a mistyped year spends nothing."""

    age = whole_years_between(born=geburtsdatum, today=today)

    if age < SCHIEDSRICHTER_MIN_AGE_YEARS:
        return WriteRefusal(
            error_code=Code.CONFIRMATION_AGE,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            fields=(("geburtsdatum",),),
        )

    if age > BEWERBUNG_KONTAKT_MAX_AGE_YEARS:
        return WriteRefusal(
            error_code=Code.CONFIRMATION_AGE,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            fields=(("geburtsdatum",),),
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
        error_code=Code.MEDIEN_AGE,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        fields=(("medien",),),
    )


def find_retired_refusal(*, inactive_since: Any) -> WriteRefusal | None:
    """Why a retired referee takes no fresh link, or `None`.

    A refusal to COLLECT and never a retire-first gate: a row taking no new booking would be asked
    to consent to a role nobody can give them.
    """

    if inactive_since is None:
        return None

    return WriteRefusal(
        error_code=Code.SCHIEDSRICHTER_RETIRED,
        status=HTTPStatus.CONFLICT,
    )


def find_missing_address_refusal(*, email: Any) -> WriteRefusal | None:
    """Why there is nobody to send to, or `None`.

    Refused here and not at the calling surface alone: a mint that wrote `sent_at` for a row
    with no address would record a message that was never composed.
    """

    # A stored value the fold cannot canonicalise is no address either, which the ban-list hash
    # would otherwise meet as a 500.
    if email is not None:
        try:
            canonical_address(str(email))
        except ValueError:
            pass
        else:
            return None

    return WriteRefusal(
        error_code=Code.SCHIEDSRICHTER_NO_ADRESSE,
        status=HTTPStatus.CONFLICT,
    )


def find_gesperrt_refusal(*, barred: bool) -> WriteRefusal | None:
    """Why no link may be sent to this address, or `None`. Worded for the administrator who typed it, every site raising it being admin-tier."""

    if not barred:
        return None

    return WriteRefusal(
        error_code=Code.SCHIEDSRICHTER_ADRESSE_BARRED,
        status=HTTPStatus.CONFLICT,
    )


def _address_moves(*, stored: Mapping[str, Any], payload_email: str) -> bool:
    # Both the fold every payload stores, so one string is one mailbox.
    stored_email = (stored.get("kontakt") or {}).get("email")
    return stored_email is None or payload_email != stored_email


def save_moves_the_link(*, stored: Mapping[str, Any], payload_email: str) -> bool:
    """Whether a save retires the referee's link or mints a fresh one: an unanswered referee's address moving to another mailbox.

    Either is a step-up write, a link granting its holder the answer (`app/core/security.py :: verify_step_up`).
    """

    # A CONFIRMED referee's address is never the save's (`find_bestaetigte_adresse_refusal`).
    if is_confirmed(einwilligung=stored.get(EINWILLIGUNG_FELD)):
        return False

    return _address_moves(stored=stored, payload_email=payload_email)


def find_bestaetigte_adresse_refusal(*, stored: Mapping[str, Any], payload_email: str) -> WriteRefusal | None:
    """`schiedsrichter_adresse_only_per_change`: a save moving a CONFIRMED referee's address, which keys their sign-in.

    Only an address change moves it. Refused whole: landing the rest, an editor stale on the address would lose its other fields unseen.
    """

    if not is_confirmed(einwilligung=stored.get(EINWILLIGUNG_FELD)) or not _address_moves(stored=stored, payload_email=payload_email):
        return None

    return WriteRefusal(
        error_code=Code.SCHIEDSRICHTER_ADRESSE_ONLY_PER_CHANGE,
        status=HTTPStatus.CONFLICT,
    )


def compose_korrektur_update(
    *, stored: Mapping[str, Any], payload: Mapping[str, Any], payload_email: str, today: str
) -> tuple[dict[str, Any], bool]:
    """The save's update, and whether it owes a fresh consent link.

    A RETIRED unconfirmed referee's new address is stored and mailed nothing, and their old link
    goes, its mailbox replaced; the reactivation is what asks them.
    """

    if not save_moves_the_link(stored=stored, payload_email=payload_email):
        return {"$set": dict(payload)}, False

    if stored.get("inactive_since") is not None:
        return {"$set": dict(payload), "$unset": {BESTAETIGUNG_FELD: ""}}, False

    # An UNCONFIRMED referee's old link went to a mailbox nobody reads, and leaving it live is a
    # credential in the wrong inbox.
    return {"$set": {**payload, **compose_mint_update(today=today)}}, True


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
# of the row is what must not reach them.
BESTAETIGUNG_ANSICHT_FIELDS: Mapping[str, int] = {
    f"{EINWILLIGUNG_FELD}.confirmed_at": 1,
    f"{BESTAETIGUNG_FELD}.frist": 1,
    # For the ban list alone, as the answer's read takes it: the response model declares no field to
    # carry it.
    "kontakt.email": 1,
    # Suppressed here alone: this endpoint stores nothing, so it needs no key to patch on.
    "_id": 0,
}

# Narrower than the view's: the answer takes its wording from the payload rather than the row. The
# address is what the press asks the ban list of, and no answer carries it.
BESTAETIGUNG_ANTWORT_FIELDS: Mapping[str, int] = {
    f"{EINWILLIGUNG_FELD}.confirmed_at": 1,
    f"{BESTAETIGUNG_FELD}.frist": 1,
    "kontakt.email": 1,
}

# What the re-send judges, and the address it hashes against the ban list.
EINLADEN_FIELDS: Mapping[str, int] = {"inactive_since": 1, "kontakt.email": 1, f"{EINWILLIGUNG_FELD}.confirmed_at": 1}


def build_self_referee_filter(*identifiers: str, schiedsrichter_id: Any = None) -> Mapping[str, Any]:
    """The referee rows of these addresses, retired ones included: a withdrawal reaches them too."""

    return {
        # Folded here, the form every referee record stores.
        "kontakt.email": {"$in": sorted({sign_in_identifier(identifier) for identifier in identifiers})},
        **(build_real_referees_filter() if schiedsrichter_id is None else build_referee_filter(schiedsrichter_id)),
    }


# An INCLUSION, for `BESTAETIGUNG_ANSICHT_FIELDS`' reason: the link's hash stays off a person-tier read.
# The fee is the referee's own data, which the confirmation page says they can always see.
SELBST_FIELDS: Mapping[str, int] = {
    "name": 1,
    "schule": 1,
    "kontakt": 1,
    "geburtsdatum": 1,
    "default_payment": 1,
    "inactive_since": 1,
    EINWILLIGUNG_FELD: 1,
}


def build_self_referee_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """The referee rows a person's own pages read, each a candidate for `app/api/identitaet/services.py :: ist_eigener_schiedsrichter`.

    Unbounded: a capped list reads as a person holding fewer records.
    """

    return [{"$match": build_self_referee_filter(identifier)}, {"$project": dict(SELBST_FIELDS)}, {"$sort": {"_id": 1}}]
