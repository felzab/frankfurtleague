from collections.abc import Sequence
from datetime import date, datetime, time
from typing import Any, get_args

from app.api.action_log.schemas import FLActionLogFilterPayload
from app.core import clock
from app.core.crud import literal_pattern
from app.core.recording import FLAction, FLActionType


def _actions_of(types: Sequence[FLActionType]) -> list[str]:
    """Every action of these categories: the category is the name's first half, and no stored field."""

    return [action for action in get_args(FLAction.__value__) if action.split(".")[0] in types]


def _german_midnight(day: date) -> datetime:
    """Where a German day starts, as the instant a stored `at` compares with across either clock change."""

    return datetime.combine(day, time(), tzinfo=clock.GERMANY)


def build_action_log_query(filters: FLActionLogFilterPayload) -> dict[str, Any]:
    """The read's whole filter: `by` an equality, and each other term compiled, as none is stored as it is asked."""

    query: dict[str, Any] = {} if filters.by is None else {"by": filters.by}
    if filters.cursor is not None:
        query["_id"] = {"$lt": filters.cursor}
    if filters.type is not None:
        query["action"] = {"$in": _actions_of(filters.type)}
    if filters.from_day is not None:
        query["at"] = {"$gte": _german_midnight(filters.from_day)}
    # A blank search is none: an empty pattern would keep only the rows holding a team or a label.
    if filters.q is not None and filters.q.strip():
        pattern = {"$regex": literal_pattern(filters.q.strip()), "$options": "i"}
        query["$or"] = [{"team": pattern}, {"label": pattern}]

    return query
