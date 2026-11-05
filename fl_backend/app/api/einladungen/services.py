"""
API · the invite's judgements, spelled apart from the request

One planner decides who a season's press mails, and the preview answers the same call. Two readers
of one rule is how a preview starts telling an administrator something the press then contradicts.
"""

from collections.abc import Collection, Mapping
from http import HTTPStatus
from typing import Any, NamedTuple

from app.api.bewerbungen.services import seat_named
from app.api.einladungen.schemas import FLInvitationRecipient, FLInvitationSkipReason
from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.shared.einwilligung import is_confirmed
from app.shared.schemas.literals import KONTAKT_ROLLEN

# An exclusion rather than an inclusion list, as `app/api/bewerbungen/services.py ::
# WITHOUT_TOKEN_HASHES` is: what it subtracts is the whole credential, where a list of everything
# else is one a later field joins by being forgotten.
WITHOUT_TOKEN_HASH: Mapping[str, int] = {"token_hashes": 0}


# `app/api/spieler/services.py :: find_squad_refusal` asks the same question of the same junction and
# is pinned to its own caller set, so this slice asks it again rather than widening that one.
def find_team_in_saison_refusal(*, entered: bool) -> WriteRefusal | None:
    """`invitation_team_not_entered`: the season holds no junction row for this team.

    Takes the answer rather than the lookup, so the caller's read runs in the caller's transaction.
    """

    if entered:
        return None

    return WriteRefusal(
        error_code=Code.INVITATION_TEAM_NOT_ENTERED,
        status=HTTPStatus.NOT_FOUND,
    )


def find_saison_vorbei_refusal(*, saison_status: Any) -> WriteRefusal | None:
    """`saison_past`: the season has ended.

    A `future` season mints: an administrator prepares the links before the window opens, and the
    window is judged at every use rather than at the mint.
    """

    if saison_status != "past":
        return None

    return WriteRefusal(
        error_code=Code.SAISON_PAST,
        status=HTTPStatus.CONFLICT,
    )


def find_unknown_einladung_refusal(*, einladung_raw: Mapping[str, Any] | None) -> WriteRefusal | None:
    """`document_not_found`: the link value the visitor presented opens no live invite.

    Takes the row the caller's own read found, for `find_team_in_saison_refusal`'s reason. A revoked
    row is a miss here because the filter that found nothing asked for a live one.
    """

    if einladung_raw is not None:
        return None

    return WriteRefusal(
        error_code=Code.DOCUMENT_NOT_FOUND,
        status=HTTPStatus.NOT_FOUND,
    )


# The partial filter `uniq_invitation_live` is built on, spelled as it is: the equality with `None`
# does not imply it, so a read spelled that way scans every invite. The record model requires the key
# (`app/api/einladungen/schemas.py :: FLEinladungRecord`), so the two select the same rows.
LIVE_EINLADUNG: Mapping[str, Any] = {"revoked_at": {"$type": "null"}}


def build_live_team_filter(*, saison_id: str, team_id: Any) -> Mapping[str, Any]:
    """The live invite of one team and season, which `uniq_invitation_live` makes at most one row."""

    return {"saison_id": saison_id, "team_id": team_id, **LIVE_EINLADUNG}


def find_live_einladung_filter(*, token_hash: str) -> Mapping[str, Any]:
    """The live invite a presented link opens, or nothing.

    The revocation term is half the filter: a hash alone finds the row a reissue replaced, and that
    link is spent.
    """

    return {"token_hashes": token_hash, **LIVE_EINLADUNG}


def compose_einladung(
    *, saison_id: str, team_id: Any, token_hashes: list[str], created_by: str, today: str, sent_at: str | None
) -> dict[str, Any]:
    """One live row: the hash of the link a mint answers for copying, or none where the press's mails mint every link.

    `sent_at` is today where the same write owes the link's mails, as the season's press does, and null on a mint for copying.
    """

    return {
        "saison_id": saison_id,
        "team_id": team_id,
        "token_hashes": token_hashes,
        "created_at": today,
        "created_by": created_by,
        "revoked_at": None,
        "sent_at": sent_at,
    }


def compose_sent_update(*, today: str) -> Mapping[str, Any]:
    """What owing a live link's mails to its seats writes on the row: the day, which the season editor shows as the day it was sent."""

    return {"$set": {"sent_at": today}}


def compose_revocation_update(*, today: str) -> Mapping[str, Any]:
    """What revoking writes. The row stays: a reissue's history is what says which link a bounce was about."""

    return {"$set": {"revoked_at": today}}


def einladung_ist_versendet(einladung_raw: Mapping[str, Any] | None) -> bool:
    """Whether this live link was mailed, by the day the season's press or the team's own stored on it.

    The stored day and never the Postausgang: its row is erased a retention after it settles, and a press judging it would
    then mail the club again, replacing the link it holds. So a link is replaced only by a deliberate resend, whatever
    became of its mail.
    """

    return einladung_raw is not None and einladung_raw.get("sent_at") is not None


def _confirmed_seat(kontakte: Any, seat: str) -> Mapping[str, Any] | None:
    """One seat whose own person has confirmed it, or `None`: an address nobody has proven gets no credential."""

    entry = kontakte.get(seat) if isinstance(kontakte, Mapping) else None
    if not isinstance(entry, Mapping):
        return None

    return entry if is_confirmed(entry.get("einwilligung")) else None


def bestaetigte_empfaenger(*, kontakte: Any) -> list[FLInvitationRecipient]:
    """The mailboxes a link may be sent to, one entry per stored address, each the fold every payload stores."""

    empfaenger: list[FLInvitationRecipient] = []
    seen: set[str] = set()

    for seat in KONTAKT_ROLLEN:
        entry = _confirmed_seat(kontakte, seat)
        rolle = seat_named(seat)
        if entry is None or rolle is None:
            continue

        address = str(entry.get("email") or "")
        if not address or address in seen:
            continue

        seen.add(address)
        empfaenger.append(FLInvitationRecipient(rolle=rolle, vorname=str(entry.get("vorname") or ""), email=address))

    return empfaenger


class EinladungVersandPlan(NamedTuple):
    """What one team's row says, before anything is minted."""

    recipient: list[FLInvitationRecipient]
    skipped: FLInvitationSkipReason | None
    #: Whether minting for this team kills a link somebody may already hold. False on every skip,
    #: which is what leaves a skipped team exactly as it was.
    replaced_link: bool


def plan_einladung_versand(
    *, austritt: Any, kontakte: Any, einladung_raw: Mapping[str, Any] | None, resend: bool, barred: Collection[str]
) -> EinladungVersandPlan:
    """Who this team's link goes to, or why it is skipped. The preview and the press both read it.

    `einladung_raw` is the team's live invite, `None` where it holds none. `barred` holds the stored addresses a standing
    ban holds, as `app/api/sperrliste/lookup.py :: barred_addresses` answers them.
    """

    # The record's PRESENCE, never its `type` and never a flag beside it: a team is out of the
    # season by either route, and a skip naming the contact block would send somebody to repair it.
    if austritt is not None:
        return EinladungVersandPlan([], "austritt_entered", False)

    if not isinstance(kontakte, Mapping):
        return EinladungVersandPlan([], "no_kontaktblock", False)

    empfaenger = bestaetigte_empfaenger(kontakte=kontakte)
    if not empfaenger:
        return EinladungVersandPlan([], "no_confirmed_kontaktperson", False)

    # Ahead of the mail's state, which a barred address's mail settles `barred`: a team reached by
    # nobody else would lose its link to a fresh mint at every press while the ban stands.
    if all(person.email in barred for person in empfaenger):
        return EinladungVersandPlan([], "kontakte_barred", False)

    # Its day and never the row's presence: a team holding a live link nobody was sent is a team this press exists to
    # reach, and skipping on the row would leave sixteen links unsent for ever.
    if einladung_ist_versendet(einladung_raw) and not resend:
        return EinladungVersandPlan([], "already_sent", False)

    return EinladungVersandPlan(empfaenger, None, einladung_raw is not None)
