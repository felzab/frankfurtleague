import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pymongo import DESCENDING

from app.api.action_log.schemas import FLActionLogFilterParams, FLActionLogListResponse
from app.api.action_log.services import build_action_log_query
from app.api.grants.guard import verify_actor_is_admin
from app.core.config import API_VERSION
from app.core.crud import pull_many_from_db
from app.core.dependencies import ActionLogCollection
from app.core.security import bind_actor, verify_access_admin
from app.shared.schemas.bounds import ACTION_LOG_PAGE_SIZE

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/action_log",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)

# `Query()` and never `Depends()`: on a `Depends()` model a `list` field is read as a BODY field, so
# it publishes no query parameter at all and answers `None` whatever the query string holds.
FLActionLogFilters = Annotated[FLActionLogFilterParams, Query()]


@router.get("", response_model=FLActionLogListResponse, summary="List recorded acts")
async def get_action_log(action_log_collection: ActionLogCollection, filters: FLActionLogFilters) -> FLActionLogListResponse:
    """The newest 50 acts the filters keep, after `cursor` where one is given, with where the next page starts and no count.

    `_id` orders them, the manual's own range pagination (`cursor.skip`'s page): no row repeats or drops at a seam, and no
    index is needed past `_id`. `by_options` is every `by` the log holds, whatever the filters keep.
    """

    # One past the page, so whether another follows costs no count.
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
