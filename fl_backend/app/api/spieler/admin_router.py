from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument

from app.api.spieler.schemas import (
    FLPatchSaisonSpielerPayload,
    FLPatchSpielerPayload,
    FLPostSaisonSpielerPayload,
    FLPostSpielerPayload,
    FLSaisonSpielerResponse,
    FLSpielerMembershipsResponse,
    FLSpielerSingleResponse,
    FLSpielerWithMemberships,
    FLSpielerWriteResponse,
)
from app.api.spieler.services import build_spieler_memberships_pipeline, find_squad_refusal
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_one_in_db, post_one_to_db
from app.core.dependencies import SaisonSpielerCollection, SaisonTeamsCollection, SpielerCollection, get_german_date_str
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentConflictException, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler",
    dependencies=[Depends(verify_access_admin)],
)


def _as_single(document) -> FLSpielerSingleResponse:
    return FLSpielerSingleResponse(
        spieler_id=document["_id"],
        vorname=document["vorname"],
        nachname=document.get("nachname"),
        inactive_since=document.get("inactive_since"),
    )


def _as_junction(document) -> FLSaisonSpielerResponse:
    return FLSaisonSpielerResponse(
        spieler_id=document["spieler_id"],
        saison_id=document["saison_id"],
        team_id=document["team_id"],
        nummer=document.get("nummer"),
        position=document.get("position"),
        stufe=document.get("stufe"),
        is_nachgetragen=document["is_nachgetragen"],
        # `.get` with a default, not a subscript: a row missing the key would KeyError on a request
        # that changed nothing. `python -m app.core.constraints --check` finds one.
        is_captain=document.get("is_captain", False),
        inactive_since=document.get("inactive_since"),
    )


# A static path beside `by_id` routes: the id convertor takes 24 hex characters, so no id route can
# capture this one whatever the declaration order.
@router.get("/memberships", response_model=FLSpielerMembershipsResponse, summary="Every Spieler with their squad rows")
async def get_spieler_memberships(spieler_collection: SpielerCollection) -> FLSpielerMembershipsResponse:
    """
    Every player, retired ones included, each with every squad row they hold.

    `GET /spieler` cannot answer it at any setting: with a `saison_id` the junction join is strict,
    without one a player with no row comes back missing `team_id`.
    """

    spieler_raw = await aggregate_many_from_db(collection=spieler_collection, pipeline=build_spieler_memberships_pipeline())

    return FLSpielerMembershipsResponse(spieler=[FLSpielerWithMemberships.model_validate(spieler) for spieler in spieler_raw])


@router.post("", response_model=FLSpielerWriteResponse, status_code=201, summary="Create a Spieler")
async def post_spieler(
    spieler_data: Annotated[FLPostSpielerPayload, Body()],
    spieler_collection: SpielerCollection,
) -> FLSpielerWriteResponse:
    """
    Create a player -- the person, and nothing else.

    They belong to no team until they have a junction row, and no uniqueness rule applies to a name.
    """

    post_operation = await post_one_to_db(
        collection=spieler_collection,
        document={**spieler_data.model_dump(mode="json"), "inactive_since": None},
    )

    return FLSpielerWriteResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        spieler_id=post_operation.inserted_id,
    )


@router.patch(by_id("spieler_id"), response_model=FLSpielerSingleResponse, summary="Update a Spieler's name")
async def patch_spieler(
    spieler_id: CustomRouteObjectId,
    spieler_data: Annotated[FLPatchSpielerPayload, Body()],
    spieler_collection: SpielerCollection,
) -> FLSpielerSingleResponse:
    """Update a player's name. No fan-out: unlike a team or a venue, it is embedded in no other document."""

    updated_raw = await patch_one_in_db(
        collection=spieler_collection,
        filter={"_id": spieler_id},
        update={"$set": spieler_data.model_dump(mode="json")},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": spieler_id}, error_code=DOCUMENT_NOT_FOUND)

    return _as_single(updated_raw)


@router.delete(by_id("spieler_id"), response_model=FLSpielerSingleResponse, summary="Retire a Spieler (soft delete)")
async def delete_spieler(
    spieler_id: CustomRouteObjectId,
    spieler_collection: SpielerCollection,
    today: str = Depends(get_german_date_str),
) -> FLSpielerSingleResponse:
    """Retire a player. SOFT: it stamps `inactive_since`, and their squad rows are LEFT ALONE."""

    updated_raw = await patch_one_in_db(
        collection=spieler_collection,
        filter={"_id": spieler_id},
        update={"$set": {"inactive_since": today}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": spieler_id}, error_code=DOCUMENT_NOT_FOUND)

    return _as_single(updated_raw)


@router.post(f"{by_id('spieler_id')}/reactivate", response_model=FLSpielerSingleResponse, summary="Bring a retired Spieler back")
async def reactivate_spieler(
    spieler_id: CustomRouteObjectId,
    spieler_collection: SpielerCollection,
) -> FLSpielerSingleResponse:
    """Clear `inactive_since`, putting the player back into every read that hides retired ones."""

    updated_raw = await patch_one_in_db(
        collection=spieler_collection,
        filter={"_id": spieler_id},
        update={"$set": {"inactive_since": None}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": spieler_id}, error_code=DOCUMENT_NOT_FOUND)

    return _as_single(updated_raw)


@router.post(f"{by_id('spieler_id')}/saisons", response_model=FLSaisonSpielerResponse, status_code=201, summary="Add a Spieler to a squad")
async def post_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_spieler_data: Annotated[FLPostSaisonSpielerPayload, Body()],
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
) -> FLSaisonSpielerResponse:
    """
    Put a player in a team's squad for a season.

    One row per player per season, enforced by a unique index, so moving a player is a PATCH of
    `team_id` rather than a second row. A repeat is a 409, retired rows included.
    """

    # The club has to be in the season, and that fact lives in another collection.
    team_in_saison = (
        await saison_teams_collection.count_documents(
            {"saison_id": saison_spieler_data.saison_id, "team_id": saison_spieler_data.team_id}, limit=1
        )
    ) > 0
    squad_refusal = find_squad_refusal(team_in_saison=team_in_saison)
    if squad_refusal is not None:
        raise DocumentConflictException.from_refusal(squad_refusal)

    document = {
        "spieler_id": spieler_id,
        **saison_spieler_data.model_dump(mode="json", exclude={"team_id"}),
        "team_id": saison_spieler_data.team_id,
        "inactive_since": None,
    }
    await post_one_to_db(collection=saison_spieler_collection, document=document)

    return _as_junction(document)


@router.patch(f"{by_id('spieler_id')}/saisons/{{saison_id}}", response_model=FLSaisonSpielerResponse, summary="Update a squad entry")
async def patch_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_id: str,
    saison_spieler_data: Annotated[FLPatchSaisonSpielerPayload, Body()],
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
) -> FLSaisonSpielerResponse:
    """
    Update a player's squad entry for that season.

    Changing `team_id` is how a transfer is recorded. `nummer` stays free TEXT and a DUPLICATE IS
    PERMITTED (`fl_backend/app/core/domain.py :: UNENFORCED`): the league fields four keepers on 1.
    """

    # The one fact `find_squad_refusal` decides on, and it lives in another collection.
    team_in_saison = (
        await saison_teams_collection.count_documents({"saison_id": saison_id, "team_id": saison_spieler_data.team_id}, limit=1)
    ) > 0
    squad_refusal = find_squad_refusal(team_in_saison=team_in_saison)
    if squad_refusal is not None:
        raise DocumentConflictException.from_refusal(squad_refusal)

    updated_raw = await patch_one_in_db(
        collection=saison_spieler_collection,
        filter={"spieler_id": spieler_id, "saison_id": saison_id},
        update={
            "$set": {
                **saison_spieler_data.model_dump(mode="json", exclude={"team_id"}),
                "team_id": saison_spieler_data.team_id,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"spieler_id": spieler_id, "saison_id": saison_id}, error_code=DOCUMENT_NOT_FOUND)

    return _as_junction(updated_raw)


@router.delete(f"{by_id('spieler_id')}/saisons/{{saison_id}}", response_model=FLSaisonSpielerResponse, summary="Remove a Spieler from a squad")
async def delete_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_id: str,
    saison_spieler_collection: SaisonSpielerCollection,
    today: str = Depends(get_german_date_str),
) -> FLSaisonSpielerResponse:
    """
    Take a player out of a season's squad. SOFT: the row stays.

    The row records that this player wore this number in this squad, which stays true after they
    leave. `include_inactive=true` is how an admin list gets it back.
    """

    updated_raw = await patch_one_in_db(
        collection=saison_spieler_collection,
        filter={"spieler_id": spieler_id, "saison_id": saison_id},
        update={"$set": {"inactive_since": today}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"spieler_id": spieler_id, "saison_id": saison_id}, error_code=DOCUMENT_NOT_FOUND)

    return _as_junction(updated_raw)


@router.post(
    f"{by_id('spieler_id')}/saisons/{{saison_id}}/reactivate",
    response_model=FLSaisonSpielerResponse,
    summary="Put a Spieler back in a squad they left",
)
async def reactivate_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_id: str,
    saison_spieler_collection: SaisonSpielerCollection,
) -> FLSaisonSpielerResponse:
    """
    Clear a squad row's `inactive_since`, with the number and position it had.

    Where a repeat create is redirected: the retired row still holds the unique key.
    """

    updated_raw = await patch_one_in_db(
        collection=saison_spieler_collection,
        filter={"spieler_id": spieler_id, "saison_id": saison_id},
        update={"$set": {"inactive_since": None}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"spieler_id": spieler_id, "saison_id": saison_id}, error_code=DOCUMENT_NOT_FOUND)

    return _as_junction(updated_raw)
