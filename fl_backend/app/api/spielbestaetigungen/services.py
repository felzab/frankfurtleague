import hashlib
from collections.abc import Mapping, Sequence
from typing import Any, Final, NamedTuple

from app.api.bewerbungen.services import seat_named
from app.api.teams.schemas import KONTAKT_ROLLEN, FLKontaktRolle
from app.api.teams.services import seats_changing_holder

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


# --- A seat write's void: the open rows' entries of every seat whose holder the write moves.


class SeatVoid(NamedTuple):
    """The seats one season row's write empties or hands on, keyed as its team's rows name it."""

    saison_id: Any
    team_id: Any
    seats: tuple[FLKontaktRolle, ...]


def _kontakte_after(*, before: Any, update: Mapping[str, Any]) -> Any:
    """The contact block a write leaves, off the row's pre-image and the write's `$set`."""

    block = dict(before) if isinstance(before, Mapping) else None
    for operator, fields in update.items():
        for path, value in fields.items():
            if path != "kontakte" and not path.startswith("kontakte."):
                continue
            seat = path.removeprefix("kontakte.")
            # Whole seats alone: a write moving one field of a seat could hand it on, which only the
            # identity rule may decide, over a seat it reads whole.
            if operator != "$set" or (path != "kontakte" and seat not in KONTAKT_ROLLEN):
                raise ValueError(f"a seat write sets the block or whole seats, never {operator} {path}")
            if path == "kontakte":
                block = dict(value) if isinstance(value, Mapping) else None
            elif block is not None:
                block[seat] = value

    return block


def seat_void_of(*, before: Mapping[str, Any], update: Mapping[str, Any]) -> SeatVoid | None:
    """What one season row's write voids, or `None` where it moves no holder."""

    kontakte = _kontakte_after(before=before.get("kontakte"), update=update)
    moved = set(seats_changing_holder(stored=before.get("kontakte"), kontakte=kontakte))
    if not moved:
        return None

    # Every seat the write leaves empty too, whose entry is null already wherever no write slipped past this helper: so
    # every whole-block clear nulls one seat set, and a call clearing many rows writes once.
    block = kontakte if isinstance(kontakte, Mapping) else {}
    seats = tuple(seat for seat in KONTAKT_ROLLEN if seat in moved or not isinstance(block.get(seat), Mapping))

    return SeatVoid(saison_id=before["saison_id"], team_id=before["team_id"], seats=seats)


def _team_rows(saison_id: Any, team_id: Any) -> dict[str, Any]:
    return {"saison_id": saison_id, "partei.team_id": team_id}


def _open_team_rows(pairs: Sequence[tuple[Any, Any]]) -> dict[str, Any]:
    """These teams' rows in these seasons that are still answerable, so an answered row keeps its answer and its links."""

    return {"partei.art": "team", **build_answerable_filter(), "$or": [_team_rows(saison_id, team_id) for saison_id, team_id in pairs]}


def build_open_seat_rows_pipeline(voids: Sequence[SeatVoid]) -> list[Mapping[str, Any]]:
    """Per team and season, which seats hold an entry on any open row: one document per row written, so one batch answers it."""

    return [
        {"$match": _open_team_rows([(void.saison_id, void.team_id) for void in voids])},
        {
            "$group": {
                "_id": {"saison_id": "$saison_id", "team_id": "$partei.team_id"},
                # An object sorts above null, so only a standing entry counts.
                **{seat: {"$max": {"$gt": [f"$kontakte.{seat}", None]}} for seat in KONTAKT_ROLLEN},
            }
        },
    ]


def group_seat_voids(
    *, voids: Sequence[SeatVoid], held: Sequence[Mapping[str, Any]]
) -> list[tuple[tuple[FLKontaktRolle, ...], list[tuple[Any, Any]]]]:
    """The teams whose open rows hold an entry of a seat their write moved, grouped by the seats to null.

    One write per group rather than per row, so a call costs the same however many rows it voids.
    """

    seats_of: dict[tuple[Any, Any], set[str]] = {}
    for void in voids:
        seats_of.setdefault((void.saison_id, void.team_id), set()).update(void.seats)

    groups: dict[tuple[FLKontaktRolle, ...], list[tuple[Any, Any]]] = {}
    for team in held:
        pair = (team["_id"]["saison_id"], team["_id"]["team_id"])
        seats = seats_of.get(pair, set())
        # A team whose rows hold none of them is not written: the update would change nothing and still file a log row.
        if any(team.get(seat) is True for seat in seats):
            groups.setdefault(tuple(seat for seat in KONTAKT_ROLLEN if seat in seats), []).append(pair)

    return list(groups.items())


def compose_seat_void(*, seats: Sequence[str], pairs: Sequence[tuple[Any, Any]]) -> tuple[Mapping[str, Any], Mapping[str, Any]]:
    """The filter and update nulling these seats' entries, their hashes and delivery state with them, on these teams' open rows."""

    return _open_team_rows(pairs), {"$set": {f"kontakte.{seat}": None for seat in seats}}
