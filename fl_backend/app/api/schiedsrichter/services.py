from collections.abc import Mapping, Sequence
from datetime import datetime
from http import HTTPStatus
from typing import Any, Final

from app.api.bewerbungen.services import days_after
from app.api.kontakte.services import same_address
from app.api.schiedsrichter.schemas import FLSchiedsrichterAdresswechselZustand, FLSchiedsrichterBestaetigungZustand
from app.api.spiele.schemas import unplayed_filter
from app.core.collections import Collection
from app.core.exceptions import WriteRefusal
from app.core.recording import log_stamp
from app.core.sentinels import GHOST_INACTIVE_SINCE, GHOST_SCHIEDSRICHTER_ID
from app.shared.adresswechsel import ADRESSWECHSEL_FELD as SHARED_ADRESSWECHSEL_FELD
from app.shared.adresswechsel import (
    build_due_terms,
    build_lapsed_terms,
    build_pending_terms,
    build_stopp_terms,
    build_token_terms,
    ist_abgelaufen,
)
from app.shared.alter import whole_years_between
from app.shared.einwilligung import is_confirmed
from app.shared.einwilligung_nachweis import compose_geboren
from app.shared.folding import canonical_address, mailbox_key, sign_in_identifier
from app.shared.schemas.bounds import (
    BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
    MEDIEN_MIN_AGE_YEARS,
    SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE,
    SCHIEDSRICHTER_MIN_AGE_YEARS,
)
from app.shared.schemas.kontakt import FLKontakt

# A played fixture never blocks: its `schiedsrichter` is a record of who officiated.
REFEREE_STILL_ASSIGNED = "REQ-RETIRE-004"


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
SCHIEDSRICHTER_BESTAETIGUNG_GESPERRT = "REQ-SCHIEDSRICHTER-009"
# Its own code and never `-009`'s: that one tells its caller their own mailbox is barred, which here
# would tell a stranger holding a mistyped address that somebody else's is.
SCHIEDSRICHTER_ERSETZTE_ADRESSE_GESPERRT = "REQ-SCHIEDSRICHTER-010"

# The carrier key, which `app/api/zustellung/services.py :: ZIEL_PFADE` also spells for this kind.
# A test holds the two equal: parted, a bounce would be filed under a path no link is stored at.
BESTAETIGUNG_FELD: Final = "bestaetigung"

EINWILLIGUNG_FELD: Final = "einwilligung"


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
        "datum": today,
        "bestaetigt_am": today,
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
    record = compose_geboren(
        block=compose_einwilligung(umfang=umfang, medien=medien, text_version=text_version, today=today), am=am, stamp=log_stamp
    )

    return {"$set": {"geburtsdatum": geburtsdatum, EINWILLIGUNG_FELD: record}}


def build_token_filter(*, token_hash: str) -> Mapping[str, Any]:
    """The hash alone finds the referee. No `inactive_since` term: a person retired after the mint still owns the answer they give."""

    return {f"{BESTAETIGUNG_FELD}.token_hash": token_hash}


def vorname_of(name: Any) -> str | None:
    """The forename inside the one `name` field this collection stores.

    Split rather than stored apart, as every other referee surface reads the whole name. Only the
    account page fills a slot with it (`docs/backend/spec.md :: READ-REFEREE-002`).
    """

    parts = str(name).split() if isinstance(name, str) else []

    return parts[0] if parts else None


def link_is_over(*, frist: Any, today: str) -> bool:
    """Whether the deadline has passed. A block carrying no readable deadline is over: nothing can say it is still running."""

    return not isinstance(frist, str) or frist < today


def frist_abgelaufen(block: Any, *, today: str) -> bool:
    """Whether a link block a row holds has passed its deadline: `link_is_over` over a block that exists."""

    return isinstance(block, Mapping) and link_is_over(frist=block.get("frist"), today=today)


def frist_of(bestaetigung: Any) -> Any:
    return bestaetigung.get("frist") if isinstance(bestaetigung, Mapping) else None


def zustand_of(*, einwilligung: Any, bestaetigung: Any, today: str, gesperrt: bool) -> FLSchiedsrichterBestaetigungZustand:
    """What a reopened link shows: the ban first (`docs/backend/spec.md :: I515`), then a stamp over the deadline.

    A person who answered on the last valid day is shown that they did.
    """

    if gesperrt:
        return "gesperrt"

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
        status=HTTPStatus.NOT_FOUND,
        message="this link opens no referee's entry; it may have been replaced by a newer one, or the entry is gone",
    )


def find_expired_token_refusal(*, frist: Any, today: str) -> WriteRefusal | None:
    """Why this link is over, or `None`."""

    if not link_is_over(frist=frist, today=today):
        return None

    return WriteRefusal(
        error_code=SCHIEDSRICHTER_TOKEN_EXPIRED,
        status=HTTPStatus.GONE,
        message="this link has expired; the administration can send a fresh one",
    )


def find_already_confirmed_refusal(*, einwilligung: Any) -> WriteRefusal | None:
    """Why this entry takes no second answer, or `None`. The single use: a stamp is what spends the link."""

    # The STAMP and never a nulled hash: the hash stays live so a second press is told why
    # (`docs/backend/spec.md :: I307`).
    if not is_confirmed(einwilligung=einwilligung):
        return None

    return WriteRefusal(
        error_code=SCHIEDSRICHTER_ALREADY_CONFIRMED,
        status=HTTPStatus.CONFLICT,
        message="this entry has already been confirmed; an answer is given once",
    )


def find_bestaetigung_gesperrt_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """`REQ-SCHIEDSRICHTER-009`: the ban list holds the address this link was mailed to, however long ago it was minted."""

    if not gesperrt:
        return None

    # 403 where the editor's `-007` is 409: this caller is the barred person, holding the mailbox the
    # token was sent to, where the editor's is an administrator writing about an entry.
    return WriteRefusal(
        error_code=SCHIEDSRICHTER_BESTAETIGUNG_GESPERRT,
        status=HTTPStatus.FORBIDDEN,
        message="the email address this link was sent to is on the ban list, so it confirms nothing",
    )


def find_ersetzte_adresse_gesperrt_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """`REQ-SCHIEDSRICHTER-010`: the ban list holds the address this change would replace, so moving it would carry the ban's person off it."""

    if not gesperrt:
        return None

    # 409 where `-009` is 403: the caller is the new mailbox, which the ban need not be about.
    return WriteRefusal(
        error_code=SCHIEDSRICHTER_ERSETZTE_ADRESSE_GESPERRT,
        status=HTTPStatus.CONFLICT,
        message="this address change can no longer be confirmed; the address on file stays",
    )


def find_alter_refusal(*, geburtsdatum: str, today: str) -> WriteRefusal | None:
    """Why the typed date is refused, or `None`. Judged BEFORE any write, so a mistyped year spends nothing."""

    age = whole_years_between(born=geburtsdatum, today=today)

    if age < SCHIEDSRICHTER_MIN_AGE_YEARS:
        return WriteRefusal(
            error_code=SCHIEDSRICHTER_ALTER,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            fields=(("geburtsdatum",),),
            message=f"this consent is given from {SCHIEDSRICHTER_MIN_AGE_YEARS} years of age, and the date entered does not reach it",
        )

    if age > BEWERBUNG_KONTAKT_MAX_AGE_YEARS:
        return WriteRefusal(
            error_code=SCHIEDSRICHTER_ALTER,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            fields=(("geburtsdatum",),),
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
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        fields=(("medien",),),
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


def _address_moves(*, stored: Mapping[str, Any], payload_email: str) -> bool:
    # One inbox rather than one string: a domain has no case (RFC 5321 §2.4), so a raw compare re-mails
    # an address nobody moved wherever the stored row and the payload spell its domain differently.
    stored_email = (stored.get("kontakt") or {}).get("email")
    return stored_email is None or mailbox_key(payload_email) != mailbox_key(str(stored_email))


def save_moves_the_link(*, stored: Mapping[str, Any], payload_email: str) -> bool:
    """Whether a save retires the referee's link or mints a fresh one: an unanswered referee's address moving to another mailbox.

    Either is a step-up write, a link granting its holder the answer (`app/core/security.py :: verify_step_up`).
    """

    # A CONFIRMED referee's address is never the save's (`find_bestaetigte_adresse_refusal`).
    if is_confirmed(einwilligung=stored.get(EINWILLIGUNG_FELD)):
        return False

    return _address_moves(stored=stored, payload_email=payload_email)


# What every code below refuses is `fl_backend/app/core/domain.py :: RULES`.
SCHIEDSRICHTER_ADRESSE_NUR_PER_WECHSEL = "REQ-SCHIEDSRICHTER-011"
SCHIEDSRICHTER_ADRESSE_UNVERAENDERT = "REQ-SCHIEDSRICHTER-012"
SCHIEDSRICHTER_NAME_IM_GRUND = "REQ-SCHIEDSRICHTER-013"
SCHIEDSRICHTER_UNBESTAETIGT = "REQ-SCHIEDSRICHTER-014"


def find_bestaetigte_adresse_refusal(*, stored: Mapping[str, Any], payload_email: str) -> WriteRefusal | None:
    """`REQ-SCHIEDSRICHTER-011`: a save moving a CONFIRMED referee's address, on which their sign-in is keyed: only an address change moves it.

    Refused whole: landing the rest, an editor stale on the address would lose its other fields unseen.
    """

    if not is_confirmed(einwilligung=stored.get(EINWILLIGUNG_FELD)) or not _address_moves(stored=stored, payload_email=payload_email):
        return None

    return WriteRefusal(
        error_code=SCHIEDSRICHTER_ADRESSE_NUR_PER_WECHSEL,
        status=HTTPStatus.CONFLICT,
        message="this referee has confirmed their entry, so their address moves only through an address change; keep the stored one here",
    )


def compose_korrektur_update(
    *, stored: Mapping[str, Any], payload: Mapping[str, Any], payload_email: str, token_hash: str, today: str
) -> tuple[dict[str, Any], bool]:
    """The save's update, and whether it minted a fresh consent link.

    A RETIRED unconfirmed referee's new address is stored and mailed nothing, and their old link
    goes, its mailbox replaced; the reactivation is what asks them.
    """

    if not save_moves_the_link(stored=stored, payload_email=payload_email):
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


# --- The ADDRESS CHANGE's referee lane. The block, its instants and its steps are both lanes'
# (`app/shared/adresswechsel.py`); what stays here is what a referee's row alone is judged by.

# The carrier key, which `app/api/zustellung/services.py :: ZIEL_PFADE` also spells for this kind.
ADRESSWECHSEL_FELD: Final = SHARED_ADRESSWECHSEL_FELD


def build_adresswechsel_filter(*, token_hash: str) -> Mapping[str, Any]:
    """The new mailbox's hash alone finds the referee, retired or not: the address is theirs to confirm either way."""

    return build_token_terms(token_hash)


def build_stopp_filter(*, stopp_hash: str) -> Mapping[str, Any]:
    """The address on file's stop hash alone finds the referee, retired or not."""

    return build_stopp_terms(stopp_hash)


def build_pending_adresswechsel_filter(schiedsrichter_id: Any, terms: Mapping[str, Any] | None = None) -> Mapping[str, Any]:
    """One real referee holding a pending change matching `terms`. The filter is the judgement: a referee holding none answers 404."""

    return {**build_referee_filter(schiedsrichter_id), **build_pending_terms(), **(terms or {})}


def build_lapsed_adresswechsel_filter(*, now: datetime, schiedsrichter_id: Any = None) -> Mapping[str, Any]:
    """Every real referee, retired or not, whose change's waiting step lapsed by `now`; given an id, that one alone."""

    if schiedsrichter_id is None:
        return build_real_referees_filter({**build_pending_terms(), **build_lapsed_terms(now)})

    return build_pending_adresswechsel_filter(schiedsrichter_id, build_lapsed_terms(now))


def build_due_adresswechsel_filter(*, now: datetime, schiedsrichter_id: Any = None) -> Mapping[str, Any]:
    """Every real referee whose confirmed change's waiting time ended by `now`; given an id, that one alone."""

    if schiedsrichter_id is None:
        return build_real_referees_filter({**build_pending_terms(), **build_due_terms(now)})

    return build_pending_adresswechsel_filter(schiedsrichter_id, build_due_terms(now))


def find_adresswechsel_expired_refusal(*, block: Any, now: datetime) -> WriteRefusal | None:
    """`REQ-SCHIEDSRICHTER-003` on an address change: the step it waits on, its link or its approval, lapsed."""

    if not ist_abgelaufen(block, now=now):
        return None

    return WriteRefusal(
        error_code=SCHIEDSRICHTER_TOKEN_EXPIRED,
        status=HTTPStatus.GONE,
        message="this step of the address change has lapsed; the change is removed within the hour and may be started afresh",
    )


def find_schiedsrichter_adresse_unveraendert_refusal(*, stored: Any, email: str) -> WriteRefusal | None:
    """`REQ-SCHIEDSRICHTER-012`: the typed address signs in as the stored one already, so it would ask a mailbox already proved."""

    if not isinstance(stored, str) or sign_in_identifier(email) != sign_in_identifier(stored):
        return None

    return WriteRefusal(
        error_code=SCHIEDSRICHTER_ADRESSE_UNVERAENDERT,
        status=HTTPStatus.CONFLICT,
        message="this is the email address the referee already holds",
    )


def find_unbestaetigter_wechsel_refusal(*, einwilligung: Any) -> WriteRefusal | None:
    """`REQ-SCHIEDSRICHTER-014`: an address change for a referee who has not confirmed, whose address is no sign-in yet.

    A refusal of the row's state rather than a 404, as `REQ-SCHIEDSRICHTER-004` refuses a confirmed one's fresh link.
    """

    if is_confirmed(einwilligung=einwilligung):
        return None

    return WriteRefusal(
        error_code=SCHIEDSRICHTER_UNBESTAETIGT,
        status=HTTPStatus.CONFLICT,
        message="this referee has not confirmed their entry yet, so their address is corrected in the editor, which mints a fresh link",
    )


def find_schiedsrichter_name_im_grund_refusal(*, nennt_namen: bool) -> WriteRefusal | None:
    """`REQ-SCHIEDSRICHTER-013`: the pupil's `REQ-SPIELER-009`, for its reason, on this lane's start."""

    if not nennt_namen:
        return None

    # Naming none of them: the message reaches the refusal's log line.
    return WriteRefusal(
        error_code=SCHIEDSRICHTER_NAME_IM_GRUND,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        message="the reason for this address change names the person, and the log keeps every row it files for a year",
        fields=(("grund",),),
    )


def adresswechsel_image_edits(image: Mapping[str, Any], identifier: str) -> dict[str, None]:
    """The pending block in one log image of a referee, emptied where it names this mailbox on the fold.

    Another address's block stays, and so does the referee's own record beside it: their earlier
    consent states are theirs.
    """

    wechsel = image.get(ADRESSWECHSEL_FELD)
    email = wechsel.get("email") if isinstance(wechsel, Mapping) else None

    return {ADRESSWECHSEL_FELD: None} if isinstance(email, str) and sign_in_identifier(email) == identifier else {}


def adresswechsel_zustand_of(
    *, wechsel: Mapping[str, Any], now: datetime, gesperrt: bool, ersetzte_gesperrt: bool, vergeben: bool
) -> FLSchiedsrichterAdresswechselZustand:
    """What the new mailbox's link shows, ranked as the press refuses a confirmation.

    The link's own address barred first, then the deadline, then the replaced address barred or the new one another
    pupil's, where a pupil row moves.
    """

    if gesperrt:
        return "gesperrt"

    if ist_abgelaufen(wechsel, now=now):
        return "abgelaufen"

    return "nicht_bestaetigbar" if ersetzte_gesperrt or vergeben else "gueltig"


# An INCLUSION, for `BESTAETIGUNG_ANSICHT_FIELDS`' reason. The block's hashes are read and never served, and both
# addresses for the ban list and the holder check alone.
ADRESSWECHSEL_ANSICHT_FIELDS: Mapping[str, int] = {"kontakt.email": 1, ADRESSWECHSEL_FELD: 1}


def adresswechsel_adressen(raw: Mapping[str, Any]) -> tuple[str, str]:
    """The address the link was mailed to and the one it would replace, as the ban list is asked about them."""

    wechsel = raw.get(ADRESSWECHSEL_FELD) or {}

    return str(wechsel.get("email") or ""), str((raw.get("kontakt") or {}).get("email") or "")


# An INCLUSION and never an exclusion: a base-tier caller holds the whole credential, so the rest
# of the row is what must not reach them (`docs/backend/spec.md :: READ-REFEREE-002`).
BESTAETIGUNG_ANSICHT_FIELDS: Mapping[str, int] = {
    f"{EINWILLIGUNG_FELD}.bestaetigt_am": 1,
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
    f"{EINWILLIGUNG_FELD}.bestaetigt_am": 1,
    f"{BESTAETIGUNG_FELD}.frist": 1,
    "kontakt.email": 1,
}

# What the re-send judges, and the address it hashes against the ban list.
EINLADEN_FIELDS: Mapping[str, int] = {"inactive_since": 1, "kontakt.email": 1, f"{EINWILLIGUNG_FELD}.bestaetigt_am": 1}


def build_selbst_referee_filter(identifier: str, *, schiedsrichter_id: Any = None) -> Mapping[str, Any]:
    """The referee rows that may be this address's own, retired ones included: a withdrawal reaches them too.

    A pre-filter reading every mailbox sharing the local part, in any case or domain: the caller keeps
    the rows `app/api/identitaet/services.py :: folds_to` confirms.
    """

    return {
        "kontakt.email": same_address(identifier),
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


def build_selbst_referee_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """The referee rows a person's own pages read, each a candidate for `app/api/identitaet/services.py :: ist_eigener_schiedsrichter`.

    Unbounded: a capped list reads as a person holding fewer records.
    """

    return [{"$match": build_selbst_referee_filter(identifier)}, {"$project": dict(SELBST_FIELDS)}, {"$sort": {"_id": 1}}]
