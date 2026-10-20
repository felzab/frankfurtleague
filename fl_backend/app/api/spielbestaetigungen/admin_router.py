from collections.abc import Mapping
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Query
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigung,
    FLSpielbestaetigungEintragenPayload,
    FLSpielbestaetigungEintragenResponse,
    FLSpielbestaetigungenFilterParams,
    FLSpielbestaetigungenListResponse,
    FLSpielbestaetigungVerwerfenResponse,
)
from app.api.spielbestaetigungen.services import (
    ADMIN_FIELDS,
    build_answerable_filter,
    build_verwerfbar_filter,
    compose_closing_update,
    compose_eintragen_update,
    eintragen_refusal,
    find_eintragen_refusal,
    find_verwerfen_refusal,
    verwerfen_refusal,
)
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, pull_many_from_db, pull_one_from_db, refuse
from app.core.dependencies import DBClient, SaisonsCollection, SpielbestaetigungenCollection, get_german_date_str
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE
from app.core.exceptions import DocumentNotFoundException, WriteRefusalException
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin, verify_actor_is_admin, verify_step_up
from app.core.transactions import transaction_session
from app.shared.schemas.bounds import LIST_LIMIT_MAX
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielbestaetigungen",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)

FLSpielbestaetigungenFilters = Annotated[FLSpielbestaetigungenFilterParams, Query()]


@router.get(
    "",
    response_model=FLSpielbestaetigungenListResponse,
    summary="A season's fixture confirmations, or one fixture's",
)
async def get_spielbestaetigungen(
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    saisons_collection: SaisonsCollection,
    filters: FLSpielbestaetigungenFilters,
) -> FLSpielbestaetigungenListResponse:
    """
    Every confirmation row of the season, or of its one fixture, and the day the confirmation pass last ran over it.

    Newest first, closed rows included. No seat's link hashes and no answer's holder digest are served.
    `vollstaendig` is false where more rows exist than one read serves, the oldest being the ones left out. A season no
    document has answers no rows and a null day rather than 404.
    """

    db_filter: dict[str, Any] = {"saison_id": filters.saison_id}
    if filters.spiel_id is not None:
        db_filter["spiel_id"] = filters.spiel_id

    # One row over what is served, and the extra never is: it answers whether the list is whole without a count.
    read = await pull_many_from_db(
        collection=spielbestaetigungen_collection,
        db_filter=db_filter,
        limit=LIST_LIMIT_MAX + 1,
        # Rows carry no creation stamp; an ObjectId's leading bytes are its insert time.
        sort_by=[("_id", -1)],
        projection=ADMIN_FIELDS,
    )
    saison = await saisons_collection.find_one({"_id": filters.saison_id}, {"spiel_sweep_gelaufen_am": 1})

    return FLSpielbestaetigungenListResponse(
        spielbestaetigungen=[FLSpielbestaetigung.model_validate(row) for row in read[:LIST_LIMIT_MAX]],
        spiel_sweep_gelaufen_am=(saison or {}).get("spiel_sweep_gelaufen_am"),
        vollstaendig=len(read) <= LIST_LIMIT_MAX,
    )


@router.post(
    f"{by_id('spielbestaetigung_id')}/eintragen",
    response_model=FLSpielbestaetigungEintragenResponse,
    summary="Record a party's Zusage on its behalf",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
    dependencies=[Depends(verify_step_up)],
)
async def eintragen_spielbestaetigung(
    spielbestaetigung_id: CustomRouteObjectId,
    eintragen_data: Annotated[FLSpielbestaetigungEintragenPayload, Body()],
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielbestaetigungEintragenResponse:
    """
    Record that the party of an open confirmation agreed to its Ansetzung elsewhere than through its link.

    The administrator's reason says how. IRREVERSIBLE: the answer is the league's record of how a date was agreed, and
    nothing rewrites it. It names nobody: no seat and no person is recorded, and the reason takes any text and goes at
    the season's end. Refused for a row
    already answered, by a seat or by an administrator, or closed (`REQ-ANSETZUNG-013`), including one a seat answers
    while this request runs: of the two answers exactly one is stored. A row about an Ansetzung the fixture has since
    left is settled as asked, and the next confirmation pass closes it.
    """

    async def settle_for_the_party(session: AsyncClientSession) -> Mapping[str, Any]:
        row = await pull_one_from_db(
            collection=spielbestaetigungen_collection,
            db_filter={"_id": spielbestaetigung_id},
            projection=["antwort", "geschlossen"],
            session=session,
        )
        refuse(find_eintragen_refusal(spielbestaetigung_raw=row))

        try:
            # The state term too, as a seat's press writes: whichever of two answers writes second matches nothing.
            return await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": spielbestaetigung_id, **build_answerable_filter()},
                update=compose_eintragen_update(begruendung=eintragen_data.begruendung, today=today),
                session=session,
                return_document=ReturnDocument.AFTER,
            )
        except DocumentNotFoundException as miss:
            raise WriteRefusalException(eintragen_refusal()) from miss

    async with transaction_session(db) as session:
        updated_raw = await session.with_transaction(settle_for_the_party)

    return FLSpielbestaetigungEintragenResponse(updated_document=FLSpielbestaetigung.model_validate(updated_raw))


@router.post(
    f"{by_id('spielbestaetigung_id')}/verwerfen",
    response_model=FLSpielbestaetigungVerwerfenResponse,
    summary="Discard a club's proposed date",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
    dependencies=[Depends(verify_step_up)],
)
async def verwerfen_spielbestaetigung(
    spielbestaetigung_id: CustomRouteObjectId,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielbestaetigungVerwerfenResponse:
    """
    Close a club's open decline that proposes another date, so the proposal stops asking the administrator to act.

    IRREVERSIBLE: the decline stays as the club gave it, and the row is closed `verworfen`, which is that club's one
    answer to this Ansetzung: the confirmation pass never asks it about this Ansetzung again, and the public fixture
    counts it as the club's agreement, the league having kept the date. Refused for any other row -- open, agreed,
    declined without a proposal, a referee's, or closed (`REQ-ANSETZUNG-014`).
    """

    async def discard_the_proposal(session: AsyncClientSession) -> Mapping[str, Any]:
        row = await pull_one_from_db(
            collection=spielbestaetigungen_collection,
            db_filter={"_id": spielbestaetigung_id},
            projection=["partei", "antwort", "geschlossen"],
            session=session,
        )
        refuse(find_verwerfen_refusal(spielbestaetigung_raw=row))

        try:
            return await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": spielbestaetigung_id, **build_verwerfbar_filter()},
                update=compose_closing_update(grund="verworfen", today=today),
                session=session,
                return_document=ReturnDocument.AFTER,
            )
        except DocumentNotFoundException as miss:
            raise WriteRefusalException(verwerfen_refusal()) from miss

    async with transaction_session(db) as session:
        updated_raw = await session.with_transaction(discard_the_proposal)

    return FLSpielbestaetigungVerwerfenResponse(updated_document=FLSpielbestaetigung.model_validate(updated_raw))
