from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.results import InsertOneResult

from app.api.berechtigungen.crud import pull_the_list_to_judge, read_berechtigungen
from app.api.berechtigungen.schemas import (
    FLBerechtigung,
    FLBerechtigungenListResponse,
    FLBerechtigungWriteResponse,
    FLPostBerechtigungPayload,
    FLPostBerechtigungResponse,
)
from app.api.berechtigungen.services import find_gesperrt_refusal, find_inhaber_refusal, find_mindestzahl_refusal, find_vorhanden_refusal
from app.api.saisons.crud import pull_massgebliche_saison_id
from app.api.sperrliste.crud import address_is_gesperrt
from app.api.sperrliste.services import adresse_hash
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import delete_many_from_db, post_one_to_db, refuse
from app.core.dependencies import BerechtigungenCollection, DBClient, SaisonsCollection, SperrlisteCollection, get_germany_now
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import bind_actor, get_actor_email, verify_access_admin, verify_actor_is_admin
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/berechtigungen",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)

# The one tier a request grants: `owner` is written in the database directly and nowhere here.
ADMINISTRATION = "administration"


@router.get("", response_model=FLBerechtigungenListResponse, summary="List who may enter the administration")
async def get_berechtigungen(berechtigungen_collection: BerechtigungenCollection) -> FLBerechtigungenListResponse:
    """
    List every grant of access to the administration, by address: its tier, who granted it and when.

    Uncapped, as few people hold one. `erteilt_von` is an administrator's address for a grant made here, and whatever the database
    edit wrote for one made there, so it says nothing about how the grant was made.
    """

    rows = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection)

    return FLBerechtigungenListResponse(berechtigungen=[FLBerechtigung.model_validate(row) for row in rows])


@router.post(
    "",
    response_model=FLPostBerechtigungResponse,
    status_code=201,
    summary="Grant access to the administration",
    responses={409: DUPLICATE_KEY_RESPONSE},
)
async def post_berechtigung(
    berechtigung_data: Annotated[FLPostBerechtigungPayload, Body()],
    berechtigungen_collection: BerechtigungenCollection,
    sperrliste_collection: SperrlisteCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    erteilt_von: str = Depends(get_actor_email),
    now: datetime = Depends(get_germany_now),
) -> FLPostBerechtigungResponse:
    """
    Grant an address access to the administration, as `administration`. No request grants `owner`.

    The address is stored folded to its sign-in identifier, the spelling every admin-tier request is judged by. Refused where the
    address already holds a grant of either tier (`REQ-BERECHTIGUNG-001`), and where the ban list holds it (`REQ-BERECHTIGUNG-003`):
    lifting the ban comes first. The grant takes effect on the next request, and nobody is told of it by this call: the
    reconciliation at `POST /berechtigungen/abgleich` names it, with the administrator who made it.
    """

    adresse = sign_in_identifier(str(berechtigung_data.email))
    # Keyed from the payload's own value, as the ban write keys it (`app/api/identitaet/router.py :: get_subjekt`).
    gehasht = adresse_hash(str(berechtigung_data.email), schluessel=config.sperrliste_schluessel)

    async def judge_and_grant(session: AsyncClientSession) -> InsertOneResult:
        """Anchor and read the list, ask the ban list, then write. Each takes this transaction's session, so a retry re-runs all of them."""

        grants = await pull_the_list_to_judge(berechtigungen_collection=berechtigungen_collection, session=session)
        refuse(find_vorhanden_refusal(adresse=adresse, grants=grants))

        gesperrt = await address_is_gesperrt(
            sperrliste_collection=sperrliste_collection,
            adresse_hash=gehasht,
            massgebliche_saison_id=await pull_massgebliche_saison_id(saisons_collection=saisons_collection, session=session),
            session=session,
        )
        refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        document: dict[str, Any] = {
            "adresse": adresse,
            "verwaltung": ADMINISTRATION,
            # The bound actor rather than a payload field, so the grant and its `aktionen` row name one person.
            "erteilt_von": erteilt_von,
            "erteilt_am": now,
        }

        return await post_one_to_db(collection=berechtigungen_collection, document=document, session=session)

    async with db.start_session() as session:
        post_operation = await session.with_transaction(judge_and_grant)

    return FLPostBerechtigungResponse(acknowledged=1 if post_operation.acknowledged else 0, created_id=post_operation.inserted_id)


@router.delete(
    by_id("berechtigung_id"),
    response_model=FLBerechtigungWriteResponse,
    summary="Revoke access to the administration",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def delete_berechtigung(
    berechtigung_id: CustomRouteObjectId,
    berechtigungen_collection: BerechtigungenCollection,
    db: DBClient,
) -> FLBerechtigungWriteResponse:
    """
    Revoke one grant, removing the row. HARD, no soft form; the revoked address meets `REQ-AUTH-006` on its next request.

    Refused for an `owner` row (`REQ-BERECHTIGUNG-002`), which is changed in the database directly, and where fewer than two grants
    would remain, any `owner` grant counted among them (`REQ-BERECHTIGUNG-004`). An administrator may revoke their own grant on the same
    terms. 404 where no grant has the id. The action log keeps the removed row, address included, and the reconciliation names the
    revoke with the administrator who made it.
    """

    async def judge_and_revoke(session: AsyncClientSession) -> None:
        """Anchor and read the list, judge the row against it, then remove it. Each takes this transaction's session, so a retry re-judges."""

        grants = await pull_the_list_to_judge(berechtigungen_collection=berechtigungen_collection, session=session)

        grant = next((row for row in grants if row["_id"] == berechtigung_id), None)
        if grant is None:
            # Resolved from the list already read rather than a second query, so a miss is a 404 before
            # anything is removed: `delete_many_from_db` taking no row would answer 200.
            raise DocumentNotFoundException(filter={"_id": berechtigung_id}, error_code=DOCUMENT_NOT_FOUND)

        refuse(find_inhaber_refusal(grant=grant))
        refuse(find_mindestzahl_refusal(remaining=len(grants) - 1))

        await delete_many_from_db(collection=berechtigungen_collection, db_filter={"_id": berechtigung_id}, session=session)

    async with db.start_session() as session:
        await session.with_transaction(judge_and_revoke)

    return FLBerechtigungWriteResponse(berechtigung_id=berechtigung_id)
