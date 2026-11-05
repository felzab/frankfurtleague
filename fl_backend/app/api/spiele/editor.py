"""The match editor's one view read: the fixture, and everything its sections offer beside it or show of it.

Its own module because it composes three slices' reads, the reports' and the confirmations' beside the fixtures',
and each of those slices imports this one's schemas.
"""

import asyncio
from collections.abc import Mapping
from typing import Any

from pydantic import Field
from pymongo.asynchronous.collection import AsyncCollection

from app.api.spielberichte.crud import pull_bericht_lage, pull_genannt
from app.api.spielberichte.schemas import (
    FLSpielberichtBericht,
    FLSpielberichtSeiten,
    FLSpielberichtSpieler,
    FLSpielberichtState,
    FLSpielberichtTorschuetze,
    FLSpielberichtVorschlag,
)
from app.api.spielberichte.services import bericht_zustand_of
from app.api.spielbestaetigungen.admin_router import get_spielbestaetigungen
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigung, FLSpielbestaetigungenFilterParams
from app.api.spiele.schemas import FLSpielJoinedAdmin
from app.api.spiele.services import build_spiele_pipeline
from app.core.crud import GERMAN_COLLATION, aggregate_many_from_db, pull_many_from_db, pull_one_from_db
from app.core.exceptions import DocumentNotFoundError
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.shared.einwilligung import is_confirmed
from app.shared.schemas.bounds import LIST_LIMIT_MAX
from app.shared.schemas.custom import CustomNonEmptyString, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.literals import FLSaisonStatus
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel


class FLSpielEditorSpielort(BaseReadModel):
    """A venue the editor offers: its name, the rent it defaults to, and the day it retired, null while it serves."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    name: CustomNonEmptyString
    default_mietpreis: int = Field(ge=0)
    inactive_since: CustomOptionalDateString


class FLSpielEditorSchiedsrichter(BaseReadModel):
    """A referee the editor offers: their whole name, the fee they default to, whether they confirmed their entry, and the day they retired."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    name: CustomNonEmptyString
    default_payment: int = Field(ge=0)
    # Offered unconfirmed too, so the editor marks the one a save refuses (`booking_unconfirmed_schiedsrichter`).
    confirmed: bool
    inactive_since: CustomOptionalDateString


class FLSpielEditorBericht(BaseReadModel):
    """The fixture's report as the editor's Spielbericht section shows it: its goals and the result they propose.

    `version` is the one an adoption names (`adopts_bericht`), `seiten` the clubs the report is about, and `named`
    each pupil a goal names, by the names their record holds.
    """

    state: FLSpielberichtState
    version: int
    ergebnis_vorschlag: FLSpielberichtVorschlag
    seiten: FLSpielberichtSeiten
    torschuetzen: list[FLSpielberichtTorschuetze]
    named: list[FLSpielberichtSpieler]


class FLSpieleAdminSingleResponse(BaseAPIResponse):
    """One fixture for the match editor, money and `version` included, and all its sections offer and show beside it.

    `saison_status` on the response rather than on the fixture: the editor alone asks it, to open a finished season's
    match read-only, which the save refuses (`saison_past`), and a fixture carries no season-scoped state.
    """

    spiel: FLSpielJoinedAdmin
    saison_status: FLSaisonStatus
    # Every live venue and referee, and the fixture's own where it has retired, so a booking stays named.
    spielorte: list[FLSpielEditorSpielort]
    schiedsrichter: list[FLSpielEditorSchiedsrichter]
    # Null where the fixture holds no report.
    spielbericht: FLSpielEditorBericht | None
    # The fixture's confirmation rows, newest first, as the confirmations' own read serves them.
    spielbestaetigungen: list[FLSpielbestaetigung]


def _offered(booked: CustomObjectId | None) -> Mapping[str, Any]:
    """Every live row, and the booked one whatever it is, so a fixture booked onto a retired row still names it."""

    return {"$or": [{"inactive_since": None}, *([] if booked is None else [{"_id": booked}])]}


async def _spielbericht_of(
    *,
    spiel_id: CustomObjectId,
    spiele_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    saison_spieler_collection: AsyncCollection,
    spieler_collection: AsyncCollection,
    spielberichte_collection: AsyncCollection,
) -> FLSpielEditorBericht | None:
    """The report as the administrator's panel composes it, its goals alone: the cards and the remarks are not the editor's."""

    dokument = await spielberichte_collection.find_one({"spiel_id": spiel_id}, {"bericht": 1})
    block = None if dokument is None else dokument.get("bericht")
    if block is None:
        return None

    bericht = FLSpielberichtBericht.model_validate(block)
    lage = await pull_bericht_lage(
        spiele_collection=spiele_collection,
        saisons_collection=saisons_collection,
        saison_spieler_collection=saison_spieler_collection,
        spiel_id=spiel_id,
        session=None,
    )
    scorers = {tor.spieler_id for tor in bericht.torschuetzen if tor.spieler_id is not None}
    named = await pull_genannt(spieler_collection=spieler_collection, lage=lage, kader_offen=False, bericht=block, session=None)

    return FLSpielEditorBericht(
        state=bericht_zustand_of(bericht, lage.spiel),
        version=bericht.version,
        ergebnis_vorschlag=bericht.ergebnis_vorschlag,
        seiten=bericht.seiten,
        torschuetzen=bericht.torschuetzen,
        named=[spieler for spieler in named if spieler.spieler_id in scorers],
    )


async def read_spiel_editor(
    *,
    spiel_id: CustomObjectId,
    spiele_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    spielorte_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    saison_spieler_collection: AsyncCollection,
    spieler_collection: AsyncCollection,
    spielberichte_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
) -> FLSpieleAdminSingleResponse:
    """Everything the match editor shows, the fixture first: `document_not_found` for an id no fixture holds."""

    spiele_raw = await aggregate_many_from_db(
        collection=spiele_collection, pipeline=build_spiele_pipeline(db_filter={"_id": spiel_id}), limit=1
    )
    if not spiele_raw:
        raise DocumentNotFoundError()
    spiel = FLSpielJoinedAdmin.model_validate(spiele_raw[0])

    gebuchter_ort = None if spiel.ort is None else spiel.ort.spielort_id
    gebuchter_schiedsrichter = None if spiel.schiedsrichter is None else spiel.schiedsrichter.schiedsrichter_id

    # The rest named by the fixture alone, so read beside one another.
    saison_raw, spielorte_raw, schiedsrichter_raw, spielbericht, bestaetigungen = await asyncio.gather(
        # Read as the save's judgement reads it, so the editor opens read-only on exactly the season the write refuses.
        pull_one_from_db(collection=saisons_collection, db_filter={"_id": spiel.saison_id}, projection=["status"]),
        pull_many_from_db(
            collection=spielorte_collection,
            db_filter=_offered(gebuchter_ort),
            limit=LIST_LIMIT_MAX,
            sort_by=[("name", 1)],
            projection=["name", "default_mietpreis", "inactive_since"],
            collation=GERMAN_COLLATION,
        ),
        pull_many_from_db(
            collection=schiedsrichter_collection,
            # Never the ghost, whom no fixture is booked onto anew and who has no name to offer.
            db_filter={**_offered(gebuchter_schiedsrichter), "_id": {"$ne": GHOST_SCHIEDSRICHTER_ID}},
            limit=LIST_LIMIT_MAX,
            sort_by=[("name", 1)],
            projection=["name", "default_payment", "inactive_since", "einwilligung.confirmed_at"],
            collation=GERMAN_COLLATION,
        ),
        _spielbericht_of(
            spiel_id=spiel_id,
            spiele_collection=spiele_collection,
            saisons_collection=saisons_collection,
            saison_spieler_collection=saison_spieler_collection,
            spieler_collection=spieler_collection,
            spielberichte_collection=spielberichte_collection,
        ),
        # The confirmations' own reader, so a row reaches the editor as their list serves it.
        get_spielbestaetigungen(
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            outbox_collection=outbox_collection,
            filters=FLSpielbestaetigungenFilterParams(saison_id=spiel.saison_id, spiel_id=spiel_id, limit=LIST_LIMIT_MAX),
        ),
    )

    return FLSpieleAdminSingleResponse(
        spiel=spiel,
        saison_status=saison_raw["status"],
        spielorte=[FLSpielEditorSpielort.model_validate(row) for row in spielorte_raw],
        schiedsrichter=[
            FLSpielEditorSchiedsrichter.model_validate({**row, "confirmed": is_confirmed(row.get("einwilligung"))})
            for row in schiedsrichter_raw
        ],
        spielbericht=spielbericht,
        spielbestaetigungen=bestaetigungen.spielbestaetigungen,
    )
