import hashlib
from collections.abc import Mapping, Sequence
from typing import Any, Final, NamedTuple

from app.api.bewerbungen.services import seat_named
from app.api.teams.schemas import KONTAKT_ROLLEN, FLKontaktRolle
from app.api.teams.services import seats_changing_holder
from app.core.collections import Collection

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


def kontakte_ohne(stored_kontakte: Any, seats: Sequence[str]) -> Any:
    """The block a write emptying these seats leaves: what a Widerspruch or an erasure hands `seat_void_of`."""

    if not isinstance(stored_kontakte, Mapping):
        return stored_kontakte

    return {**stored_kontakte, **dict.fromkeys(seats)}


def seat_void_of(*, saison_id: Any, team_id: Any, stored_kontakte: Any, kontakte: Any) -> SeatVoid | None:
    """What one season row's write voids, read off the block it replaced and the block it leaves; `None` where it moves no holder."""

    moved = set(seats_changing_holder(stored=stored_kontakte, kontakte=kontakte))
    if not moved:
        return None

    # Every seat the write leaves empty too, whose entry is null already wherever no write slipped past the void: so
    # every whole-block clear nulls one seat set, and a call clearing many rows writes once.
    block = kontakte if isinstance(kontakte, Mapping) else {}
    seats: tuple[FLKontaktRolle, ...] = tuple(seat for seat in KONTAKT_ROLLEN if seat in moved or not isinstance(block.get(seat), Mapping))

    return SeatVoid(saison_id=saison_id, team_id=team_id, seats=seats)


def _team_rows(saison_id: Any, team_id: Any) -> dict[str, Any]:
    return {"saison_id": saison_id, "partei.team_id": team_id}


def build_open_team_rows_filter(pairs: Sequence[tuple[Any, Any]]) -> dict[str, Any]:
    """These teams' rows in these seasons that are still answerable, so an answered row keeps its answer and its links."""

    return {"partei.art": "team", **build_answerable_filter(), "$or": [_team_rows(saison_id, team_id) for saison_id, team_id in pairs]}


def build_open_seat_rows_pipeline(voids: Sequence[SeatVoid]) -> list[Mapping[str, Any]]:
    """Per team and season, which seats hold an entry on any open row: one document per row written, so one batch answers it."""

    return [
        {"$match": build_open_team_rows_filter([(void.saison_id, void.team_id) for void in voids])},
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


# --- A CONTACT PERSON'S ERASURE: the reason a seat they hold gave on their team's confirmations.


class TeamSeats(NamedTuple):
    """The seats one person held on one team's season row, keyed as that team's confirmations name it."""

    saison_id: Any
    team_id: Any
    seats: Sequence[str]


def build_contact_reasons_filter(held: Sequence[TeamSeats]) -> dict[str, Any]:
    """Every row of these teams answered from one of these seats with a reason, closed since or not."""

    return {
        "partei.art": "team",
        "antwort.von.art": "kontakt",
        "antwort.begruendung": {"$ne": None},
        "$or": [{**_team_rows(team.saison_id, team.team_id), "antwort.von.rolle": {"$in": list(team.seats)}} for team in held],
    }


def build_contact_reason_images_filter(held: Sequence[TeamSeats]) -> dict[str, Any]:
    """Log rows whose image may hold such a reason; `contact_reason_image_edits` decides, an image at a time."""

    return {
        "collection": str(Collection.SPIELBESTAETIGUNGEN),
        "before.antwort.von.art": "kontakt",
        "$or": [{"before.saison_id": team.saison_id, "before.partei.team_id": team.team_id} for team in held],
    }


def contact_reason_image_edits(image: Mapping[str, Any], held: Sequence[TeamSeats]) -> dict[str, Any]:
    """One image's reason nulled where one of these seats gave it for its team; its answer, day and role stay."""

    partei, antwort = image.get("partei"), image.get("antwort")
    if not isinstance(partei, Mapping) or not isinstance(antwort, Mapping) or antwort.get("begruendung") is None:
        return {}

    von = antwort.get("von")
    given = (image.get("saison_id"), partei.get("team_id"), von.get("rolle") if isinstance(von, Mapping) else None)
    if (
        isinstance(von, Mapping)
        and von.get("art") == "kontakt"
        and any(given == (t.saison_id, t.team_id, seat) for t in held for seat in t.seats)
    ):
        return {"antwort.begruendung": None}

    return {}
