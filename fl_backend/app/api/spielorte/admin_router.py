from typing import Annotated

from fastapi import APIRouter, Body, Depends
from motor.motor_asyncio import AsyncIOMotorClientSession

from app.api.spiele.schemas import SONDEREREIGNIS_WITHOUT_A_RESULT
from app.api.spielorte.schemas import (
    FLPatchSpielortPayload,
    FLPatchSpielortResponse,
    FLPostSpielortPayload,
    FLPostSpielortResponse,
    FLSpielort,
    FLSpielortWriteResponse,
)
from app.api.spielorte.services import find_venue_retire_refusal
from app.core.config import API_VERSION
from app.core.crud import insert_live, patch_many_in_db, patch_one_in_db, pull_many_from_db, refuse, set_inactive_since
from app.core.dependencies import DBClient, SpieleCollection, SpielorteCollection, get_german_date_str
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielorte",
    dependencies=[Depends(verify_access_admin), Depends(bind_actor)],
)


def _maps_link(name: str, address: FLAddress) -> str:
    """The Google Maps SEARCH STRING, not a URL. Derived here so a client can never supply one."""
    return f"{name}, {address.to_string}, Deutschland"


@router.post("", response_model=FLPostSpielortResponse, status_code=201, summary="Create a Spielort")
async def post_spielort(
    spielort_data: Annotated[FLPostSpielortPayload, Body()],
    spielorte_collection: SpielorteCollection,
) -> FLPostSpielortResponse:
    """Create a venue. `maps_link` is built server-side from the name and address and must not be submitted."""

    post_operation = await insert_live(
        collection=spielorte_collection,
        document={
            **spielort_data.model_dump(mode="json"),
            "maps_link": _maps_link(spielort_data.name, spielort_data.address),
        },
    )

    return FLPostSpielortResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        created_id=post_operation.inserted_id,
    )


@router.patch(by_id("spielort_id"), response_model=FLPatchSpielortResponse, summary="Update a Spielort and fan the change out")
async def patch_spielort(
    spielort_id: CustomRouteObjectId,
    spielort_data: Annotated[FLPatchSpielortPayload, Body()],
    spielorte_collection: SpielorteCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
) -> FLPatchSpielortResponse:
    """
    Update a venue, then update every Spiel that embeds it.

    The fan-out is not optional: without it, match cards keep showing the old name. `mietpreis` is
    NOT fanned out -- the rent on a match is what was agreed for that match.
    """

    maps_link = _maps_link(spielort_data.name, spielort_data.address)

    async def rename_and_fan_out(session: AsyncIOMotorClientSession) -> FLPatchSpielortResponse:
        updated_document_raw = await patch_one_in_db(
            collection=spielorte_collection,
            db_filter={"_id": spielort_id},
            update={"$set": {**spielort_data.model_dump(mode="json"), "maps_link": maps_link}},
            session=session,
        )
        updated_document = FLSpielort(**updated_document_raw)

        fan_out = await patch_many_in_db(
            collection=spiele_collection,
            db_filter={"ort.spielort_id": updated_document.id},
            update={"$set": {"ort.maps_link": updated_document.maps_link, "ort.name": updated_document.name}},
            session=session,
        )

        return FLPatchSpielortResponse(updated_document=updated_document, fanned_out_to_spiele=fan_out.modified_count)

    # One transaction: a rename landing on the venue and not on its fixtures is the stale copy the
    # fan-out exists to prevent. `with_transaction` over a bare `start_transaction` -- the callback
    # derives both writes from the payload, so a retry is safe.
    async with await db.start_session() as session:
        return await session.with_transaction(rename_and_fan_out)


@router.delete(by_id("spielort_id"), response_model=FLSpielortWriteResponse, summary="Deactivate a Spielort (soft delete)")
async def delete_spielort(
    spielort_id: CustomRouteObjectId,
    spielorte_collection: SpielorteCollection,
    spiele_collection: SpieleCollection,
    today: str = Depends(get_german_date_str),
) -> FLSpielortWriteResponse:
    """
    Deactivate a venue. SOFT: it stamps `inactive_since`, and the document stays.

    Matches embed a copy, so a hard delete would orphan every historical match that used it. Refused
    while an unplayed fixture is still booked here (`REQ-RETIRE-003`).
    """

    # `unplayed_spiel_nrs`'s definition, so the two rules agree about what is still to come.
    booked = await pull_many_from_db(
        collection=spiele_collection,
        db_filter={
            "ort.spielort_id": spielort_id,
            "ergebnis": None,
            "sonderereignis": {"$nin": list(SONDEREREIGNIS_WITHOUT_A_RESULT)},
        },
        projection={"spiel_nr": 1},
    )
    refuse(find_venue_retire_refusal(upcoming_spiel_nrs=sorted(int(row["spiel_nr"]) for row in booked)))

    updated_document_raw = await set_inactive_since(
        collection=spielorte_collection,
        db_filter={"_id": spielort_id},
        when=today,
    )

    return FLSpielortWriteResponse(updated_document=FLSpielort(**updated_document_raw))


@router.post(f"{by_id('spielort_id')}/reactivate", response_model=FLSpielortWriteResponse, summary="Bring a deactivated Spielort back")
async def reactivate_spielort(
    spielort_id: CustomRouteObjectId,
    spielorte_collection: SpielorteCollection,
) -> FLSpielortWriteResponse:
    """Clear `inactive_since`, putting the venue back into the picker and every default read."""

    updated_document_raw = await set_inactive_since(
        collection=spielorte_collection,
        db_filter={"_id": spielort_id},
        when=None,
    )

    return FLSpielortWriteResponse(updated_document=FLSpielort(**updated_document_raw))
