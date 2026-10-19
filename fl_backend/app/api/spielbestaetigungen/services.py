import hashlib
from collections.abc import Mapping, Sequence
from typing import Any, Final

from app.api.bewerbungen.services import seat_named
from app.api.teams.schemas import KONTAKT_ROLLEN, FLKontaktRolle
from app.core.collections import Collection
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID

# Each stored `ansetzung` key and its fixture path: the ONE list the digest, the snapshot and the public
# verdict's `$lookup` read, a key one lacks giving two answers to which Ansetzung a row is about.
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
    """The digest of a raw fixture's Ansetzung: `datum`, `uhrzeit`, `ort.spielort_id`, `team1.team_id`, `team2.team_id`.

    The ground on purpose: a confirmation binds it too. A sixth input changes every stored row's meaning.
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


# --- The REFEREE'S ERASURE: which rows and log images name the person, and what each image becomes.


def build_referee_rows_filter(schiedsrichter_ids: Sequence[Any]) -> Mapping[str, Any]:
    """Every row whose party is one of these referees, open, answered or closed."""

    return {"partei.art": "schiedsrichter", "partei.schiedsrichter_id": {"$in": list(schiedsrichter_ids)}}


def build_referee_images_filter(schiedsrichter_ids: Sequence[Any]) -> Mapping[str, Any]:
    """Every `spielbestaetigungen` log row whose image names one of these referees as its party.

    Selected inside the image, as `app/api/schiedsrichter/services.py :: build_booked_image_filter` selects: an undraw's
    `delete_many` row holds images of rows long gone, which no id standing now reaches.
    """

    return {"collection": str(Collection.SPIELBESTAETIGUNGEN), "before.partei.schiedsrichter_id": {"$in": list(schiedsrichter_ids)}}


def referee_image_edits(image: Mapping[str, Any], schiedsrichter_ids: Sequence[Any]) -> dict[str, Any]:
    """One image naming one of these referees, its party repointed at the ghost and their reason nulled.

    The Ansetzung, the deadline and which way the answer went stay: they name nobody once the party is the ghost.
    """

    partei = image.get("partei")
    if not isinstance(partei, Mapping) or partei.get("art") != "schiedsrichter" or partei.get("schiedsrichter_id") not in schiedsrichter_ids:
        return {}

    edits: dict[str, Any] = {"partei.schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID}
    if isinstance(image.get("antwort"), Mapping):
        edits["antwort.begruendung"] = None

    return edits
