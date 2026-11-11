"""
API · where a line-up stands against its fixture's kick-off, and what its screen and its save judge

The one place a line-up's marks are counted from a fixture's `date` and `time`: the line-up's own read and its lock,
the team's reads and the reminder's window all ask here, so no two of them can disagree on an instant.
"""

from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from http import HTTPStatus
from typing import Any, Final

from bson import ObjectId

from app.api.aufstellungen.schemas import FLAufstellungenPublic, FLAufstellungEntry, FLAufstellungMarks, FLAufstellungPhase
from app.api.spielberichte.services import SIDES, team_id_of
from app.api.spieler.services import PUBLIC_PERSON
from app.core import clock
from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import refuse
from app.core.exceptions import WriteRefusal
from app.core.sentinels import GHOST_SPIELER_ID
from app.shared.schemas.bounds import AUFSTELLUNG_DUE_DAYS, AUFSTELLUNG_LOCK_HOURS, AUFSTELLUNG_REMINDER_DAYS, AUFSTELLUNG_STARTERS_MAX
from app.shared.schemas.literals import FLSpielSide

_LOCK_BEFORE: Final = timedelta(hours=AUFSTELLUNG_LOCK_HOURS)


def _at_kickoff_time(date: str, time: str, *, days_back: int) -> datetime:
    """The UTC instant `days_back` days before the fixture's day, at its kick-off's clock time in Berlin.

    Counted back on the naive wall time and converted once, so a mark across a clock change keeps the kick-off's hour:
    the day before a Sunday 16:00 kick-off is Saturday 16:00, on the night summer time ends too.
    """

    wall_day = (datetime.fromisoformat(date) - timedelta(days=days_back)).date().isoformat()

    return clock.german_instant(wall_day, time)


def aufstellung_marks(*, date: str | None, time: str | None, stored: bool, now: datetime) -> FLAufstellungMarks | None:
    """Whether a line-up is stored, the phase the clock puts it in at `now`, and the instants it is due and locks at.

    None for a fixture holding no day or no hour, which owes no line-up and takes none. `open` runs up to the due mark,
    `overdue` from it up to the lock, `locked` from the lock on: each mark belongs to the phase it opens.
    """

    if date is None or time is None:
        return None

    due_at = _at_kickoff_time(date, time, days_back=AUFSTELLUNG_DUE_DAYS)
    # The lock in real hours, counted on the UTC instant, where subtraction is never wall time.
    locks_at = _at_kickoff_time(date, time, days_back=0) - _LOCK_BEFORE
    phase: FLAufstellungPhase = "open" if now < due_at else "overdue" if now < locks_at else "locked"

    return FLAufstellungMarks(stored=stored, phase=phase, due_at=due_at, locks_at=locks_at)


def keeps_erased(*, date: str | None, time: str | None, now: datetime) -> bool:
    """Whether the fixture's line-up keeps an erased pupil's entry at `now`: from the lock, where it is the club's final record.

    Judged against the fixture as it stands, by the erasure, the screen and the save alike: a fixture re-dated ahead of its
    lock again is a line-up the club picks anew, so its next save drops the entry. Never for a fixture holding no day or
    no hour, which nothing says was played.
    """

    marks = aufstellung_marks(date=date, time=time, stored=False, now=now)

    return marks is not None and marks.phase == "locked"


def aufstellung_reminder_owed(*, date: str | None, time: str | None, now: datetime) -> bool:
    """Whether `now` lies in the window a team holding no line-up is owed its one reminder: from its mark up to the due mark.

    Never for a fixture holding no day or no hour, which owes no line-up.
    """

    if date is None or time is None:
        return False

    return (
        _at_kickoff_time(date, time, days_back=AUFSTELLUNG_REMINDER_DAYS) <= now < _at_kickoff_time(date, time, days_back=AUFSTELLUNG_DUE_DAYS)
    )


# --- What a save judges, each refusal writing nothing.


def find_undated_refusal(marks: FLAufstellungMarks | None) -> WriteRefusal | None:
    """`aufstellung_spiel_undated`: a fixture holding no day or no hour owes no line-up and takes none, from anybody."""

    if marks is not None:
        return None

    return WriteRefusal(error_code=Code.AUFSTELLUNG_SPIEL_UNDATED, status=HTTPStatus.CONFLICT)


def find_locked_refusal(marks: FLAufstellungMarks | None) -> WriteRefusal | None:
    """`aufstellung_locked`: from the lock the line-up is the administration's. A seat's alone, and never for being due or overdue."""

    if marks is None or marks.phase != "locked":
        return None

    return WriteRefusal(error_code=Code.AUFSTELLUNG_LOCKED, status=HTTPStatus.CONFLICT)


def judge_the_kickoff(marks: FLAufstellungMarks | None, *, locks: bool) -> None:
    """The fixture's clock, as a save asks it inside its transaction and again outside it: `locks` for a seat's save alone."""

    refuse(find_undated_refusal(marks))
    if locks:
        refuse(find_locked_refusal(marks))


def is_erased(entry: Mapping[str, Any]) -> bool:
    """Whether a stored entry names a pupil erased from a locked line-up, whom no save names."""

    return entry["spieler_id"] == GHOST_SPIELER_ID


def aufstellung_stands(saved: Mapping[str, Any] | None, *, date: str | None, time: str | None, now: datetime) -> bool:
    """Whether the club's stored line-up stands as one at `now`: it serves an entry, an erased pupil's only where `keeps_erased`.

    What every reader calls stored, the team's marks, the reminder and the public read alike: a line-up is owed for every
    dated fixture, so one naming nobody, or only pupils erased from it ahead of the lock, names none and stays due.
    """

    if saved is None:
        return False

    kept = keeps_erased(date=date, time=time, now=now)

    return any(kept or not is_erased(entry) for entry in saved["spieler"])


def erased_entries(saved: Mapping[str, Any] | None, *, spiel: Mapping[str, Any], now: datetime) -> list[Mapping[str, Any]]:
    """The stored line-up's entries naming an erased pupil that it keeps (`keeps_erased`), in their stored order.

    Several may stand, all naming the sentinel. None where the fixture stands ahead of its lock, so the screen shows none
    and the save writes none.
    """

    if saved is None or not keeps_erased(date=spiel.get("date"), time=spiel.get("time"), now=now):
        return []

    return [entry for entry in saved["spieler"] if is_erased(entry)]


def newly_named(entries: Sequence[FLAufstellungEntry], saved: Mapping[str, Any] | None) -> set[ObjectId]:
    """The pupils this save names that the stored line-up did not, the only ones judged against the squad.

    So a line-up keeps a pupil ausgetragen since it named them. The sentinel is never stored as named, so a save naming
    it names a pupil outside the squad.
    """

    stored = set() if saved is None else {entry["spieler_id"] for entry in saved["spieler"] if not is_erased(entry)}

    return {entry.spieler_id for entry in entries} - stored


def find_not_in_kader_refusal(
    *, entries: Sequence[FLAufstellungEntry], new: set[ObjectId], kader: Sequence[Mapping[str, Any]]
) -> WriteRefusal | None:
    """`spieler_not_in_kader`: a pupil newly named is in the club's live squad of the season.

    On each entry it refuses, by its path into the payload's `spieler`, so the screen marks the row it names rather
    than reloading over the club's other picks.
    """

    live = {row["spieler_id"] for row in kader if row["inactive_since"] is None}
    outside = tuple(("spieler", index, "spieler_id") for index, entry in enumerate(entries) if entry.spieler_id in new - live)
    if not outside:
        return None

    return WriteRefusal(error_code=Code.SPIELER_NOT_IN_KADER, status=HTTPStatus.CONFLICT, fields=outside)


def find_nominee_refusal(*, entries: Sequence[FLAufstellungEntry], kader: Sequence[Mapping[str, Any]]) -> WriteRefusal | None:
    """`aufstellung_nominee_without_shortage`: a line-up names nominees only into the gap its regular players leave below eleven.

    A pupil holding no squad row of the club, an erased one among them, counts as a regular player: only a row says
    who was nominated late.
    """

    nominees = {row["spieler_id"] for row in kader if row["is_nachnominiert"]}
    named_nominees = sum(entry.spieler_id in nominees for entry in entries)
    regular = len(entries) - named_nominees
    if named_nominees <= max(0, AUFSTELLUNG_STARTERS_MAX - regular):
        return None

    # The bound on the list, so the screen words the eleven from the server rather than a copied figure.
    return WriteRefusal(
        error_code=Code.AUFSTELLUNG_NOMINEE_WITHOUT_SHORTAGE,
        status=HTTPStatus.CONFLICT,
        fields=(("spieler",),),
        bounds={"max": AUFSTELLUNG_STARTERS_MAX},
    )


def find_starters_refusal(entries: Sequence[FLAufstellungEntry]) -> WriteRefusal | None:
    """`aufstellung_starters_exceed_eleven`: the line-up as written, its erased pupils' kept entries included, starts eleven at most.

    The payload's own rule (`starters_exceed_eleven`) sees the entries it sends alone.
    """

    if sum(entry.starts for entry in entries) <= AUFSTELLUNG_STARTERS_MAX:
        return None

    return WriteRefusal(
        error_code=Code.AUFSTELLUNG_STARTERS_EXCEED_ELEVEN,
        status=HTTPStatus.CONFLICT,
        fields=(("spieler",),),
        bounds={"max": AUFSTELLUNG_STARTERS_MAX},
    )


def judge_the_names(
    *, entries: Sequence[FLAufstellungEntry], kept: Sequence[FLAufstellungEntry], new: set[ObjectId], kader: Sequence[Mapping[str, Any]]
) -> None:
    """Whom the line-up names, against the club's squad, as a save asks it inside its transaction and again outside it.

    `entries` are the payload's, and `kept` the stored entries naming an erased pupil, which the save writes after them.
    """

    refuse(find_not_in_kader_refusal(entries=entries, new=new, kader=kader))
    refuse(find_starters_refusal([*entries, *kept]))
    refuse(find_nominee_refusal(entries=[*entries, *kept], kader=kader))


# --- The squad a line-up picks from.

_NUMMER_ORDER = "nummer_order"
_UNNUMBERED = "unnumbered"


def build_aufstellung_kader_pipeline(*, saison_id: str, team_id: ObjectId) -> list[Mapping[str, Any]]:
    """Every squad row of one club in one season, live and ausgetragen alike, with its pupil's two names, in shirt-number order.

    The line-up's own rather than the report's (`app/api/spielberichte/services.py :: build_bericht_kader_pipeline`):
    its screen shows each row's position and captaincy, judges its nominees, and lists the squad by number.
    """

    return [
        {"$match": {"saison_id": saison_id, "team_id": team_id}},
        {
            "$lookup": {
                "from": Collection.SPIELER,
                "localField": "spieler_id",
                "foreignField": "_id",
                # An allow-list inside the join: the person row holds an address.
                "pipeline": [{"$project": {"_id": 0, "first_name": 1, "last_name": 1}}],
                "as": "person",
            }
        },
        # Strict, as the squad's own read is: the erasure removes a person's squad rows before the person.
        {"$unwind": "$person"},
        {
            "$project": {
                "_id": 0,
                "spieler_id": 1,
                "first_name": "$person.first_name",
                "last_name": "$person.last_name",
                "nummer": 1,
                "position": 1,
                "rolle": 1,
                "is_nachnominiert": 1,
                "inactive_since": 1,
                # The number as the shirt reads it, so `7` comes before `10`; null for a row holding none.
                _NUMMER_ORDER: {"$convert": {"input": "$nummer", "to": "int", "onError": None, "onNull": None}},
            }
        },
        # A null sorts ahead of every number, so the rows holding none are put after the numbered ones.
        {"$set": {_UNNUMBERED: {"$eq": [f"${_NUMMER_ORDER}", None]}}},
        {"$sort": {_UNNUMBERED: 1, _NUMMER_ORDER: 1, "last_name": 1, "first_name": 1, "spieler_id": 1}},
        {"$unset": [_NUMMER_ORDER, _UNNUMBERED]},
    ]


# --- The PUBLIC read: each side's line-up on the match page, every pupil through the base tier's mask.

PUBLIC_AUFSTELLUNGEN_AS = "aufstellungen_rows"


def public_aufstellungen_lookup() -> Mapping[str, Any]:
    """The line-ups of the clubs a fixture fields now, joined onto the fixture as `build_spiele_pipeline` answers it.

    Picked by the club and never by a side: a club a knockout correction replaced keeps its line-up, which no side then
    joins. Each holds its pupils projected through `PUBLIC_PERSON` at the join, so no consent record and no withheld
    name leaves the database, and their squad rows of the line-up's own club and season for the number, the position
    and the captaincy.
    """

    return {
        "$lookup": {
            "from": Collection.AUFSTELLUNGEN,
            "localField": "_id",
            "foreignField": "spiel_id",
            # Each side's club as the fixture's own join left it, null on an open knockout slot, which no line-up names.
            "let": {"fielded": ["$team1.team_id", "$team2.team_id"]},
            "pipeline": [
                {"$match": {"$expr": {"$in": ["$team_id", "$$fielded"]}}},
                {
                    "$lookup": {
                        "from": Collection.SPIELER,
                        "localField": "spieler.spieler_id",
                        "foreignField": "_id",
                        "pipeline": [{"$project": {"_id": 1, **PUBLIC_PERSON}}],
                        "as": "persons",
                    }
                },
                {
                    "$lookup": {
                        "from": Collection.SAISON_SPIELER,
                        "localField": "spieler.spieler_id",
                        "foreignField": "spieler_id",
                        "let": {"saison_id": "$saison_id", "team_id": "$team_id"},
                        "pipeline": [
                            {"$match": {"$expr": {"$and": [{"$eq": ["$saison_id", "$$saison_id"]}, {"$eq": ["$team_id", "$$team_id"]}]}}},
                            {"$project": {"_id": 0, "spieler_id": 1, "nummer": 1, "position": 1, "rolle": 1}},
                        ],
                        "as": "squad_rows",
                    }
                },
                {"$project": {"_id": 0, "team_id": 1, "spieler": 1, "persons": 1, "squad_rows": 1}},
            ],
            "as": PUBLIC_AUFSTELLUNGEN_AS,
        }
    }


def compose_public_aufstellungen(spiel_raw: Mapping[str, Any], *, now: datetime) -> FLAufstellungenPublic:
    """Each side's line-up from `public_aufstellungen_lookup`'s rows, in the order the club entered it; null where none stands.

    An erased pupil's entries only where the line-up keeps them (`keeps_erased`), as its screen shows them: a fixture
    re-dated ahead of its lock still stores them until its club's next save, which drops them. A line-up serving no entry
    stands as none (`aufstellung_stands`).
    """

    by_club = {row["team_id"]: row for row in spiel_raw[PUBLIC_AUFSTELLUNGEN_AS]}
    date, time = spiel_raw.get("date"), spiel_raw.get("time")
    kept = keeps_erased(date=date, time=time, now=now)

    def side_of(side: FLSpielSide) -> dict[str, Any] | None:
        row = by_club.get(team_id_of(spiel_raw, side))
        if row is None or not aufstellung_stands(row, date=date, time=time, now=now):
            return None

        persons = {person["_id"]: person for person in row["persons"]}
        squad_rows = {squad_row["spieler_id"]: squad_row for squad_row in row["squad_rows"]}

        def entry(stored: Mapping[str, Any]) -> dict[str, Any]:
            person = persons.get(stored["spieler_id"], {})
            squad_row = squad_rows.get(stored["spieler_id"], {})
            # A null forename is the mask's answer for a withheld name and the sentinel's for an erased pupil alike.
            named = person.get("first_name") is not None
            return {
                "type": "named" if named else "anonymous",
                "first_name": person.get("first_name") if named else None,
                "last_name": person.get("last_name") if named else None,
                "nummer": squad_row.get("nummer"),
                "position": squad_row.get("position"),
                # Beside a name alone: beside a withheld one the captaincy would say who the nameless pupil is.
                "rolle": squad_row.get("rolle") if named else None,
                "starts": stored["starts"],
            }

        return {"spieler": [entry(stored) for stored in row["spieler"] if kept or not is_erased(stored)]}

    return FLAufstellungenPublic.model_validate({side: side_of(side) for side in SIDES})
