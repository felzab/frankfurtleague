"""
API · a line-up's document written, its entries of an erased pupil emptied, and removed

One document per club per fixture, so no club's save can touch another's, and a seat and an administrator saving one
club's line-up write the same document: a refusal between them is a true conflict.
"""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aufstellungen.schemas import FLAufstellungEntry
from app.api.teams.services import is_played
from app.core.collections import Collection
from app.core.crud import (
    aggregate_many_from_db,
    anchor_in_db,
    delete_many_from_db,
    patch_many_in_db,
    patch_one_in_db,
    post_one_to_db,
    pull_one_from_db,
)
from app.core.recording import record_act
from app.shared.schemas.custom import CustomObjectId


async def write_aufstellung(
    *,
    aufstellungen_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    saison_id: str,
    spiel_id: ObjectId,
    team_id: ObjectId,
    spieler: Sequence[FLAufstellungEntry],
    # The stored line-up as the caller read it in `session`, None where none stands: the caller has judged the payload's
    # `version` against it (`app/core/crud.py :: find_stale_first_save_refusal`).
    saved: Mapping[str, Any] | None,
    # REQUIRED with no default: the `version` the screen was served, null where it showed no line-up.
    version: int | None,
    # Who saves, as `record_act` takes it: `ACT_BY_KONTAKT` beside the club's name at the save for a seat, and both null
    # on an administrator's route, whose request bound them.
    by: str | None,
    team: str | None,
    # How the Protokoll names the fixture (`app/api/spiele/services.py :: spiel_label`).
    label: str,
    # REQUIRED: the save's own transaction, in which its caller judged the fixture, the squad and the lock.
    session: AsyncClientSession,
) -> Mapping[str, Any]:
    """One club's line-up for one fixture written whole and recorded, created by its first save or replaced, answering the document as written.

    Judged on the caller's read in the same transaction, so no second read: a save committing after that read conflicts
    with this write, and the retry reads and judges again. Two first saves at once meet on
    `uniq_aufstellung_spiel_id_team_id` as a write conflict, and the retry of the later one reads the earlier one's
    document.
    """

    key = {"spiel_id": spiel_id, "team_id": team_id}
    entries = [entry.model_dump(context={"keep_oid": True}) for entry in spieler]

    if saved is None:
        await post_one_to_db(collection=aufstellungen_collection, document={"saison_id": saison_id, **key, "spieler": entries}, session=session)
        written = await pull_one_from_db(collection=aufstellungen_collection, db_filter=key, session=session)
    else:
        # `AFTER`: the screen's next save sends the count this write left.
        written = await patch_one_in_db(
            collection=aufstellungen_collection,
            db_filter={"_id": saved["_id"]},
            update={"$set": {"spieler": entries}},
            expected_version=version,
            session=session,
            return_document=ReturnDocument.AFTER,
        )
    # After the line-up's own write, on every save: a draw's removal writes the season, so no line-up is left on a
    # fixture the removal took, and so does the activation ending it, which no save then outlives. The save's judgement
    # of the season's status, asked again outside the transaction, leaves a gap before the commit this closes.
    await anchor_in_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)

    await record_act(
        collection=aufstellungen_collection,
        action="aufstellung.saved",
        by=by,
        team=team,
        record_id=written["_id"],
        label=label,
        session=session,
    )

    return written


_SPIEL_AS = "spiel"


async def erase_pupil_from_aufstellungen_in_session(
    *,
    aufstellungen_collection: AsyncCollection,
    spieler_id: CustomObjectId,
    # The erasing request's clock, which judges each fixture played or still to come.
    now: datetime,
    # REQUIRED: the erasure's own, so no line-up loses a name to an erasure that rolled back.
    session: AsyncClientSession,
) -> None:
    """Empty this pupil's entries on the line-ups of played fixtures and remove their entries from the rest.

    A played match's entry stands naming nobody, as a report's does: the line-up is the record of whom the club
    fielded, and a removed entry would read as a place nobody filled. A match still to come loses the pupil, and its
    club picks again. Judged once, here, by `app/api/teams/services.py :: is_played`.
    """

    naming = await aggregate_many_from_db(
        collection=aufstellungen_collection,
        pipeline=[
            {"$match": {"spieler.spieler_id": spieler_id}},
            {
                "$lookup": {
                    "from": Collection.SPIELE,
                    "localField": "spiel_id",
                    "foreignField": "_id",
                    "pipeline": [{"$project": {"_id": 0, "date": 1, "time": 1}}],
                    "as": _SPIEL_AS,
                }
            },
            {"$project": {"_id": 1, _SPIEL_AS: 1}},
        ],
        session=session,
    )
    # No write for none: most erased pupils are named by no line-up.
    if not naming:
        return

    played = {
        row["_id"] for row in naming if any(is_played(date=spiel.get("date"), time=spiel.get("time"), now=now) for spiel in row[_SPIEL_AS])
    }
    to_come = sorted({row["_id"] for row in naming} - played, key=str)

    if played:
        # Narrowed to the line-ups holding an entry to change, since an array-filtered update reaches
        # `patch_many_in_db` unnarrowed (the manual's "$[<identifier>]" page).
        await patch_many_in_db(
            collection=aufstellungen_collection,
            db_filter={"_id": {"$in": sorted(played, key=str)}, "spieler.spieler_id": spieler_id},
            update={"$set": {"spieler.$[entry].spieler_id": None}},
            array_filters=[{"entry.spieler_id": spieler_id}],
            session=session,
        )
    if to_come:
        await patch_many_in_db(
            collection=aufstellungen_collection,
            db_filter={"_id": {"$in": to_come}},
            update={"$pull": {"spieler": {"spieler_id": spieler_id}}},
            session=session,
        )


async def drop_nameless_entries(
    *,
    aufstellungen_collection: AsyncCollection,
    spiel_id: ObjectId,
    # REQUIRED: the fixture's save, whose re-dating is what puts the match back among those to come.
    session: AsyncClientSession,
) -> None:
    """Remove every entry naming nobody from the fixture's line-ups, once a save has put the played match back among those to come.

    A match to come holds no entry naming nobody, so its clubs pick again.
    """

    # Every line-up of the fixture written, not only those this snapshot finds an entry naming nobody in: a pupil's erasure
    # judging the match played beside this save then conflicts with it, and whichever commits second judges it to come.
    await anchor_in_db(collection=aufstellungen_collection, db_filter={"spiel_id": spiel_id}, session=session)
    # `$type`, never a null equality, which also matches an entry lacking the key.
    await patch_many_in_db(
        collection=aufstellungen_collection,
        db_filter={"spiel_id": spiel_id, "spieler.spieler_id": {"$type": "null"}},
        update={"$pull": {"spieler": {"spieler_id": {"$type": "null"}}}},
        session=session,
    )


async def remove_the_seasons_aufstellungen(
    *,
    aufstellungen_collection: AsyncCollection,
    saison_id: str,
    # One club's alone where it is named: a replaced club's line-ups go with its place in the season.
    team_id: ObjectId | None = None,
    # REQUIRED: the removal is one half of what its caller does in its transaction.
    session: AsyncClientSession,
) -> int:
    """Remove the line-ups a draw's removal or a club's replacement leaves naming fixtures or a club the season no longer holds."""

    db_filter: dict[str, Any] = {"saison_id": saison_id} if team_id is None else {"saison_id": saison_id, "team_id": team_id}

    return (await delete_many_from_db(collection=aufstellungen_collection, db_filter=db_filter, session=session)).deleted_count
