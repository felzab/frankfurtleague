from datetime import datetime

from fastapi import APIRouter, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.grants.crud import complete_the_handover_in_session, pull_the_list_to_judge, read_grants
from app.api.grants.schemas import FLGrantHandoverPassResponse
from app.api.grants.services import handover_due
from app.core.config import API_VERSION
from app.core.dependencies import DBClient, GrantsCollection, OutboxCollection, get_germany_now
from app.core.security import verify_access_system
from app.core.transactions import transaction_session

# System tier, as the application sweep's own router is: the pass holds no session.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/grants/handover",
    dependencies=[Depends(verify_access_system)],
)


@router.post(
    "",
    response_model=FLGrantHandoverPassResponse,
    summary="Complete a handover whose wait has ended",
)
async def post_handover_pass(
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    now: datetime = Depends(get_germany_now),
) -> FLGrantHandoverPassResponse:
    """
    Move the owner role to the row whose `owner_from` has passed, the old owner staying an administrator, and tell every holder.

    Late rather than early where a pass is missed: nothing moves until one runs, and a quiet pass writes nothing.
    """

    async def judge_and_complete(session: AsyncClientSession) -> int:
        """Judge the list in this transaction, then anchor it, so a stop or a removal beside the pass conflicts and is judged afresh."""

        due = handover_due(await read_grants(grants_collection=grants_collection, session=session), now)
        if due is None:
            return 0

        await pull_the_list_to_judge(grants_collection=grants_collection, session=session)
        await complete_the_handover_in_session(
            due, grants_collection=grants_collection, outbox_collection=outbox_collection, now=now, session=session
        )

        return 1

    async with transaction_session(db) as session:
        handed_over = await session.with_transaction(judge_and_complete)

    return FLGrantHandoverPassResponse(handed_over=handed_over)
