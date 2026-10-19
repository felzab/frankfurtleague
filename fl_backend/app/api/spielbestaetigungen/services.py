import hashlib
from collections.abc import Mapping, Sequence
from typing import Any, Final, cast

from app.api.bewerbungen.services import days_after, seat_named
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungGrund, FLSpielbestaetigungSeite
from app.api.spiele.schemas import SONDEREREIGNIS_WITHOUT_A_RESULT
from app.api.teams.schemas import KONTAKT_ROLLEN, FLKontaktRolle
from app.api.teams.services import has_taken_place
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.shared.schemas.bounds import (
    SPIEL_ANFRAGE_VORLAUF_TAGE,
    SPIEL_BESTAETIGUNG_FRIST_TAGE,
    SPIEL_ERINNERUNG_TAGE_ERSTE,
    SPIEL_ERINNERUNG_TAGE_ZWEITE,
)

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


# --- The pass: what its mint and its reminder write.


def compose_seat_entry(*, token_hash: str) -> dict[str, Any]:
    """One seat's entry as every mint writes it, on a fresh row and on a seat minted afresh on an open one.

    No delivery state: no report has yet named the message this link goes out in.
    """

    return {"token_hashes": [token_hash], "zustellung": None}


def frist_of(*, datum: str, today: str) -> str:
    """The deadline a row minted today is given: a fixture already inside the notice period is due today."""

    return max(today, days_after(day=datum, days=-SPIEL_BESTAETIGUNG_FRIST_TAGE))


def letzter_anfrage_tag(*, today: str) -> str:
    """The latest fixture day a pass run today asks about: the request goes out once its deadline is the answer window away."""

    return days_after(day=today, days=SPIEL_BESTAETIGUNG_FRIST_TAGE + SPIEL_ANFRAGE_VORLAUF_TAGE)


def build_anfrage_filter(*, saison_id: str, today: str) -> dict[str, Any]:
    """The season's fixtures the mint may ask about; `anfrage_is_due` decides, this narrows the read."""

    return {
        "saison_id": saison_id,
        "datum": {"$gt": today, "$lte": letzter_anfrage_tag(today=today)},
        "uhrzeit": {"$ne": None},
        "ort": {"$ne": None},
        "team1": {"$ne": None},
        "team2": {"$ne": None},
        "ergebnis": None,
        "sonderereignis": None,
    }


def _side_id(spiel: Mapping[str, Any], side: str) -> Any:
    block = spiel.get(side)

    return block.get("team_id") if isinstance(block, Mapping) else None


def _referee_id(spiel: Mapping[str, Any]) -> Any:
    block = spiel.get("schiedsrichter")

    return block.get("schiedsrichter_id") if isinstance(block, Mapping) else None


def grund_to_close(*, row: Mapping[str, Any], spiel: Mapping[str, Any], austritte: Mapping[Any, str]) -> FLSpielbestaetigungGrund | None:
    """Why this unclosed row stops applying to its fixture as it stands, or `None`; `austritte` maps clubs to exit days.

    The mint asks it of every row it would write, so the close shuts nothing the mint asked.
    """

    # A decision or a call-off first: neither leaves a new Ansetzung to announce.
    if has_taken_place(spiel):
        return "spiel_entschieden"

    if spiel.get("sonderereignis") in SONDEREREIGNIS_WITHOUT_A_RESULT:
        return "abgesagt"

    ansetzung = row["ansetzung"]
    # The fixture's day as it stands, or the one the row was about where the fixture lost its date.
    tag = spiel.get("datum") or ansetzung["datum"]
    if any(team_id in austritte and austritte[team_id] <= tag for team_id in (ansetzung["team1_id"], ansetzung["team2_id"])):
        return "austritt"

    partei = row["partei"]
    # Ahead of the move: a referee taken off the fixture is owed no notice that it moved.
    if partei["art"] == "schiedsrichter" and _referee_id(spiel) != partei.get("schiedsrichter_id"):
        return "schiedsrichter_gewechselt"

    if ansetzung_stand_of(spiel) != ansetzung["stand"]:
        return "ansetzung_geaendert"

    return None


def anfrage_is_due(*, spiel: Mapping[str, Any], austritte: Mapping[Any, str], today: str) -> bool:
    """Whether the mint asks about this fixture today: dated strictly after today, inside the answer window, fully set, undecided.

    The floor is a date because `has_taken_place` reads a record, so an unplayed fixture of the past reads as open.
    """

    datum = spiel.get("datum")
    asked = (
        isinstance(datum, str)
        and today < datum <= letzter_anfrage_tag(today=today)
        and spiel.get("uhrzeit") is not None
        and isinstance(spiel.get("ort"), Mapping)
        and _side_id(spiel, "team1") is not None
        and _side_id(spiel, "team2") is not None
        and spiel.get("ergebnis") is None
        and spiel.get("sonderereignis") is None
    )

    # Never a row the close would shut: a club gone by the fixture's day, or a lone goal count or
    # shoot-out, would otherwise be minted, closed and minted again, a fresh request every pass.
    return (
        asked
        and grund_to_close(row={"partei": {"art": "team"}, "ansetzung": compose_ansetzung(spiel)}, spiel=spiel, austritte=austritte) is None
    )


def parteien_of(spiel: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Every party a fixture's Ansetzung asks: both sides, and its referee unless that is the ghost.

    The ghost holds no address, so a row for it would be minted and never mailed nor answered.
    """

    parteien: list[dict[str, Any]] = [{"art": "team", "team_id": _side_id(spiel, side)} for side in ("team1", "team2")]
    schiedsrichter_id = _referee_id(spiel)
    if schiedsrichter_id is not None and schiedsrichter_id != GHOST_SCHIEDSRICHTER_ID:
        parteien.append({"art": "schiedsrichter", "schiedsrichter_id": schiedsrichter_id})

    return parteien


def partei_key(partei: Mapping[str, Any]) -> tuple[str, Any]:
    """One party as the unique index tells parties apart."""

    return partei["art"], partei.get("team_id") if partei["art"] == "team" else partei.get("schiedsrichter_id")


def seite_of(*, spiel: Mapping[str, Any], team_id: Any) -> FLSpielbestaetigungSeite:
    """Which side of the fixture a team row's club plays."""

    return "team1" if _side_id(spiel, "team1") == team_id else "team2"


def compose_spielbestaetigung(
    *,
    row_id: Any,
    saison_id: str,
    spiel: Mapping[str, Any],
    partei: Mapping[str, Any],
    hashes: Mapping[str, str],
    today: str,
) -> dict[str, Any]:
    """A row as the mint writes it, about the fixture's Ansetzung as it stands. A seat `hashes` leaves out holds no link."""

    return {
        "_id": row_id,
        "saison_id": saison_id,
        "spiel_id": spiel["_id"],
        "partei": dict(partei),
        "ansetzung": compose_ansetzung(spiel),
        "frist": frist_of(datum=spiel["datum"], today=today),
        "angefragt_am": None,
        "erinnert_am": [],
        # A referee answers signed in rather than by a link.
        "kontakte": (
            None
            if partei["art"] == "schiedsrichter"
            else {seat: compose_seat_entry(token_hash=hashes[seat]) if seat in hashes else None for seat in KONTAKT_ROLLEN}
        ),
        "antwort": None,
        "geschlossen": None,
    }


def seat_adresse(*, kontakte: Any, seat: str) -> str | None:
    """The address a seat's holder is reached at, or `None` where the seat is empty."""

    slot = kontakte.get(seat) if isinstance(kontakte, Mapping) else None
    email = str(slot.get("email") or "").strip() if isinstance(slot, Mapping) else ""

    return email or None


def link_groups(*, kontakte: Any, seats: Sequence[str]) -> list[list[FLKontaktRolle]]:
    """The seats as links: one per seat, a mirrored Trainer sharing the link of the seat it holds too where both are among `seats`.

    Two seats one press answers are one thing to do (`fl_frontend/src/features/bewerbungen/notifications.ts :: seatsByMailbox`).
    """

    zugleich = kontakte.get("trainer_ist_zugleich") if isinstance(kontakte, Mapping) else None
    groups: dict[str, list[FLKontaktRolle]] = {}
    for seat in seats:
        anchor = str(zugleich) if seat == "trainer" and zugleich in seats else seat
        groups.setdefault(anchor, []).append(cast(FLKontaktRolle, seat))

    return list(groups.values())


def erinnerung_tage(*, today: str) -> list[str]:
    """The deadlines a row is reminded of today, each reminder falling its count of days before the deadline."""

    return [days_after(day=today, days=tage) for tage in (SPIEL_ERINNERUNG_TAGE_ERSTE, SPIEL_ERINNERUNG_TAGE_ZWEITE)]


def build_erinnerung_filter(*, saison_id: str, today: str) -> dict[str, Any]:
    """The season's open team rows a reminder falls due on today and none has gone out for."""

    return {
        "saison_id": saison_id,
        "partei.art": "team",
        **build_answerable_filter(),
        "frist": {"$in": erinnerung_tage(today=today)},
        "erinnert_am": {"$ne": today},
    }


def compose_erinnerung_update(*, hashes: Mapping[str, str], today: str) -> dict[str, Any]:
    """The reminder's one update: each seat's fresh hash appended beside the ones already mailed, and the day.

    Appended, never replacing: every link a seat was mailed answers until the deadline.
    """

    pushed: dict[str, Any] = {
        f"kontakte.{seat}.token_hashes": {"$each": [token_hash], "$slice": -TOKEN_HASHES_PER_SEAT} for seat, token_hash in hashes.items()
    }

    return {"$push": {**pushed, "erinnert_am": today}}


def compose_seats_update(*, hashes: Mapping[str, str]) -> dict[str, Any]:
    """Each seat minted afresh on an open row: a seat a write voided, a seat newly occupied, a seat a ban kept until its lift."""

    return {"$set": {f"kontakte.{seat}": compose_seat_entry(token_hash=token_hash) for seat, token_hash in hashes.items()}}


def compose_closing_update(*, grund: FLSpielbestaetigungGrund, today: str) -> dict[str, Any]:
    return {"$set": {"geschlossen": {"am": today, "grund": grund}}}
