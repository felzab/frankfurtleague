"""The match editor's one view read: the fixture, and everything its sections offer beside it or show of it.

Its own module because it composes three slices' reads, the reports' and the confirmations' beside the fixtures',
and each of those slices imports this one's schemas.
"""

import asyncio
from collections.abc import Mapping
from typing import Any

from pydantic import Field
from pymongo.asynchronous.collection import AsyncCollection

from app.api.schiedsrichter.services import DECLINED_AT_PATH, is_declined
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
from app.api.spiele.crud import pull_saison_membership
from app.api.spiele.schemas import FLPatchSpielDataPayload, FLSpiel, FLSpielJoinedAdmin, FLSpielListAdapter, FLSpielTeamFieldPayload
from app.api.spiele.services import (
    SaisonMembership,
    build_spiele_pipeline,
    find_eligibility_refusal,
    judge_spieltag_occupancy,
    stored_in_slice,
)
from app.core.crud import GERMAN_COLLATION, aggregate_many_from_db, pull_many_from_db, pull_one_from_db
from app.core.exceptions import DocumentNotFoundError
from app.core.readonly import ReadCollection
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.shared.einwilligung import is_confirmed
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX
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
    """A referee the editor offers: their whole name, the fee they default to, how they answered their entry, and the day they retired."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    name: CustomNonEmptyString
    default_payment: int = Field(ge=0)
    # Offered unconfirmed too, so the editor marks the one a save refuses (`booking_unconfirmed_schiedsrichter`), and
    # whether that is an objection, after which nobody asks the person again, or no answer yet.
    confirmed: bool
    declined: bool
    inactive_since: CustomOptionalDateString


class FLSpielEditorTeam(BaseReadModel):
    """A club a knockout fixture's Begegnung offers for either side, by the name its season row holds.

    `on_spieltag`: the club stands on another fixture of this matchday, which a save fielding it here either moves it
    off or is refused for. `fieldable`: a save fielding it on this fixture as it stands passes the write's eligibility
    and occupancy rules (`find_eligibility_refusal`, `judge_spieltag_occupancy`), judged on the side it already holds.
    """

    id: CustomObjectId
    name: CustomNonEmptyString
    on_spieltag: bool
    fieldable: bool


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
    # Null on a group fixture, whose sides the draw sets and no save picks.
    teams: list[FLSpielEditorTeam] | None
    # Null where the fixture holds no report.
    spielbericht: FLSpielEditorBericht | None
    # The fixture's confirmation rows, newest first, as the confirmations' own read serves them.
    spielbestaetigungen: list[FLSpielbestaetigung]


async def _none() -> None:
    """The part a group fixture has none of, awaited beside the reads a knockout fixture makes in its place."""

    return None


def _offered(booked: CustomObjectId | None) -> Mapping[str, Any]:
    """Every live row, and the booked one whatever it is, so a fixture booked onto a retired row still names it."""

    return {"$or": [{"inactive_since": None}, *([] if booked is None else [{"_id": booked}])]}


def _fielding(stored: FLSpiel, team_id: CustomObjectId) -> FLPatchSpielDataPayload:
    """The save that fields this club on this fixture by hand, everything else as stored.

    On the side the club already holds, else the first, with that side's source cleared, as a hand-picked side is
    saved: the resolution leaves a side without a source as it stands (`_occupant_of`).
    """

    payload = FLPatchSpielDataPayload.model_validate(stored.model_dump(include=set(FLPatchSpielDataPayload.model_fields)))
    side = "team2" if stored.team2 is not None and stored.team2.team_id == team_id else "team1"
    held = getattr(stored, side)
    tore = held.tore if held is not None and held.team_id == team_id else None
    return payload.model_copy(update={side: FLSpielTeamFieldPayload(team_id=team_id, tore=tore), f"{side}_quelle": None})


async def _teams_of(
    *,
    spiel: FLSpielJoinedAdmin,
    spiele_collection: AsyncCollection,
    saison_teams_collection: ReadCollection,
) -> list[FLSpielEditorTeam]:
    """Every club holding a row for the fixture's season, in the German order of their names, each judged by the write's own rules."""

    # One over the cap, as the save reads its season, so a truncated season is detected rather than judged.
    season_raw, membership, ordered = await asyncio.gather(
        pull_many_from_db(collection=spiele_collection, db_filter={"saison_id": spiel.saison_id}, limit=LIST_LIMIT_DEFAULT + 1),
        pull_saison_membership(saison_teams_collection=saison_teams_collection, saison_id=spiel.saison_id),
        pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": spiel.saison_id},
            limit=LIST_LIMIT_MAX,
            sort_by=[("name", 1)],
            projection=["team_id"],
            collation=GERMAN_COLLATION,
        ),
    )
    if len(season_raw) > LIST_LIMIT_DEFAULT:
        raise ValueError(f"season {spiel.saison_id} holds more than {LIST_LIMIT_DEFAULT} fixtures, which is more than one read can judge")

    season = FLSpielListAdapter.validate_python(season_raw)
    stored = stored_in_slice(spiel.id, season)

    def judged(team_id: CustomObjectId, member: SaisonMembership) -> FLSpielEditorTeam:
        payload = _fielding(stored, team_id)
        verdict = judge_spieltag_occupancy(spiel.id, payload, season, membership)
        return FLSpielEditorTeam(
            id=team_id,
            name=member.name,
            on_spieltag=verdict.refusal is not None or len(verdict.releases) > 0,
            fieldable=verdict.refusal is None and find_eligibility_refusal(spiel.id, payload, season, membership) is None,
        )

    return [judged(row["team_id"], membership[row["team_id"]]) for row in ordered if row["team_id"] in membership]


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
    saison_teams_collection: ReadCollection,
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
    saison_raw, spielorte_raw, schiedsrichter_raw, teams, spielbericht, bestaetigungen = await asyncio.gather(
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
            projection=["name", "default_payment", "inactive_since", "einwilligung.confirmed_at", DECLINED_AT_PATH],
            collation=GERMAN_COLLATION,
        ),
        _none()
        if spiel.saison_phase == "gruppenphase"
        else _teams_of(spiel=spiel, spiele_collection=spiele_collection, saison_teams_collection=saison_teams_collection),
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
            FLSpielEditorSchiedsrichter.model_validate(
                {**row, "confirmed": is_confirmed(row.get("einwilligung")), "declined": is_declined(row.get("confirmation"))}
            )
            for row in schiedsrichter_raw
        ],
        teams=teams,
        spielbericht=spielbericht,
        spielbestaetigungen=bestaetigungen.spielbestaetigungen,
    )
