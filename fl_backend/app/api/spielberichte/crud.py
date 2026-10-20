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
    team_id_of,
)
from app.api.teams.schemas import KONTAKT_ROLLEN
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
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.shared.schemas.custom import CustomObjectId

# The seat holders' two names alone: what the remarks are judged against.
VEREIN_FIELDS: Mapping[str, int] = {
    "_id": 0,
    "team_id": 1,
    **{f"kontakte.{seat}.{part}": 1 for seat in KONTAKT_ROLLEN for part in ("vorname", "nachname")},
}


async def pull_bericht_lage(
    *,
    spiele_collection: AsyncCollection,
    saison_spieler_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    spiel_id: ObjectId,
    session: AsyncClientSession | None,
) -> BerichtLage:
    """The fixture, both clubs' squads and season rows, under `session`; `DB-COMMON-001` for a fixture that does not exist."""

    spiel = await pull_one_from_db(collection=spiele_collection, db_filter={"_id": spiel_id}, projection=dict(SPIEL_FIELDS), session=session)
    team_ids = [team_id for seite in SEITEN if (team_id := team_id_of(spiel, seite)) is not None]
    saison_id = str(spiel["saison_id"])

    kader = await aggregate_many_from_db(
        collection=saison_spieler_collection,
        pipeline=build_bericht_kader_pipeline(saison_id=saison_id, team_ids=team_ids),
        collation=GERMAN_COLLATION,
        session=session,
    )
    vereine = await pull_many_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_id, "team_id": {"$in": team_ids}},
        projection=dict(VEREIN_FIELDS),
        session=session,
    )

    return BerichtLage(spiel=spiel, kader=kader, vereine=vereine)


async def pull_genannt(
    *,
    spieler_collection: AsyncCollection,
    lage: BerichtLage,
    kader_offen: bool,
    bericht: Mapping[str, Any] | None,
    session: AsyncClientSession | None,
) -> list[FLSpielberichtSpieler]:
    """Every pupil the stored block names outside the squads served beside it, so an entry stored before keeps its name on the form.

    Every pupil it names where no squad is served (`compose_ansicht`'s `kader_offen`).
    """

    live = {row["spieler_id"] for seite in SEITEN for row in live_kader(lage, seite)} if kader_offen else set()
    ausserhalb = set().union(*genannte_ids(bericht).values()) - live
    zeilen = {row["spieler_id"]: row for row in lage.kader if row["spieler_id"] in ausserhalb}
    # A pupil of neither side's club, such as one of a club a knockout slot has since replaced: read off their record.
    # An erased pupil's id finds none, and the entry stays unnamed.
    rest = ausserhalb - zeilen.keys()
    personen = (
        []
        if not rest
        else await pull_many_from_db(
            collection=spieler_collection, db_filter={"_id": {"$in": sorted(rest)}}, projection=["vorname", "nachname"], session=session
        )
    )

    return [
        *(FLSpielberichtSpieler.model_validate(zeile) for zeile in zeilen.values()),
        *(
            FLSpielberichtSpieler(spieler_id=person["_id"], vorname=person.get("vorname"), nachname=person.get("nachname"), nummer=None)
            for person in personen
        ),
    ]


async def anchor_the_pupils_named(*, spieler_collection: AsyncCollection, spieler_ids: Iterable[ObjectId], session: AsyncClientSession) -> None:
    """One anchor over every pupil a write newly names, so an erasure of one of them conflicts with it (`docs/backend/spec.md :: I53`)."""

    ids = sorted(set(spieler_ids))
    if not ids:
        return

    await anchor_in_db(collection=spieler_collection, db_filter={"_id": {"$in": ids}}, session=session)


async def write_bericht(
    *,
    spielberichte_collection: AsyncCollection,
    spiel_raw: Mapping[str, Any],
    gespeichert: Mapping[str, Any] | None,
    payload: FLSpielberichtBerichtPayload,
    von: FLSpielberichtVon,
    now: datetime,
    session: AsyncClientSession,
) -> Mapping[str, Any]:
    """The block written whole: created by its first writer, created on a line-up's document lacking it, or replaced.

    A block already saying what the payload says is left as stored; otherwise answers the document as written.
    """

    if gespeichert is not None and bericht_unveraendert(payload, gespeichert.get("bericht")):
        return gespeichert

    if gespeichert is None:
        # A first write committing while this one runs conflicts with it, and the retry writes this one over it as a
        # correction; `uniq_spielbericht_spiel_id` stands behind both.
        await post_one_to_db(
            collection=spielberichte_collection,
            document={
                "saison_id": spiel_raw["saison_id"],
                "spiel_id": spiel_raw["_id"],
                "bericht": compose_neuer_bericht(payload, von=von, now=now),
            },
            session=session,
        )
    else:
        update = (
            {"$set": {"bericht": compose_neuer_bericht(payload, von=von, now=now)}}
            if gespeichert.get("bericht") is None
            else compose_bericht_update(payload, now=now)
        )
        await patch_one_in_db(
            collection=spielberichte_collection,
            db_filter={"_id": gespeichert["_id"]},
            update=update,
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

    return await pull_one_from_db(collection=spielberichte_collection, db_filter={"spiel_id": spiel_raw["_id"]}, session=session)


async def count_eingereichte_berichte(*, spielberichte_collection: AsyncCollection, saison_id: str, session: AsyncClientSession | None) -> int:
    """How many of the season's report documents hold a submitted report, under `session`."""

    return await spielberichte_collection.count_documents({"saison_id": saison_id, "bericht": {"$ne": None}}, session=session)


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
    # REQUIRED: the season's end judged in the same snapshot, so an activation since the caller's read keeps them.
    session: AsyncClientSession,
) -> int:
    """At the season's end, every report's remarks and card reasons, on the reports and in their log images."""

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
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one
    # (`docs/backend/spec.md :: I52`).
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
    now: datetime,
    # REQUIRED: the fixture save's own, so a save that does not commit takes its stamp back with it.
    session: AsyncClientSession,
) -> None:
    """Stamp the report adopted at `version`, matching it only while it still stands there (`docs/backend/spec.md :: I806`).

    `patch_many_in_db` because its miss writes nothing, where `patch_one_in_db`'s raises and takes the fixture's save with it.
    """

    await patch_many_in_db(
        collection=spielberichte_collection,
        db_filter={"spiel_id": spiel_id, "bericht.version": version},
        update={
            "$set": {
                "bericht.uebernommen_am": now,
                "bericht.uebernommen_von": {"art": "admin"},
                "bericht.uebernommene_version": version,
            }
        },
        session=session,
    )
