from fastapi import APIRouter
from pymongo import DESCENDING

from app.api.action_log.schemas import FLActionLogByOptionsResponse, FLActionLogFilterPayload, FLActionLogListResponse
from app.api.action_log.services import build_action_log_query
from app.api.grants.guard import ADMIN_TIER
from app.core.crud import pull_many_from_db
from app.core.dependencies import ActionLogReadCollection
from app.core.routing import SAFE
from app.shared.schemas.bounds import ACTION_LOG_PAGE_SIZE

router = APIRouter(
    prefix="/action_log",
    dependencies=ADMIN_TIER,
)


# A POST that reads: `by` is an address and `q` whatever was typed, and a query string stands on every `http.answered`
# log line, where the log's scrubber reads no `%40`.
@router.post("/view", summary="List recorded acts", openapi_extra=SAFE)
async def get_action_log(action_log_collection: ActionLogReadCollection, filters: FLActionLogFilterPayload) -> FLActionLogListResponse:
    """The newest 50 acts the filters keep, starting after `cursor` where one is given."""

    # Paged by a range over `_id` rather than by a skip: no row repeats or drops at a seam, and no index is needed past
    # `_id`. One past the page, so whether another follows costs no count.
    read = await pull_many_from_db(
        collection=action_log_collection,
        db_filter=build_action_log_query(filters),
        limit=ACTION_LOG_PAGE_SIZE + 1,
        sort_by=[("_id", DESCENDING)],
    )
    served = read[:ACTION_LOG_PAGE_SIZE]

    return FLActionLogListResponse.model_validate(
        {"action_log": served, "cursor": served[-1]["_id"] if len(read) > ACTION_LOG_PAGE_SIZE else None}
    )


# A read of its own rather than a field of every page: a later page needs no options, and a chosen „Wer“ needs them
# before its one filtered read.
@router.get("/by_options", summary="List who acted in the log")
async def get_action_log_by_options(action_log_collection: ActionLogReadCollection) -> FLActionLogByOptionsResponse:
    """Every value `by` holds across the whole log, the who filter's options."""

    return FLActionLogByOptionsResponse(by_options=sorted(await action_log_collection.distinct("by")))
