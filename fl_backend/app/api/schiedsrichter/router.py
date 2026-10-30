from fastapi import APIRouter, Depends

from app.api.adresswechsel.crud import verwehrte_adressen
from app.api.adresswechsel.services import build_address_filter
from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.schiedsrichter.schemas import (
    FLSchiedsrichter,
    FLSchiedsrichterFilterParams,
    FLSchiedsrichterListAdapter,
    FLSchiedsrichterListResponse,
    FLSchiedsrichterSingleResponse,
)
from app.api.schiedsrichter.services import (
    BESTAETIGUNG_FELD,
    build_real_referees_filter,
    build_referee_filter,
    frist_abgelaufen,
)
from app.core.config import API_VERSION
from app.core.crud import GERMAN_COLLATION, build_query, build_sort, pull_many_from_db, pull_one_from_db
from app.core.dependencies import (
    AdresswechselCollection,
    BerechtigungenAngekuendigtCollection,
    BerechtigungenCollection,
    SchiedsrichterCollection,
    get_german_date_str,
)
from app.core.routing import by_id
from app.core.security import bind_actor, get_actor_auth_time, get_actor_email, verify_access_admin
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomRouteObjectId

# Admin-guarded, not base: a referee is a pupil, so their contact details and school are admin-tier
# (`READ-CONTACT-001`), as is the fee (`READ-MONEY-001`).
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


@router.get("", response_model=FLSchiedsrichterListResponse, summary="List Schiedsrichter")
async def get_schiedsrichter(
    schiedsrichter_collection: SchiedsrichterCollection,
    filters: FLSchiedsrichterFilterParams = Depends(),
) -> FLSchiedsrichterListResponse:
    """
    An admin-tier read: a referee is a pupil, so their contact and school are private (`READ-CONTACT-001`).

    The fee is admin-tier as money, not as a pupil's detail (`READ-MONEY-001`). Deactivated ones
    stay retrievable for a historical match.

    The ghost is OFF this list whatever the query string asks for: no person stands behind it, so
    there is nothing an administrator could book it for, edit on it or reactivate it into
    (`app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`).
    """

    schiedsrichter_raw = await pull_many_from_db(
        collection=schiedsrichter_collection,
        db_filter=build_query(
            filters,
            terms={"default_payment"},
            include_inactive=filters.include_inactive,
            compiled=build_real_referees_filter(),
        ),
        limit=filters.limit,
        sort_by=build_sort(sort_by=filters.sort_by, order=filters.order),
        collation=GERMAN_COLLATION,
    )

    return FLSchiedsrichterListResponse(schiedsrichter=FLSchiedsrichterListAdapter.validate_python(schiedsrichter_raw))


@router.get(
    by_id("schiedsrichter_id"),
    response_model=FLSchiedsrichterSingleResponse,
    summary="One Schiedsrichter",
)
async def get_schiedsrichter_by_id(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    adresswechsel_collection: AdresswechselCollection,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    today: str = Depends(get_german_date_str),
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
) -> FLSchiedsrichterSingleResponse:
    """Admin-tier as the list is, and for the same two rules (`READ-CONTACT-001`, `READ-MONEY-001`).

    Deactivated ones included -- a historical match references them by id. The ghost answers 404, as
    does an id whose referee has been erased: the document is gone
    (`app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`).

    Answers whether the consent link's deadline has passed today, by the rule its press refuses on, so the editor marks a
    lapsed link without reading a clock of its own; and the live change of the referee's address, which the address tool shows,
    beside why the tool refuses it this administrator, null where it opens it.
    """

    schiedsrichter_raw = await pull_one_from_db(collection=schiedsrichter_collection, db_filter=build_referee_filter(schiedsrichter_id))
    email = (schiedsrichter_raw.get("kontakt") or {}).get("email")
    identifier = sign_in_identifier(email) if isinstance(email, str) else None
    offen = None if identifier is None else await adresswechsel_collection.find_one(build_address_filter(identifier), {"_id": 1})
    verwehrt = await verwehrte_adressen(
        [] if offen is None or identifier is None else [identifier],
        akteur=sign_in_identifier(operator),
        auth_time=auth_time,
        berechtigungen_collection=berechtigungen_collection,
        berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
        session=None,
    )

    return FLSchiedsrichterSingleResponse(
        schiedsrichter=FLSchiedsrichter(**schiedsrichter_raw),
        bestaetigung_abgelaufen=frist_abgelaufen(schiedsrichter_raw.get(BESTAETIGUNG_FELD), today=today),
        adresswechsel_id=None if offen is None else offen["_id"],
        adresswechsel_einsehbar_verwehrt=None if identifier is None else verwehrt.get(identifier),
    )
