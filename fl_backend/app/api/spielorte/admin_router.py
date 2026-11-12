from typing import Annotated

from fastapi import APIRouter, Body, Depends, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.results import InsertOneResult

from app.api.grants.guard import verify_actor_is_admin
from app.api.spielorte.schemas import (
    FLPatchSpielortPayload,
    FLPatchSpielortResponse,
    FLPostSpielortPayload,
    FLSpielort,
    FLSpielorteFilterParams,
    FLSpielorteListResponse,
    FLSpielorteSingleResponse,
    FLSpielortListAdapter,
)
from app.api.spielorte.services import build_unplayed_booking_filter, find_venue_name_refusal, find_venue_retire_refusal
from app.core.config import API_VERSION
from app.core.crud import (
    GERMAN_COLLATION,
    insert_live,
    is_held_elsewhere,
    patch_one_in_db,
    pull_many_from_db,
    pull_one_from_db,
    refuse,
    set_inactive_since,
)
from app.core.dependencies import DBClient, SpieleCollection, SpielorteCollection, SpielorteReadCollection, get_german_date_str
from app.core.recording import record_act
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.responses import FLCreatedResponse

# Admin-guarded, not base. `default_mietpreis` is money, which only an administrator reads, and the only field
# withheld: `address` moves with it because no public page reads the parts, not to hide them -- `maps_link` publishes
# the address whole.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielorte",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


@router.get("", response_model=FLSpielorteListResponse, summary="List Spielorte")
async def get_spielorte(
    spielorte_collection: SpielorteReadCollection,
    filters: FLSpielorteFilterParams = Depends(),
) -> FLSpielorteListResponse:
    """Every venue in name order, the retired ones too where `include_inactive` asks for them.

    `maps_link` is a Maps search string, not a URL.
    """

    spielorte_raw = await pull_many_from_db(
        collection=spielorte_collection,
        db_filter={} if filters.include_inactive else {"inactive_since": None},
        sort_by=[("name", 1)],
        collation=GERMAN_COLLATION,
    )
    spielorte = FLSpielortListAdapter.validate_python(spielorte_raw)

    return FLSpielorteListResponse(spielorte=spielorte)


@router.get(by_id("spielort_id"), response_model=FLSpielorteSingleResponse, summary="One Spielort")
async def get_spielort(spielort_id: CustomRouteObjectId, spielorte_collection: SpielorteReadCollection) -> FLSpielorteSingleResponse:
    """One venue, a retired one included, with the `version` its save sends back."""

    spielort_raw = await pull_one_from_db(collection=spielorte_collection, db_filter={"_id": spielort_id})

    return FLSpielorteSingleResponse(spielort=FLSpielort(**spielort_raw))


def _maps_link(name: str, address: FLAddress) -> str:
    """The Google Maps search string, not a URL. Derived here so a client can never supply one."""
    return f"{name}, {address.to_string}, Deutschland"


@router.post("", response_model=FLCreatedResponse, status_code=201, summary="Create a Spielort")
async def post_spielort(
    spielort_data: Annotated[FLPostSpielortPayload, Body()],
    spielorte_collection: SpielorteCollection,
    db: DBClient,
) -> FLCreatedResponse:
    """Create a venue, its `maps_link` derived from the name and the address.

    A name another venue holds, a retired one included, is refused.
    """

    async def enter_the_venue(session: AsyncClientSession) -> InsertOneResult:
        taken = await is_held_elsewhere(collection=spielorte_collection, key="name", value=spielort_data.name, own_id=None, session=session)
        refuse(find_venue_name_refusal(taken=taken))
        created = await insert_live(
            collection=spielorte_collection,
            document={
                **spielort_data.model_dump(mode="json"),
                "maps_link": _maps_link(spielort_data.name, spielort_data.address),
            },
            session=session,
        )
        await record_act(
            collection=spielorte_collection, action="spielort.created", record_id=created.inserted_id, label=spielort_data.name, session=session
        )

        return created

    async with transaction_session(db) as session:
        post_operation = await session.with_transaction(enter_the_venue)

    return FLCreatedResponse(
        created_id=post_operation.inserted_id,
    )


@router.patch(
    by_id("spielort_id"),
    response_model=FLPatchSpielortResponse,
    summary="Update a Spielort",
)
async def patch_spielort(
    spielort_id: CustomRouteObjectId,
    spielort_data: Annotated[FLPatchSpielortPayload, Body()],
    spielorte_collection: SpielorteCollection,
    db: DBClient,
) -> FLPatchSpielortResponse:
    """Save a venue on the `version` it was read at, answering the version stored.

    Every fixture at the venue shows its new name and `maps_link`, and keeps the `mietpreis` agreed for it.
    """

    maps_link = _maps_link(spielort_data.name, spielort_data.address)

    async def save_the_venue(session: AsyncClientSession) -> FLPatchSpielortResponse:
        taken = await is_held_elsewhere(
            collection=spielorte_collection, key="name", value=spielort_data.name, own_id=spielort_id, session=session
        )
        refuse(find_venue_name_refusal(taken=taken))
        updated_document_raw = await patch_one_in_db(
            collection=spielorte_collection,
            db_filter={"_id": spielort_id},
            update={"$set": {**spielort_data.model_dump(mode="json", exclude={"version"}), "maps_link": maps_link}},
            expected_version=spielort_data.version,
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        await record_act(
            collection=spielorte_collection, action="spielort.changed", record_id=spielort_id, label=spielort_data.name, session=session
        )

        return FLPatchSpielortResponse(version=FLSpielort(**updated_document_raw).version)

    async with transaction_session(db) as session:
        return await session.with_transaction(save_the_venue)


@router.delete(
    by_id("spielort_id"),
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Deactivate a Spielort (soft delete)",
)
async def delete_spielort(
    spielort_id: CustomRouteObjectId,
    spielorte_collection: SpielorteCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> None:
    """Retire a venue, which stays readable for every match played there.

    Refused while an unplayed fixture is booked at it.
    """

    async def retire_the_venue(session: AsyncClientSession) -> None:
        """Judge the venue's unplayed fixtures, then stamp it. Everything judged is read in-session, so a retry re-judges it."""

        booked = await pull_many_from_db(
            collection=spiele_collection,
            db_filter=build_unplayed_booking_filter(spielort_id),
            projection={"spiel_nr": 1},
            session=session,
        )
        refuse(find_venue_retire_refusal(upcoming_spiel_nrs=sorted(int(row["spiel_nr"]) for row in booked)))

        retired = await set_inactive_since(collection=spielorte_collection, db_filter={"_id": spielort_id}, when=today, session=session)
        if retired is not None:
            await record_act(
                collection=spielorte_collection, action="spielort.retired", record_id=spielort_id, label=str(retired["name"]), session=session
            )

    # Soft, since a played match names the venue by id. The stamp inside the judgement's transaction, so a booking
    # committing after the read above conflicts on the venue it anchors rather than landing unseen.
    async with transaction_session(db) as session:
        await session.with_transaction(retire_the_venue)


@router.post(
    f"{by_id('spielort_id')}/reactivate",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Bring a deactivated Spielort back",
)
async def reactivate_spielort(
    spielort_id: CustomRouteObjectId,
    spielorte_collection: SpielorteCollection,
    db: DBClient,
) -> None:
    """Return a retired venue to every default read."""

    async def bring_the_venue_back(session: AsyncClientSession) -> None:
        revived = await set_inactive_since(collection=spielorte_collection, db_filter={"_id": spielort_id}, when=None, session=session)
        if revived is not None:
            await record_act(
                collection=spielorte_collection,
                action="spielort.reactivated",
                record_id=spielort_id,
                label=str(revived["name"]),
                session=session,
            )

    async with transaction_session(db) as session:
        await session.with_transaction(bring_the_venue_back)
