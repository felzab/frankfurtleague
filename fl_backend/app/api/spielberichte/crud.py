from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.spielberichte.schemas import (
    FLSpielberichtBerichtPayload,
    FLSpielberichtSpieler,
)
from app.api.spielberichte.services import (
    SIDES,
    SPIEL_FIELDS,
    BerichtContext,
    bericht_unchanged,
    build_bericht_kader_pipeline,
    build_season_report_texts_filter,
    build_submitted_pipeline,
    compose_bericht_update,
    compose_new_bericht,
    live_kader,
    named_ids_of,
    sides_of,
    team_id_of,
)
from app.api.spiele.services import build_named_spiele_pipeline
from app.core.crud import (
    GERMAN_COLLATION,
    VERSION_FIELD,
    aggregate_many_from_db,
    anchor_in_db,
    patch_many_in_db,
    patch_one_in_db,
    post_one_to_db,
    pull_many_from_db,
    pull_one_from_db,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.readonly import ReadCollection
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.literals import FLSpielSide


async def pull_bericht_context(
    *,
    spiele_collection: ReadCollection,
    saisons_collection: ReadCollection,
    saison_spieler_collection: ReadCollection,
    spiel_id: ObjectId,
    session: AsyncClientSession | None,
) -> BerichtContext:
    """The fixture, its season's status and both clubs' squads, under `session`.

    `document_not_found` for a fixture that does not exist.
    """

    # Through the name join, which the form's heading reads.
    found = await aggregate_many_from_db(
        collection=spiele_collection, pipeline=build_named_spiele_pipeline({"_id": spiel_id}, projection=SPIEL_FIELDS), session=session
    )
    if not found:
        raise DocumentNotFoundError()
    spiel = found[0]
    team_ids = [team_id for side in SIDES if (team_id := team_id_of(spiel, side)) is not None]
    saison_id = str(spiel["saison_id"])

    kader = await aggregate_many_from_db(
        collection=saison_spieler_collection,
        pipeline=build_bericht_kader_pipeline(saison_id=saison_id, team_ids=team_ids),
        collation=GERMAN_COLLATION,
        session=session,
    )

    saison = await saisons_collection.find_one({"_id": saison_id}, projection={"_id": 0, "status": 1}, session=session)
    # A fixture's season row stands for as long as the fixture does.
    assert saison is not None

    return BerichtContext(spiel=spiel, kader=kader, saison_status=saison["status"])


async def pull_named(
    *,
    spieler_collection: ReadCollection,
    context: BerichtContext,
    kader_open: bool,
    bericht: Mapping[str, Any] | None,
    session: AsyncClientSession | None,
) -> list[FLSpielberichtSpieler]:
    """Every pupil the block names outside the squads served, so a stored entry keeps its name; every one where none is served.

    An entry naming nobody, a scorer the referee did not name or a pupil erased since, names no id and asks for none.
    """

    live = {row["spieler_id"] for side in SIDES for row in live_kader(context, side)} if kader_open else set()
    outside = set().union(*named_ids_of(bericht).values()) - live
    rows = {row["spieler_id"]: row for row in context.kader if row["spieler_id"] in outside}
    # A pupil of neither side's club, such as one of a club a knockout slot has since replaced: read off their record.
    rest = outside - rows.keys()
    people = (
        []
        if not rest
        else await pull_many_from_db(
            collection=spieler_collection, db_filter={"_id": {"$in": sorted(rest)}}, projection=["first_name", "last_name"], session=session
        )
    )

    named = {person["_id"]: person for person in people}

    return [
        *(FLSpielberichtSpieler.model_validate(row) for row in rows.values()),
        *(
            FLSpielberichtSpieler(
                spieler_id=spieler_id,
                first_name=named.get(spieler_id, {}).get("first_name"),
                last_name=named.get(spieler_id, {}).get("last_name"),
                nummer=None,
            )
            for spieler_id in sorted(rest)
        ),
    ]


async def anchor_the_pupils_named(*, spieler_collection: AsyncCollection, spieler_ids: Iterable[ObjectId], session: AsyncClientSession) -> None:
    """One anchor over every pupil a write newly names, so an erasure of one of them conflicts with it."""

    ids = sorted(set(spieler_ids))
    if not ids:
        return

    await anchor_in_db(collection=spieler_collection, db_filter={"_id": {"$in": ids}}, session=session)


async def anchor_the_season_reported_in(*, saisons_collection: AsyncCollection, saison_id: str, session: AsyncClientSession) -> None:
    """The season every report write, a draw's removal and the activation ending the season all write, so they conflict."""

    await anchor_in_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)


async def write_bericht(
    *,
    spielberichte_collection: AsyncCollection,
    spiel_raw: Mapping[str, Any],
    saved: Mapping[str, Any] | None,
    payload: FLSpielberichtBerichtPayload,
    now: datetime,
    # REQUIRED with no default: the `version` the form was served, null where it showed no report, which the caller
    # has judged against `saved` (`app/core/crud.py :: find_stale_first_save_refusal`).
    version: int | None,
    session: AsyncClientSession,
) -> Mapping[str, Any]:
    """The block written whole: created by its first save, or replaced.

    A block already saying what the payload says is left as stored; otherwise answers the document as written.
    """

    # Off the fixture this write judged: a correction landing mid-write leaves the clubs before it stamped, and the
    # report reads `sides_changed`, never adoptable.
    sides = sides_of(spiel_raw)

    if saved is None:
        # A first save committing while this one runs conflicts with it on `uniq_spielbericht_spiel_id`, and the
        # retry reads that save's document, which a null `version` no longer matches.
        await post_one_to_db(
            collection=spielberichte_collection,
            document={
                "saison_id": spiel_raw["saison_id"],
                "spiel_id": spiel_raw["_id"],
                "bericht": compose_new_bericht(payload, sides=sides, now=now),
            },
            session=session,
        )
        return await pull_one_from_db(collection=spielberichte_collection, db_filter={"spiel_id": spiel_raw["_id"]}, session=session)

    if bericht_unchanged(payload, saved["bericht"], sides):
        return saved

    # `AFTER`: the view answers the document as written.
    return await patch_one_in_db(
        collection=spielberichte_collection,
        db_filter={"_id": saved["_id"]},
        update=compose_bericht_update(payload, sides=sides),
        expected_version=version,
        session=session,
        return_document=ReturnDocument.AFTER,
    )


async def count_submitted_berichte(*, spielberichte_collection: ReadCollection, saison_id: str, session: AsyncClientSession | None) -> int:
    """How many of the season's fixtures hold a submitted report, under `session`, joined as the reads join so the two agree."""

    counted = await aggregate_many_from_db(
        collection=spielberichte_collection,
        pipeline=[*build_submitted_pipeline(saison_id=saison_id, spiel_fields={"_id": 1}), {"$count": "berichte"}],
        session=session,
    )

    return counted[0]["berichte"] if counted else 0


async def strip_the_seasons_reports(
    *,
    spielberichte_collection: AsyncCollection,
    saison_id: str,
    # REQUIRED: the following season's end judged in the same snapshot, so an activation since the caller's read keeps them.
    session: AsyncClientSession,
) -> int:
    """Once the season after `saison_id` has ended, every report's remarks, answering how many reports it stripped."""

    stripped = await patch_many_in_db(
        collection=spielberichte_collection,
        db_filter=build_season_report_texts_filter(saison_id),
        update={"$set": {"bericht.remarks": None}},
        session=session,
    )
    if stripped.modified_count:
        await record_act(
            collection=spielberichte_collection,
            action="retention.spielberichte",
            by=ACT_BY_SYSTEM,
            label=saison_id,
            count=stripped.modified_count,
            session=session,
        )

    return stripped.modified_count


async def stamp_the_adoption(
    *,
    spielberichte_collection: AsyncCollection,
    spiel_id: CustomObjectId,
    # The report document's `version` the editor read, which names the content its administrator saw.
    version: int,
    # The clubs the save leaves on the fixture: a report written about others credits neither.
    sides: Mapping[FLSpielSide, ObjectId | None],
    # REQUIRED: the fixture save's own, so a save that does not commit takes its stamp back with it.
    session: AsyncClientSession,
) -> None:
    """Stamp the report adopted, matching it only while its document still stands at `version`.

    A fan-out rather than `patch_one_in_db`, whose miss would raise and take the fixture's save with it. The stamp
    raises the document's `version` as every write of it does, so the referee's form read before it saves stale once.
    """

    await patch_many_in_db(
        collection=spielberichte_collection,
        db_filter={"spiel_id": spiel_id, VERSION_FIELD: version, **{f"bericht.sides.{side}": sides[side] for side in SIDES}},
        update={"$set": {"bericht.adopted": True}},
        session=session,
    )


async def empty_pupil_entries_in_session(
    *,
    spielberichte_collection: AsyncCollection,
    spieler_id: CustomObjectId,
    # REQUIRED: the erasure's own, so no report loses a name to an erasure that rolled back.
    session: AsyncClientSession,
) -> None:
    """Make every scorer and card entry naming this pupil name nobody.

    The report stands as the league's record of the match, its adoption with it: this write raises the document's
    `version` and leaves `bericht.adopted` as it stands.
    """

    # One update over both arrays, each through its own `$[<identifier>]` (the manual's
    # "$[<identifier>]" page). The filter selects only the reports holding an entry to change, since
    # an array-filtered update reaches `patch_many_in_db` unnarrowed.
    await patch_many_in_db(
        collection=spielberichte_collection,
        db_filter={"$or": [{"bericht.scorers.spieler_id": spieler_id}, {"bericht.cards.spieler_id": spieler_id}]},
        update={"$set": {"bericht.scorers.$[goal].spieler_id": None, "bericht.cards.$[card].spieler_id": None}},
        array_filters=[{"goal.spieler_id": spieler_id}, {"card.spieler_id": spieler_id}],
        session=session,
    )
