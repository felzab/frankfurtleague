import asyncio
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import DESCENDING

from app.api.action_log.schemas import FLActionLogFilterPayload, FLActionLogListResponse
from app.api.action_log.services import build_action_log_query
from app.api.grants.guard import verify_actor_is_admin
from app.core.config import API_VERSION
from app.core.crud import pull_many_from_db
from app.core.dependencies import ActionLogReadCollection
from app.core.routing import SAFE
from app.core.security import bind_actor, verify_access_admin
from app.shared.schemas.bounds import ACTION_LOG_PAGE_SIZE

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/action_log",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


# A POST that reads: `by` is an address and `q` whatever was typed, and a query string stands on every `http.answered`
# log line, where the log's scrubber reads no `%40`.
@router.post("/view", response_model=FLActionLogListResponse, summary="List recorded acts", openapi_extra=SAFE)
async def get_action_log(
    action_log_collection: ActionLogReadCollection, filters: Annotated[FLActionLogFilterPayload, Body()]
) -> FLActionLogListResponse:
    """The newest 50 acts the filters keep, starting after `cursor` where one is given."""

    # Paged by a range over `_id` rather than by a skip: no row repeats or drops at a seam, and no index is needed past
    # `_id`. One past the page, so whether another follows costs no count.
    read, by_options = await asyncio.gather(
        pull_many_from_db(
            collection=action_log_collection,
            db_filter=build_action_log_query(filters),
            limit=ACTION_LOG_PAGE_SIZE + 1,
            sort_by=[("_id", DESCENDING)],
        ),
        action_log_collection.distinct("by"),
    )
    served = read[:ACTION_LOG_PAGE_SIZE]

    return FLActionLogListResponse.model_validate(
        {"action_log": served, "cursor": served[-1]["_id"] if len(read) > ACTION_LOG_PAGE_SIZE else None, "by_options": sorted(by_options)}
    )
