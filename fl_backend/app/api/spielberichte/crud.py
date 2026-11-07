from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.spielberichte.schemas import (
    FLSpielberichtBericht,
    FLSpielberichtBerichtPayload,
    FLSpielberichtBy,
    FLSpielberichtSpieler,
    FLSpielberichtStateEntry,
)
from app.api.spielberichte.services import (
    SIDES,
    SPIEL_FIELDS,
    BerichtContext,
    bericht_state_of,
    bericht_unchanged,
    build_bericht_kader_pipeline,
    build_referee_reports_filter,
    build_season_report_texts_filter,
    build_state_pipeline,
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
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID, GHOST_SPIELER_ID
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.literals import FLSpielSide


async def pull_bericht_context(
    *,
    spiele_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    saison_spieler_collection: AsyncCollection,
    spiel_id: ObjectId,
    session: AsyncClientSession | None,
) -> BerichtContext:
    """The fixture, its season's status and both clubs' squads, under `session`.

    `document_not_found` for a fixture that does not exist.
    """

    # Through the name join, which the form's heading and the panel's sides read.
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

    return BerichtContext(spiel=spiel, kader=kader, saison_status=None if saison is None else saison.get("status"))


async def pull_ended_saison_ids(*, saisons_collection: AsyncCollection, session: AsyncClientSession | None) -> list[str]:
    """Every ended season, by the status `app/api/spielberichte/services.py :: is_concluded` reads, under `session`."""

    saisons = await pull_many_from_db(collection=saisons_collection, db_filter={"status": "past"}, projection=["_id"], session=session)

    return [str(saison["_id"]) for saison in saisons]


async def pull_named(
    *,
    spieler_collection: AsyncCollection,
    context: BerichtContext,
    kader_open: bool,
    bericht: Mapping[str, Any] | None,
    session: AsyncClientSession | None,
) -> list[FLSpielberichtSpieler]:
    """Every pupil the block names outside the squads served, so a stored entry keeps its name; every one where none is served.

    An erased pupil's entries name the sentinel, which comes nameless and reads „anonym“.
    """

    live = {row["spieler_id"] for side in SIDES for row in live_kader(context, side)} if kader_open else set()
    ausserhalb = set().union(*named_ids_of(bericht).values()) - live
    rows = {row["spieler_id"]: row for row in context.kader if row["spieler_id"] in ausserhalb}
    # A pupil of neither side's club, such as one of a club a knockout slot has since replaced: read off their record.
    rest = ausserhalb - rows.keys()
    people = (
        []
        if not rest
        else await pull_many_from_db(
            collection=spieler_collection, db_filter={"_id": {"$in": sorted(rest)}}, projection=["first_name", "last_name"], session=session
        )
    )

    benannt = {person["_id"]: person for person in people}

    return [
        *(FLSpielberichtSpieler.model_validate(row) for row in rows.values()),
        *(
            FLSpielberichtSpieler(
                spieler_id=spieler_id,
                first_name=benannt.get(spieler_id, {}).get("first_name"),
                last_name=benannt.get(spieler_id, {}).get("last_name"),
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
    """The season a report's first write and a draw's removal both write, so the two conflict."""

    await anchor_in_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)


async def write_bericht(
    *,
    spielberichte_collection: AsyncCollection,
    spiel_raw: Mapping[str, Any],
    saved: Mapping[str, Any] | None,
    payload: FLSpielberichtBerichtPayload,
    by: FLSpielberichtBy,
    now: datetime,
    # REQUIRED with no default: the `version` the form was served, or None for a write naming none, so no caller
    # leaves the check out unasked.
    version: int | None,
    session: AsyncClientSession,
) -> Mapping[str, Any]:
    """The block written whole: created by its first writer, set on a document holding none, or replaced.

    A block already saying what the payload says is left as stored; otherwise answers the document as written.
    """

    # Off the fixture this write judged: a correction landing mid-write leaves the clubs before it stamped, and the
    # report reads `sides_changed`, never adoptable.
    sides = sides_of(spiel_raw)
    if saved is not None and bericht_unchanged(payload, saved.get("bericht"), sides):
        return saved

    if saved is None:
        # A first write committing while this one runs conflicts with it, and the retry meets that write's version
        # (`app/api/spielberichte/services.py :: find_bericht_stand_refusal`); `uniq_spielbericht_spiel_id` stands behind both.
        await post_one_to_db(
            collection=spielberichte_collection,
            document={
                "saison_id": spiel_raw["saison_id"],
                "spiel_id": spiel_raw["_id"],
                "bericht": compose_new_bericht(payload, by=by, sides=sides, now=now),
            },
            session=session,
        )
        return await pull_one_from_db(collection=spielberichte_collection, db_filter={"spiel_id": spiel_raw["_id"]}, session=session)

    update = (
        {"$set": {"bericht": compose_new_bericht(payload, by=by, sides=sides, now=now)}}
        if saved.get("bericht") is None
        else compose_bericht_update(payload, sides=sides, now=now)
    )
    # `AFTER`: inside the transaction the patch reads the document back for its log anyway.
    return await patch_one_in_db(
        collection=spielberichte_collection,
        db_filter={"_id": saved["_id"]},
        update=update,
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


async def pull_states(*, spielberichte_collection: ReadCollection, saison_id: str) -> list[FLSpielberichtStateEntry]:
    """Every report of one season holding a block, each with its state against its fixture as stored now."""

    rows = await aggregate_many_from_db(collection=spielberichte_collection, pipeline=build_state_pipeline(saison_id=saison_id))

    entries = []
    for row in rows:
        bericht = FLSpielberichtBericht.model_validate(row["bericht"])
        entries.append(
            FLSpielberichtStateEntry(
                spiel_id=row["spiel_id"], state=bericht_state_of(bericht, row["spiel"]), ergebnis_vorschlag=bericht.ergebnis_vorschlag
            )
        )

    return entries


async def strip_the_seasons_reports(
    *,
    spielberichte_collection: AsyncCollection,
    saison_id: str,
    # REQUIRED: the following season's end judged in the same snapshot, so an activation since the caller's read keeps them.
    session: AsyncClientSession,
) -> int:
    """Once the season after `saison_id` has ended, every report's remarks and card reasons, answering how many reports it stripped."""

    stripped = await patch_many_in_db(
        collection=spielberichte_collection,
        db_filter=build_season_report_texts_filter(saison_id),
        # Every card's reason by `$[]`: the cards stand.
        update={"$set": {"bericht.remarks": None, "bericht.cards.$[].reason": None}},
        session=session,
    )

    return stripped.modified_count


async def repoint_referee_reports_in_session(
    *,
    spielberichte_collection: AsyncCollection,
    schiedsrichter_ids: Sequence[CustomObjectId],
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one.
    session: AsyncClientSession,
) -> int:
    """Repoint every report these referees sent at the ghost.

    The report stands, its remarks included: it is the league's record of the match. Run ahead of the referee's own step.
    """

    # No command for none: a person holding no referee row costs this step nothing.
    if not schiedsrichter_ids:
        return 0

    repointed = await patch_many_in_db(
        collection=spielberichte_collection,
        db_filter=build_referee_reports_filter(schiedsrichter_ids),
        update={"$set": {"bericht.submitted_by.schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID}},
        session=session,
    )

    return repointed.modified_count


async def stamp_the_adoption(
    *,
    spielberichte_collection: AsyncCollection,
    spiel_id: CustomObjectId,
    version: int,
    # The clubs the save leaves on the fixture: a report written about others credits neither.
    sides: Mapping[FLSpielSide, ObjectId | None],
    now: datetime,
    # REQUIRED: the fixture save's own, so a save that does not commit takes its stamp back with it.
    session: AsyncClientSession,
) -> None:
    """Stamp the report adopted at `version`, matching it only while it still stands there.

    A fan-out rather than `patch_one_in_db`, whose miss would raise and take the fixture's save with it.
    """

    await patch_many_in_db(
        collection=spielberichte_collection,
        db_filter={"spiel_id": spiel_id, "bericht.version": version, **{f"bericht.sides.{side}": sides[side] for side in SIDES}},
        update={
            "$set": {
                "bericht.adopted_at": now,
                "bericht.adopted_by": {"kind": "admin"},
                "bericht.adopted_version": version,
            }
        },
        session=session,
    )


async def repoint_pupil_entries_in_session(
    *,
    spielberichte_collection: AsyncCollection,
    spieler_id: CustomObjectId,
    # REQUIRED: the erasure's own, so a report never names the sentinel of an erasure that rolled back.
    session: AsyncClientSession,
) -> int:
    """Repoint every scorer and card entry naming this pupil at the sentinel, answering how many reports changed.

    The one place an erased pupil's entries are repointed. A line-up's entries (`services.py :: AUFSTELLUNGEN_FIELD`)
    are outside this update, so a write storing a line-up adds them to it, or a report keeps an erased pupil's id. The
    report stands as the league's record of the match, its adoption with it: `bericht.version` counts the referee's writes
    alone.
    """

    # One update over both arrays, each through its own `$[<identifier>]` (the manual's
    # "$[<identifier>]" page). The filter selects only the reports holding an entry to change, since
    # an array-filtered update reaches `patch_many_in_db` unnarrowed.
    repointed = await patch_many_in_db(
        collection=spielberichte_collection,
        db_filter={"$or": [{"bericht.scorers.spieler_id": spieler_id}, {"bericht.cards.spieler_id": spieler_id}]},
        update={"$set": {"bericht.scorers.$[goal].spieler_id": GHOST_SPIELER_ID, "bericht.cards.$[card].spieler_id": GHOST_SPIELER_ID}},
        array_filters=[{"goal.spieler_id": spieler_id}, {"card.spieler_id": spieler_id}],
        session=session,
    )

    return repointed.modified_count
