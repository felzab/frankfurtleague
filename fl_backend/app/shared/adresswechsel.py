"""
SHARED · one pending address change, as the pupil's and the referee's rows each carry it

A change belongs to an address, whichever of its rows carries it, so both lanes write, read and judge
one block by these functions; each lane's validator still spells the block apart
(`app/core/constraints.py :: _SPIELER_ADRESSWECHSEL`). Pure: no read, no write.

Invariants:
- Every instant is stored as a BSON date and compared as one; a filter on one always carries
  `$type: "date"`, so a null never compares.
"""

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, Final, Literal, get_args
from zoneinfo import ZoneInfo

from app.shared.schemas.bounds import ADRESSWECHSEL_GUELTIG_STUNDEN, ADRESSWECHSEL_WARTEZEIT_TAGE

# The carrier key on both collections, which `app/api/zustellung/services.py :: ZIEL_PFADE` also spells.
ADRESSWECHSEL_FELD: Final = "adresswechsel"

# How the change takes effect: the person's own start, an administrator's start the address on file
# approves, and an administrator's start with a recorded reason that waits after its confirmation.
FLAdresswechselWeg = Literal["konto", "freigabe", "wartezeit"]
ADRESSWECHSEL_WEGE: Final[tuple[str, ...]] = get_args(FLAdresswechselWeg)

# What the change waits on: the address on file's approval, the new mailbox's link, or its waiting time.
FLAdresswechselWartetAuf = Literal["freigabe", "neue_adresse", "wartezeit"]

# What the stop link of the address on file shows, one state per step the change waits on.
FLAdresswechselBisherigZustand = Literal["freigabe_offen", "offen", "wartezeit"]

_GERMANY: Final = ZoneInfo("Europe/Berlin")


def _feld(key: str) -> str:
    return f"{ADRESSWECHSEL_FELD}.{key}"


def als_utc(moment: Any) -> datetime | None:
    """A stored instant marked as the UTC it is, the driver reading one back with no offset; `None` for anything else."""

    if not isinstance(moment, datetime):
        return None

    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


def gueltig_bis_ab(now: datetime) -> datetime:
    """When a step asked at `now` lapses: a link to the new mailbox, or the approval asked of the address on file."""

    return now.astimezone(UTC) + timedelta(hours=ADRESSWECHSEL_GUELTIG_STUNDEN)


def _german_day(now: datetime) -> str:
    # The day the restore planner judges a link's send by (`app/api/identitaet/wiederherstellung.py :: Window`).
    return now.astimezone(_GERMANY).strftime("%Y-%m-%d")


def compose_block(
    *, email: str, weg: FLAdresswechselWeg, token_hash: str | None, stopp_hash: str, grund: str | None, now: datetime
) -> dict[str, Any]:
    """The WHOLE block a start writes, so a replaced change's links die and its message's delivery state goes with it.

    `token_hash` is null on a change asking the address on file's approval first: nothing reaches the new mailbox before it.
    """

    return {
        "email": email,
        "weg": weg,
        "token_hash": token_hash,
        "stopp_hash": stopp_hash,
        "verschickt_am": _german_day(now),
        "gueltig_bis": gueltig_bis_ab(now),
        "freigegeben_am": None,
        "grund": grund,
        "bestaetigt_am": None,
        "wirksam_ab": None,
    }


def compose_link_update(*, token_hash: str, now: datetime, freigabe: bool) -> dict[str, Any]:
    """A fresh link to the new mailbox, for the approval or a re-send: the stop hash stays, so the address on file's link keeps working.

    The delivery state goes: it described the message the replaced link went out in.
    """

    gesetzt: dict[str, Any] = {
        _feld("token_hash"): token_hash,
        _feld("gueltig_bis"): gueltig_bis_ab(now),
        _feld("verschickt_am"): _german_day(now),
    }
    if freigabe:
        gesetzt[_feld("freigegeben_am")] = now.astimezone(UTC)

    return {"$set": gesetzt, "$unset": {_feld("zustellung"): ""}}


def wirksam_ab_von(bestaetigt_am: datetime) -> datetime:
    return bestaetigt_am.astimezone(UTC) + timedelta(days=ADRESSWECHSEL_WARTEZEIT_TAGE)


def compose_wartezeit_update(*, now: datetime) -> dict[str, Any]:
    """The new mailbox confirmed a change that waits: its link spent, and the instant the hourly pass makes it take effect."""

    return {
        "$set": {
            _feld("token_hash"): None,
            _feld("gueltig_bis"): None,
            _feld("bestaetigt_am"): now.astimezone(UTC),
            _feld("wirksam_ab"): wirksam_ab_von(now),
        }
    }


def build_token_terms(token_hash: str) -> dict[str, Any]:
    """The new mailbox's link; a null hash is one key no hex digest equals, so a change awaiting approval matches no token."""

    return {_feld("token_hash"): token_hash}


def build_stopp_terms(stopp_hash: str) -> dict[str, Any]:
    """The address on file's stop link, answering for the whole life of the change."""

    return {_feld("stopp_hash"): stopp_hash}


def build_pending_terms() -> dict[str, Any]:
    return {ADRESSWECHSEL_FELD: {"$type": "object"}}


def build_awaiting_approval_terms() -> dict[str, Any]:
    """A change an administrator started without a reason, its address on file not yet asked to approve it in vain."""

    return {_feld("weg"): "freigabe", _feld("token_hash"): None, _feld("bestaetigt_am"): None}


def build_resendable_terms() -> dict[str, Any]:
    """A change waiting on the new mailbox: one awaiting approval, or confirmed and waiting, has no link to re-send."""

    return {_feld("token_hash"): {"$type": "string"}, _feld("bestaetigt_am"): None}


def build_lapsed_terms(now: datetime) -> dict[str, Any]:
    """A change whose waiting step lapsed at or before `now`: its link, or the approval it asked."""

    return {_feld("gueltig_bis"): {"$type": "date", "$lte": now}}


def build_due_terms(now: datetime) -> dict[str, Any]:
    """A confirmed change whose waiting time ended at or before `now`."""

    return {_feld("wirksam_ab"): {"$type": "date", "$lte": now}}


def ist_abgelaufen(block: Any, *, now: datetime) -> bool:
    """Whether the step a pending block waits on has lapsed, judged as the lapse removes it; a block with no deadline waits on none."""

    if not isinstance(block, Mapping):
        return False

    gueltig_bis = als_utc(block.get("gueltig_bis"))

    return gueltig_bis is not None and gueltig_bis <= now


def wartet_auf(block: Mapping[str, Any]) -> FLAdresswechselWartetAuf:
    if block.get("bestaetigt_am") is not None:
        return "wartezeit"

    if block.get("weg") == "freigabe" and block.get("token_hash") is None:
        return "freigabe"

    return "neue_adresse"


_BISHERIG: Final[Mapping[FLAdresswechselWartetAuf, FLAdresswechselBisherigZustand]] = {
    "freigabe": "freigabe_offen",
    "neue_adresse": "offen",
    "wartezeit": "wartezeit",
}


def bisherig_zustand(block: Mapping[str, Any]) -> FLAdresswechselBisherigZustand:
    """What the stop link shows: the step the change waits on, and never whether it could be confirmed, the stop being refused nothing."""

    return _BISHERIG[wartet_auf(block)]


def neue_adresse_of(block: Any) -> str | None:
    email = block.get("email") if isinstance(block, Mapping) else None

    return email if isinstance(email, str) else None
