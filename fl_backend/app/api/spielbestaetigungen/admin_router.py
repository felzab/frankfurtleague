from collections.abc import Mapping
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Query
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.spielbestaetigungen.crud import pull_admin_rows
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigung,
    FLSpielbestaetigungEintragenPayload,
    FLSpielbestaetigungenFilterParams,
    FLSpielbestaetigungenListResponse,
    FLSpielbestaetigungWriteResponse,
)
from app.api.spielbestaetigungen.services import (
    ANSETZUNG_QUELLEN,
    build_answerable_filter,
    build_verwerfbar_filter,
    compose_closing_update,
    compose_eintragen_update,
    eintragen_refusal,
    find_eintragen_refusal,
    find_verwerfen_refusal,
    verwerfen_owes_a_notice,
    verwerfen_refusal,
)
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, pull_one_from_db, refuse
from app.core.dependencies import DBClient, SpielbestaetigungenCollection, SpieleCollection, get_german_date_str
from app.core.exceptions import DocumentNotFoundError
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin, verify_step_up
from app.core.transactions import transaction_session
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
    filters: FLSpielbestaetigungenFilters,
) -> FLSpielbestaetigungenListResponse:
    """
    Every confirmation row of the season, or of its one fixture.

    Newest first, closed rows included. No seat's link hashes and no answer's holder digest are served. Every row still
    holding its party's question is served; `limit` cuts the others, and `vollstaendig` is false where it left the
    oldest of them out. A season no document has answers no rows rather than 404.
    """

    db_filter: dict[str, Any] = {"saison_id": filters.saison_id}
    if filters.spiel_id is not None:
        db_filter["spiel_id"] = filters.spiel_id

    rows, vollstaendig = await pull_admin_rows(
        spielbestaetigungen_collection=spielbestaetigungen_collection, db_filter=db_filter, limit=filters.limit
    )

    return FLSpielbestaetigungenListResponse(
        spielbestaetigungen=[FLSpielbestaetigung.model_validate(row) for row in rows],
        vollstaendig=vollstaendig,
    )


@router.post(
    f"{by_id('spielbestaetigung_id')}/eintragen",
    response_model=FLSpielbestaetigungWriteResponse,
    summary="Record a party's Zusage on its behalf",
    dependencies=[Depends(verify_step_up)],
)
async def eintragen_spielbestaetigung(
    spielbestaetigung_id: CustomRouteObjectId,
    eintragen_data: Annotated[FLSpielbestaetigungEintragenPayload, Body()],
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielbestaetigungWriteResponse:
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
            # The state term as a seat's press writes it. A seat's answer committing under
            # this one conflicts with the write instead, and the retry's read above refuses.
            return await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": spielbestaetigung_id, **build_answerable_filter()},
                update=compose_eintragen_update(begruendung=eintragen_data.begruendung, today=today),
                session=session,
                return_document=ReturnDocument.AFTER,
            )
        except DocumentNotFoundError as miss:
            raise eintragen_refusal().error() from miss

    async with transaction_session(db) as session:
        updated_raw = await session.with_transaction(settle_for_the_party)

    return FLSpielbestaetigungWriteResponse(updated_document=FLSpielbestaetigung.model_validate(updated_raw))


@router.post(
    f"{by_id('spielbestaetigung_id')}/verwerfen",
    response_model=FLSpielbestaetigungWriteResponse,
    summary="Discard a club's proposed date",
    dependencies=[Depends(verify_step_up)],
)
async def verwerfen_spielbestaetigung(
    spielbestaetigung_id: CustomRouteObjectId,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielbestaetigungWriteResponse:
    """
    Close a club's open decline that proposes another date, so the proposal stops asking the administrator to act.

    IRREVERSIBLE: the decline stays as the club gave it, and the row is closed `verworfen`, which is that club's one
    answer to this Ansetzung: the confirmation pass never asks it about this Ansetzung again, and the public fixture
    counts it as the club's agreement, the league having kept the date, until a pass closes it again as it closes an
    agreement beside it. Where its day is still to come, the row holds the club a notice that the date stands, which
    the confirmation pass mails. Refused for any other row -- open, agreed, declined without a proposal, a referee's, closed, or
    about an Ansetzung the fixture has left, the fixture moving while this request runs included (`REQ-ANSETZUNG-014`):
    the confirmation pass closes that row and tells its club of the move.
    """

    async def judged(row: Mapping[str, Any], session: AsyncClientSession | None) -> None:
        spiel = await pull_one_from_db(
            collection=spiele_collection, db_filter={"_id": row["spiel_id"]}, projection=list(ANSETZUNG_QUELLEN.values()), session=session
        )
        refuse(find_verwerfen_refusal(spielbestaetigung_raw=row, spiel=spiel))

    async def discard_the_proposal(session: AsyncClientSession) -> Mapping[str, Any]:
        row = await pull_one_from_db(
            collection=spielbestaetigungen_collection,
            db_filter={"_id": spielbestaetigung_id},
            projection=["spiel_id", "partei", "ansetzung.stand", "ansetzung.datum", "antwort", "geschlossen"],
            session=session,
        )
        await judged(row, session)

        try:
            discarded = await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": spielbestaetigung_id, **build_verwerfbar_filter()},
                update=compose_closing_update(grund="verworfen", today=today, mitteilung=verwerfen_owes_a_notice(row=row, today=today)),
                session=session,
                return_document=ReturnDocument.AFTER,
            )
        except DocumentNotFoundError as miss:
            raise verwerfen_refusal().error() from miss

        # The fixture is judged and not written, so a move landing under this transaction raises no conflict: judged
        # again outside it before answering.
        await judged(row, None)

        return discarded

    async with transaction_session(db) as session:
        updated_raw = await session.with_transaction(discard_the_proposal)

    return FLSpielbestaetigungWriteResponse(updated_document=FLSpielbestaetigung.model_validate(updated_raw))
