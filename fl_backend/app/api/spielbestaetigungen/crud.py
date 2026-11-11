from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any, Final

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.outbox.services import enqueue_mails
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigung
from app.api.spielbestaetigungen.services import (
    ANSETZUNG_QUELLEN,
    AnsetzungState,
    austritt_notices_of,
    build_austritt_spiele_filter,
    build_holding_filter,
    build_season_reasons_filter,
)
from app.api.spiele.services import build_named_spiele_pipeline
from app.core.crud import (
    aggregate_many_from_db,
    anchor_in_db,
    patch_many_in_db,
    pull_many_from_db,
    pull_whole_from_db,
)
from app.core.readonly import ReadCollection
from app.core.recording import ACT_BY_SYSTEM, record_act

# --- The fixture a row is judged against.

# What the pass and a party's pages read off a fixture through the name join: its id, the Ansetzung's inputs, what a
# page or a mail states of it, what `reason_to_close` decides on, and the booked referee's id, which it compares a
# referee's row against. Never the rent or the note.
JUDGED_SPIEL_FIELDS: Mapping[str, int] = {
    "_id": 1,
    **dict.fromkeys(ANSETZUNG_QUELLEN.values(), 1),
    **dict.fromkeys(("team1.name", "team2.name", "team1.tore", "team2.tore", "spielort.name", "spielort.maps_link"), 1),
    **dict.fromkeys(("ergebnis", "sonderereignis", "schiedsrichter.schiedsrichter_id"), 1),
}


async def pull_named_spiele(
    *,
    spiele_collection: ReadCollection,
    db_filter: Mapping[str, Any],
    projection: Mapping[str, Any],
    sort_by: Sequence[tuple[str, int]] | None = None,
    limit: int | None = None,
    session: AsyncClientSession | None = None,
) -> list[Mapping[str, Any]]:
    """The fixtures `db_filter` selects through the name join, `projection` of each.

    The stored fixture holds no name, so a reader naming a side or the ground reads it here and never by `find`.
    """

    return await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=build_named_spiele_pipeline(db_filter, projection=projection, sort_by=sort_by, limit=limit),
        session=session,
    )


# What a row's state judges of the clubs' season rows its Ansetzung names: each club's exit, and no seat holder at all.
# Every read judging a state projects it, so a field a judge comes to read is added once.
JUDGED_VEREIN_FIELDS: Final[Mapping[str, int]] = {"_id": 0, "team_id": 1, "austritt.date": 1}

# The clubs' season rows as an answer reads them: what the close judges, and the name the act records.
VEREIN_FIELDS: Final[Mapping[str, int]] = {**JUDGED_VEREIN_FIELDS, "name": 1}


async def pull_ansetzung_state(
    *,
    spiele_collection: ReadCollection,
    saison_teams_collection: ReadCollection,
    spielbestaetigung_raw: Mapping[str, Any],
    # `None` for the stored fixture whole, which a judgement validates as `FLSpiel` and which names nothing; a
    # projection reads it through the name join.
    spiel_projection: Mapping[str, Any] | None,
    verein_projection: Mapping[str, Any],
    session: AsyncClientSession | None = None,
) -> AnsetzungState | None:
    """`None` where the fixture is gone: an undraw or a replace removes it with its rows, so a row read outside a transaction can outlive it."""

    by_id = {"_id": spielbestaetigung_raw["spiel_id"]}
    if spiel_projection is None:
        spiel = await spiele_collection.find_one(by_id, session=session)
    else:
        named = await pull_named_spiele(spiele_collection=spiele_collection, db_filter=by_id, projection=spiel_projection, session=session)
        spiel = named[0] if named else None
    if spiel is None:
        return None

    snapshot = spielbestaetigung_raw["ansetzung"]
    vereine = await saison_teams_collection.find(
        {"saison_id": spielbestaetigung_raw["saison_id"], "team_id": {"$in": [snapshot["team1_id"], snapshot["team2_id"]]}},
        verein_projection,
        session=session,
    ).to_list(length=None)

    return AnsetzungState(spiel=spiel, vereine=vereine)


# --- The ADMINISTRATOR's read.

# What the list serves of a row, read off the model it is served as: an allow-list, so a block a row still carries and
# no administrator reads, an old seat's address among them, never leaves the database.
ADMIN_ROW_FIELDS: Final[list[str]] = [
    field.validation_alias if isinstance(field.validation_alias, str) else name for name, field in FLSpielbestaetigung.model_fields.items()
]


async def pull_admin_rows(
    *, spielbestaetigungen_collection: ReadCollection, db_filter: Mapping[str, Any], limit: int
) -> tuple[list[Mapping[str, Any]], bool]:
    """Every row still holding its question, whole, and the newest `limit` of the rest; and whether none was left out.

    A cut across all rows would drop the oldest open ones, the overdue, first.
    """

    holding = await spielbestaetigungen_collection.find({**db_filter, **build_holding_filter()}, ADMIN_ROW_FIELDS).to_list(length=None)
    # Read after the holding rows, so a row closing between the two reads arrives twice rather than not at all, and
    # its closed image wins below.
    rest = await pull_many_from_db(
        collection=spielbestaetigungen_collection,
        db_filter={**db_filter, "$nor": [build_holding_filter()]},
        # One row over what is served, and the extra never is: it answers whether the list is whole without a count.
        limit=limit + 1,
        # Rows carry no creation stamp; an ObjectId's leading bytes are its insert time.
        sort_by=[("_id", -1)],
        projection=ADMIN_ROW_FIELDS,
    )
    rows = {row["_id"]: row for row in [*holding, *rest[:limit]]}

    return sorted(rows.values(), key=lambda row: row["_id"], reverse=True), len(rest) <= limit


# --- A REFEREE'S OWN ROWS.

# What a referee's answer and their own list read of a row (`app/api/schiedsrichter/services.py ::
# build_self_spiele_pipeline`): no deadline, a referee answering signed in until the fixture's kick-off.
OWN_ROW_FIELDS: Mapping[str, int] = {
    "saison_id": 1,
    "spiel_id": 1,
    "party": 1,
    "ansetzung": 1,
    "answer.kind": 1,
    "answer.by.kind": 1,
    "answer.reason": 1,
    "closed": 1,
}


# --- The season's end: what its parties' answers leave on its fixtures.


async def strip_the_seasons_confirmations(
    *,
    spielbestaetigungen_collection: AsyncCollection,
    saison_id: str,
    # REQUIRED: the season's end judged in the same snapshot, so an activation since the caller's read keeps the rows.
    session: AsyncClientSession,
) -> int:
    """At the season's end, every reason left on the season's rows, answering how many rows that took.

    A replaced club's rows, a referee's and an administrator's reason among them; each answer's way and role stay as the
    record.
    """

    reasons = await patch_many_in_db(
        collection=spielbestaetigungen_collection,
        db_filter=build_season_reasons_filter(saison_id),
        update={"$set": {"answer.reason": None}},
        session=session,
    )

    stripped = reasons.modified_count
    if stripped:
        await record_act(
            collection=spielbestaetigungen_collection,
            action="retention.spielbestaetigungen",
            by=ACT_BY_SYSTEM,
            label=saison_id,
            count=stripped,
            session=session,
        )

    return stripped


# --- What a write owing mails read their recipients off.


async def anchor_the_mailboxes_told(
    *,
    saison_teams_collection: AsyncCollection,
    saison_team_ids: Sequence[Any],
    # REQUIRED: committed on its own, the anchor conflicts with no seat write.
    session: AsyncClientSession,
) -> None:
    """Write the season rows a write read its mails' mailboxes off: a request's, a reminder's or a notice's.

    An erasure or a Widerspruch empties the seat on that row and writes nothing the mails' write writes.
    """

    await anchor_in_db(collection=saison_teams_collection, db_filter={"_id": {"$in": list(saison_team_ids)}}, session=session)


async def anchor_the_referees_told(
    *,
    schiedsrichter_collection: AsyncCollection,
    schiedsrichter_ids: Sequence[Any],
    # REQUIRED: committed on its own, the anchor conflicts with no erasure.
    session: AsyncClientSession,
) -> None:
    """Write the referees a step tells: the mint's and the reminder's, the notice step's.

    A referee's erasure deletes only the rows its snapshot holds, never the mint's insert beside it, so this write conflicts.
    """

    await anchor_in_db(collection=schiedsrichter_collection, db_filter={"_id": {"$in": list(schiedsrichter_ids)}}, session=session)


# --- An AUSTRITT's opponents.

# What `austritt_notices_of` judges and lists of a fixture, which holds no name: each club's comes off its season row.
AUSTRITT_SPIEL_FIELDS: Final = ["team1", "team2", "date", "time", "ergebnis", "sonderereignis"]


async def owe_the_austritt_notices_in_session(
    *,
    spiele_collection: ReadCollection,
    saison_teams_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    saison_id: str,
    team_id: Any,
    exit_day: str,
    now: datetime,
    # REQUIRED: the exit and its notices commit or fail together.
    session: AsyncClientSession,
) -> None:
    """Owe each opponent of a club leaving the season its notice, at the exit's own write, which happens once."""

    spiele = await pull_whole_from_db(
        collection=spiele_collection,
        db_filter=build_austritt_spiele_filter(saison_id=saison_id, team_id=team_id, exit_day=exit_day),
        what=f"team {team_id}'s fixtures in season {saison_id}",
        projection=AUSTRITT_SPIEL_FIELDS,
        session=session,
    )
    sides = {(spiel.get(side) or {}).get("team_id") for spiel in spiele for side in ("team1", "team2")}
    vereine = await pull_whole_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_id, "team_id": {"$in": list({team_id, *sides} - {None})}},
        what=f"team {team_id}'s opponents in season {saison_id}",
        projection=["team_id", "name", "kontakte", "austritt"],
        session=session,
    )

    notices = austritt_notices_of(saison_id=saison_id, team_id=team_id, spiele=spiele, vereine={row["team_id"]: row for row in vereine})
    if not notices:
        return

    # Ahead of the mails: what each was read off, so a seat emptied or an address moved beside this write conflicts with it.
    await anchor_the_mailboxes_told(saison_teams_collection=saison_teams_collection, saison_team_ids=sorted(notices, key=str), session=session)
    await enqueue_mails(
        outbox_collection=outbox_collection, session=session, mails=[mail for mails in notices.values() for mail in mails], now=now
    )
