"""
API · the invite's judgements, spelled apart from the request

One planner decides who a season's press mails, and the preview answers the same call. Two readers
of one rule is how a preview starts telling an administrator something the press then contradicts.
"""

from collections.abc import Mapping
from http import HTTPStatus
from typing import Any, NamedTuple

from app.api.bewerbungen.services import KONTAKT_SEATS, seat_named
from app.api.einladungen.schemas import FLEinladungEmpfaenger, FLEinladungVersandGrund
from app.core.exceptions import WriteRefusal
from app.shared.einwilligung import is_confirmed
from app.shared.folding import mailbox_key

EINLADUNG_TEAM_NICHT_EINGETRAGEN = "REQ-EINLADUNG-001"
EINLADUNG_SAISON_VORBEI = "REQ-EINLADUNG-002"
# One code for a link nobody minted and one an administrator replaced, for the reason
# `REQ-BEWERBUNG-009` gives: nothing tells a stranger's guess from a spent link, and naming which
# would say more than the guess knew.
EINLADUNG_UNBEKANNT = "REQ-EINLADUNG-003"

# An exclusion rather than an inclusion list, as `app/api/bewerbungen/services.py ::
# WITHOUT_TOKEN_HASHES` is: what it subtracts is the whole credential, where a list of everything
# else is one a later field joins by being forgotten.
WITHOUT_TOKEN_HASH: Mapping[str, int] = {"token_hash": 0}


# `app/api/spieler/services.py :: find_squad_refusal` asks the same question of the same junction and
# is pinned to its own caller set, so this slice asks it again rather than widening that one.
def find_team_in_saison_refusal(*, entered: bool) -> WriteRefusal | None:
    """`REQ-EINLADUNG-001`: the season holds no junction row for this team.

    Takes the answer rather than the lookup, so the caller's read runs in the caller's transaction.
    """

    if entered:
        return None

    return WriteRefusal(
        error_code=EINLADUNG_TEAM_NICHT_EINGETRAGEN,
        status=HTTPStatus.NOT_FOUND,
        message="this team is not entered in that season, so there is nothing for a registration link to open",
    )


def find_saison_vorbei_refusal(*, saison_status: Any) -> WriteRefusal | None:
    """`REQ-EINLADUNG-002`: the season has ended.

    A `future` season mints: an administrator prepares the links before the window opens, and the
    window is judged at every use rather than at the mint.
    """

    if saison_status != "past":
        return None

    return WriteRefusal(
        error_code=EINLADUNG_SAISON_VORBEI,
        status=HTTPStatus.CONFLICT,
        message="this season has ended, and a registration link for it would open nothing",
    )


def find_unknown_einladung_refusal(*, einladung_raw: Mapping[str, Any] | None) -> WriteRefusal | None:
    """`REQ-EINLADUNG-003`: the link value the visitor presented opens no live invite.

    Takes the row the caller's own read found, for `find_team_in_saison_refusal`'s reason. A revoked
    row is a miss here because the filter that found nothing asked for a live one.
    """

    if einladung_raw is not None:
        return None

    return WriteRefusal(
        error_code=EINLADUNG_UNBEKANNT,
        status=HTTPStatus.NOT_FOUND,
        message="this registration link opens nothing: no invitation matches it, or the one it was minted for has been replaced",
    )


def registrierungsfenster_laeuft(*, registrierung: Any, today: str) -> bool:
    """Whether this season's registration window runs on `today`: `offen`, AND the day inside the span.

    Both ends compared: span ordering is enforced on the season PAYLOAD alone, so a stored reversal
    is reachable (`docs/backend/spec.md :: I278`).
    """

    if not isinstance(registrierung, Mapping):
        return False

    von, bis = registrierung.get("von"), registrierung.get("bis")

    # Both ends `str` before comparing, never `str(...)` around them: `str(None)` is `"None"`, which
    # every date sorts below, so a stored null end would hold this window open for ever.
    if not isinstance(von, str) or not isinstance(bis, str):
        return False

    return bool(registrierung.get("offen")) and von <= today <= bis


def build_live_team_filter(*, saison_id: str, team_id: Any) -> Mapping[str, Any]:
    """The live invite of one team and season, which `uniq_einladung_live` makes at most one row."""

    return {"saison_id": saison_id, "team_id": team_id, "widerrufen_am": None}


def find_live_einladung_filter(*, token_hash: str) -> Mapping[str, Any]:
    """The live invite a presented link opens, or nothing.

    The revocation term is half the filter: a hash alone finds the row a reissue replaced, and that
    link is spent.
    """

    return {"token_hash": token_hash, "widerrufen_am": None}


def compose_einladung(*, saison_id: str, team_id: Any, token_hash: str, erstellt_von: str, today: str) -> dict[str, Any]:
    """One minted row, mailed to nobody yet.

    `versand` is written EMPTY rather than left out: `app/api/bewerbungen/services.py ::
    zustellung_send_applies` skips a record with no carrier, so a mint without one could never
    record that its link went anywhere.
    """

    return {
        "saison_id": saison_id,
        "team_id": team_id,
        "token_hash": token_hash,
        "erstellt_am": today,
        "erstellt_von": erstellt_von,
        "widerrufen_am": None,
        "versand": {},
    }


def compose_widerruf_update(*, today: str) -> Mapping[str, Any]:
    """What revoking writes. The row stays: a reissue's history is what says which link a bounce was about."""

    return {"$set": {"widerrufen_am": today}}


def einladung_ist_versendet(*, einladung_raw: Mapping[str, Any] | None) -> bool:
    """Whether a message about this invite went out.

    The message ID rather than the record's presence: a record naming NO message records a send the
    provider refused outright, which is a team nobody reached.
    """

    if einladung_raw is None:
        return False

    versand = einladung_raw.get("versand")
    zustellung = versand.get("zustellung") if isinstance(versand, Mapping) else None

    # The id and never `stand`: a real message that BOUNCED carries one of
    # `app/api/bewerbungen/services.py :: ZUSTELLUNG_ABGEWIESEN`'s states too, and that team WAS
    # reached, so a press judging the state would re-mail it for ever.
    return isinstance(zustellung, Mapping) and bool(zustellung.get("nachricht_id"))


def _confirmed_seat(kontakte: Any, seat: str) -> Mapping[str, Any] | None:
    """One seat whose own person has confirmed it, or `None`: an address nobody has proven gets no credential."""

    entry = kontakte.get(seat) if isinstance(kontakte, Mapping) else None
    if not isinstance(entry, Mapping):
        return None

    return entry if is_confirmed(entry.get("einwilligung")) else None


def bestaetigte_empfaenger(*, kontakte: Any) -> list[FLEinladungEmpfaenger]:
    """The mailboxes a link may be sent to, one entry per mailbox.

    `app/shared/folding.py :: mailbox_key`'s question and never the sign-in fold's, which would
    make two seats parted by the case of their local parts one recipient.
    """

    empfaenger: list[FLEinladungEmpfaenger] = []
    seen: set[str] = set()

    for seat in KONTAKT_SEATS:
        entry = _confirmed_seat(kontakte, seat)
        rolle = seat_named(seat)
        if entry is None or rolle is None:
            continue

        address = str(entry.get("email") or "")
        mailbox = mailbox_key(address)
        if not mailbox or mailbox in seen:
            continue

        seen.add(mailbox)
        empfaenger.append(FLEinladungEmpfaenger(rolle=rolle, vorname=str(entry.get("vorname") or ""), email=address))

    return empfaenger


class EinladungVersandPlan(NamedTuple):
    """What one team's row says, before anything is minted."""

    empfaenger: list[FLEinladungEmpfaenger]
    uebersprungen: FLEinladungVersandGrund | None
    #: Whether minting for this team kills a link somebody may already hold. False on every skip,
    #: which is what leaves a skipped team exactly as it was.
    ersetzt_link: bool


def plan_einladung_versand(*, austritt: Any, kontakte: Any, einladung_raw: Mapping[str, Any] | None, erneut: bool) -> EinladungVersandPlan:
    """Who this team's link goes to, or why it is skipped. The preview and the press both read it."""

    # The record's PRESENCE, never its `type` and never a flag beside it: a team is out of the
    # season by either route, and a skip naming the contact block would send somebody to repair it.
    if austritt is not None:
        return EinladungVersandPlan([], "austritt_eingetragen", False)

    if not isinstance(kontakte, Mapping):
        return EinladungVersandPlan([], "kein_kontaktblock", False)

    empfaenger = bestaetigte_empfaenger(kontakte=kontakte)
    if not empfaenger:
        return EinladungVersandPlan([], "keine_bestaetigte_kontaktperson", False)

    # The delivery record and never the row: a team holding a live link nobody sent is a team this
    # press exists to reach, and skipping on the row would leave sixteen links unsent for ever.
    if einladung_ist_versendet(einladung_raw=einladung_raw) and not erneut:
        return EinladungVersandPlan([], "bereits_gesendet", False)

    return EinladungVersandPlan(empfaenger, None, einladung_raw is not None)
