import hashlib
from collections.abc import Mapping
from typing import Any, Final

from app.api.bewerbungen.services import seat_named
from app.api.teams.schemas import KONTAKT_ROLLEN, FLKontaktRolle

# A stored `ansetzung` key and the fixture path it is read from. The ONE list the digest, the stored
# snapshot and the public verdict's `$lookup` all read: a key one of them lacks gives two answers to
# whether a row is about the fixture's current Ansetzung.
ANSETZUNG_QUELLEN: Final[Mapping[str, str]] = {
    "datum": "datum",
    "uhrzeit": "uhrzeit",
    "spielort_id": "ort.spielort_id",
    "team1_id": "team1.team_id",
    "team2_id": "team2.team_id",
}

# The request and the two reminders: every link a seat was mailed answers until the deadline, so a
# reminder appends its hash and the oldest one cannot fall off before the row closes.
TOKEN_HASHES_PER_SEAT: Final = 3


def _read_path(document: Mapping[str, Any], path: str) -> Any:
    value: Any = document
    for key in path.split("."):
        value = value.get(key) if isinstance(value, Mapping) else None

    return value


def _ansetzung_values(spiel: Mapping[str, Any]) -> dict[str, Any]:
    return {key: _read_path(spiel, path) for key, path in ANSETZUNG_QUELLEN.items()}


def _digest(values: Mapping[str, Any]) -> str:
    # A missing value is the empty string; no input's own alphabet holds the separator.
    canonical = "|".join("" if values[key] is None else str(values[key]) for key in ANSETZUNG_QUELLEN)

    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def ansetzung_stand_of(spiel: Mapping[str, Any]) -> str:
    """The digest naming one Ansetzung of a raw fixture: `datum`, `uhrzeit`, `ort.spielort_id`, `team1.team_id`, `team2.team_id`.

    The ground is in it on purpose: a confirmation binds the date, the hour AND the ground, so a change
    to any of them reopens it. A sixth input changes the meaning of every stored row.
    """

    return _digest(_ansetzung_values(spiel))


def compose_ansetzung(spiel: Mapping[str, Any]) -> dict[str, Any]:
    """The stored `ansetzung` of a row minted for this fixture: the digest's inputs and the digest, from one read."""

    values = _ansetzung_values(spiel)

    return {**values, "stand": _digest(values)}


def build_answerable_filter() -> dict[str, Any]:
    """A row the answer may write: neither answered nor closed, the reach of `uniq_spielbestaetigung_offen`.

    The first press binds because this filter rides on the write itself, so two seats pressing at once
    are one answer.
    """

    return {"antwort": None, "geschlossen": None}


def build_closable_filter() -> dict[str, Any]:
    """A row the sweep's close reaches: not yet closed, ANSWERED OR NOT.

    Never `build_answerable_filter`: an agreement a move overtook would keep no stamp saying why it
    stopped applying.
    """

    return {"geschlossen": None}


def build_token_filter(*, token_hash: str) -> Mapping[str, Any]:
    """Every seat's hashes, so the hash alone finds the row. No state term: a reopened link shows its own state."""

    return {"$or": [{f"kontakte.{seat}.token_hashes": token_hash} for seat in KONTAKT_ROLLEN]}


def seat_holding(*, spielbestaetigung_raw: Mapping[str, Any], token_hash: str) -> FLKontaktRolle | None:
    """Which seat this hash names, read off the row the filter found: the first in seat order, where a mirrored pair shares one."""

    block = spielbestaetigung_raw.get("kontakte")
    if not isinstance(block, Mapping):
        return None

    for seat in KONTAKT_ROLLEN:
        entry = block.get(seat)
        hashes = entry.get("token_hashes") if isinstance(entry, Mapping) else None
        if isinstance(hashes, list) and token_hash in hashes:
            return seat_named(seat)

    return None
