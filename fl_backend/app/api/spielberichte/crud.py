from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aktionen.crud import redact_images_in_session
from app.api.spielberichte.schemas import (
    FLSpielberichtBericht,
    FLSpielberichtBerichtPayload,
    FLSpielberichtSpieler,
    FLSpielberichtVon,
    FLSpielberichtZustandEintrag,
)
from app.api.spielberichte.services import (
    SEITEN,
    SPIEL_FIELDS,
    BerichtLage,
    bericht_unveraendert,
    bericht_zustand_of,
    build_bericht_kader_pipeline,
    build_eingereichte_pipeline,
    build_referee_report_images_filter,
    build_referee_reports_filter,
    build_season_report_images_filter,
    build_season_report_texts_filter,
    build_zustand_pipeline,
    compose_bericht_update,
    compose_neuer_bericht,
    genannte_ids,
    live_kader,
    referee_report_image_edits,
    season_end_report_image_edits,
    seiten_of,
    team_id_of,
)
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
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.literals import FLSpielSeite


async def pull_bericht_lage(
    *,
    spiele_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    saison_spieler_collection: AsyncCollection,
    spiel_id: ObjectId,
    session: AsyncClientSession | None,
) -> BerichtLage:
    """The fixture, its season's status and both clubs' squads, under `session`.

    `DB-COMMON-001` for a fixture that does not exist.
    """

    spiel = await pull_one_from_db(collection=spiele_collection, db_filter={"_id": spiel_id}, projection=dict(SPIEL_FIELDS), session=session)
    team_ids = [team_id for seite in SEITEN if (team_id := team_id_of(spiel, seite)) is not None]
    saison_id = str(spiel["saison_id"])

    kader = await aggregate_many_from_db(
        collection=saison_spieler_collection,
        pipeline=build_bericht_kader_pipeline(saison_id=saison_id, team_ids=team_ids),
        collation=GERMAN_COLLATION,
        session=session,
    )

    saison = await saisons_collection.find_one({"_id": saison_id}, projection={"_id": 0, "status": 1}, session=session)

    return BerichtLage(spiel=spiel, kader=kader, saison_status=None if saison is None else saison.get("status"))


async def pull_beendete_saison_ids(*, saisons_collection: AsyncCollection, session: AsyncClientSession | None) -> list[str]:
    """Every ended season, by the status `app/api/spielberichte/services.py :: ist_abgeschlossen` reads, under `session`."""

    saisons = await pull_many_from_db(collection=saisons_collection, db_filter={"status": "past"}, projection=["_id"], session=session)

    return [str(saison["_id"]) for saison in saisons]


async def pull_genannt(
    *,
    spieler_collection: AsyncCollection,
    lage: BerichtLage,
    kader_offen: bool,
    bericht: Mapping[str, Any] | None,
    session: AsyncClientSession | None,
) -> list[FLSpielberichtSpieler]:
    """Every pupil the block names outside the squads served, so a stored entry keeps its name; every one where none is served.

    An erased pupil comes nameless, read „anonym“ rather than as the id its entry keeps.
    """

    live = {row["spieler_id"] for seite in SEITEN for row in live_kader(lage, seite)} if kader_offen else set()
    ausserhalb = set().union(*genannte_ids(bericht).values()) - live
    zeilen = {row["spieler_id"]: row for row in lage.kader if row["spieler_id"] in ausserhalb}
    # A pupil of neither side's club, such as one of a club a knockout slot has since replaced: read off their record.
    rest = ausserhalb - zeilen.keys()
    personen = (
        []
        if not rest
        else await pull_many_from_db(
            collection=spieler_collection, db_filter={"_id": {"$in": sorted(rest)}}, projection=["vorname", "nachname"], session=session
        )
    )

    benannt = {person["_id"]: person for person in personen}

    return [
        *(FLSpielberichtSpieler.model_validate(zeile) for zeile in zeilen.values()),
        *(
            FLSpielberichtSpieler(
                spieler_id=spieler_id,
                vorname=benannt.get(spieler_id, {}).get("vorname"),
                nachname=benannt.get(spieler_id, {}).get("nachname"),
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
    gespeichert: Mapping[str, Any] | None,
    payload: FLSpielberichtBerichtPayload,
    von: FLSpielberichtVon,
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
    # report reads `teams_geaendert`, never adoptable.
    seiten = seiten_of(spiel_raw)
    if gespeichert is not None and bericht_unveraendert(payload, gespeichert.get("bericht"), seiten):
        return gespeichert

    if gespeichert is None:
        # A first write committing while this one runs conflicts with it, and the retry meets that write's version
        # (`app/api/spielberichte/services.py :: find_bericht_stand_refusal`); `uniq_spielbericht_spiel_id` stands behind both.
        await post_one_to_db(
            collection=spielberichte_collection,
            document={
                "saison_id": spiel_raw["saison_id"],
                "spiel_id": spiel_raw["_id"],
                "bericht": compose_neuer_bericht(payload, von=von, seiten=seiten, now=now),
            },
            session=session,
        )
        return await pull_one_from_db(collection=spielberichte_collection, db_filter={"spiel_id": spiel_raw["_id"]}, session=session)

    update = (
        {"$set": {"bericht": compose_neuer_bericht(payload, von=von, seiten=seiten, now=now)}}
        if gespeichert.get("bericht") is None
        else compose_bericht_update(payload, seiten=seiten, now=now)
    )
    # `AFTER`: inside the transaction the patch reads the document back for its log anyway.
    return await patch_one_in_db(
        collection=spielberichte_collection,
        db_filter={"_id": gespeichert["_id"]},
        update={**update, "$set": {**update["$set"], VERSION_FIELD: version}},
        session=session,
        return_document=ReturnDocument.AFTER,
    )


async def count_eingereichte_berichte(*, spielberichte_collection: AsyncCollection, saison_id: str, session: AsyncClientSession | None) -> int:
    """How many of the season's fixtures hold a submitted report, under `session`, joined as the reads join so the two agree."""

    counted = await aggregate_many_from_db(
        collection=spielberichte_collection,
        pipeline=[*build_eingereichte_pipeline(saison_id=saison_id, spiel_fields={"_id": 1}), {"$count": "berichte"}],
        session=session,
    )

    return counted[0]["berichte"] if counted else 0


async def pull_zustaende(*, spielberichte_collection: AsyncCollection, saison_id: str) -> list[FLSpielberichtZustandEintrag]:
    """Every report of one season holding a block, each with its state against its fixture as stored now."""

    rows = await aggregate_many_from_db(collection=spielberichte_collection, pipeline=build_zustand_pipeline(saison_id=saison_id))

    eintraege = []
    for row in rows:
        bericht = FLSpielberichtBericht.model_validate(row["bericht"])
        eintraege.append(
            FLSpielberichtZustandEintrag(
                spiel_id=row["spiel_id"], zustand=bericht_zustand_of(bericht, row["spiel"]), ergebnis_vorschlag=bericht.ergebnis_vorschlag
            )
        )

    return eintraege


async def strip_the_seasons_reports(
    *,
    spielberichte_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    saison_id: str,
    stamp: str,
    # REQUIRED: the following season's end judged in the same snapshot, so an activation since the caller's read keeps them.
    session: AsyncClientSession,
) -> int:
    """Once the season after `saison_id` has ended, every report's remarks and card reasons, on the reports and in their log images."""

    await patch_many_in_db(
        collection=spielberichte_collection,
        db_filter=build_season_report_texts_filter(saison_id),
        # Every card's reason by `$[]`: the cards stand.
        update={"$set": {"bericht.bemerkungen": None, "bericht.karten.$[].grund": None}},
        session=session,
    )

    return await redact_images_in_session(
        aktionen_collection=aktionen_collection,
        db_filter=build_season_report_images_filter(saison_id),
        judge=lambda image: season_end_report_image_edits(image, saison_id),
        stamp=stamp,
        session=session,
    )


async def repoint_referee_reports_in_session(
    *,
    spielberichte_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    schiedsrichter_ids: Sequence[CustomObjectId],
    # The caller's, so every redaction of one erasure carries one instant.
    stamp: str,
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one.
    session: AsyncClientSession,
) -> int:
    """Repoint every report these referees sent at the ghost, in the document and in its log images.

    The report stands, its remarks included: it is the league's record of the match. Run ahead of the referee's own step.
    """

    # No command for none: a person holding no referee row costs this step nothing.
    if not schiedsrichter_ids:
        return 0

    repointed = await patch_many_in_db(
        collection=spielberichte_collection,
        db_filter=build_referee_reports_filter(schiedsrichter_ids),
        update={"$set": {"bericht.eingereicht_von.schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID}},
        session=session,
    )

    await redact_images_in_session(
        aktionen_collection=aktionen_collection,
        db_filter=build_referee_report_images_filter(schiedsrichter_ids),
        judge=lambda image: referee_report_image_edits(image, schiedsrichter_ids),
        stamp=stamp,
        session=session,
    )

    return repointed.modified_count


async def stamp_the_adoption(
    *,
    spielberichte_collection: AsyncCollection,
    spiel_id: CustomObjectId,
    version: int,
    # The clubs the save leaves on the fixture: a report written about others credits neither.
    seiten: Mapping[FLSpielSeite, ObjectId | None],
    now: datetime,
    # REQUIRED: the fixture save's own, so a save that does not commit takes its stamp back with it.
    session: AsyncClientSession,
) -> bool:
    """Stamp the report adopted at `version`, matching it only while it still stands there, and say whether it did.

    A fan-out rather than `patch_one_in_db`, whose miss would raise and take the fixture's save with it.
    """

    stamped = await patch_many_in_db(
        collection=spielberichte_collection,
        db_filter={"spiel_id": spiel_id, "bericht.version": version, **{f"bericht.seiten.{seite}": seiten[seite] for seite in SEITEN}},
        update={
            "$set": {
                "bericht.uebernommen_am": now,
                "bericht.uebernommen_von": {"art": "admin"},
                "bericht.uebernommene_version": version,
            }
        },
        session=session,
    )

    return stamped.matched_count > 0
