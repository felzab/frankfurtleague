from datetime import UTC, datetime
from typing import Any

import pytest

from app.api.action_log.schemas import FLActionLogFilterPayload
from app.api.action_log.services import build_action_log_query
from app.core.config import API_VERSION
from tests.core.app_source import application

# Escaped, so a typed bracket finds a bracket: left raw it is a group that matches rows it should not, or a pattern the server refuses.
ADLER_U17: dict[str, Any] = {"$regex": r"Adler\ \(U17\)", "$options": "i"}


def utc(month: int, day: int, hour: int) -> datetime:
    return datetime(2026, month, day, hour, tzinfo=UTC)


@pytest.mark.parametrize(
    ("filters", "query"),
    [
        pytest.param(
            {"from_day": "2026-07-01"},
            {"at": {"$gte": utc(6, 30, 22)}},
            id="a summer day, two hours ahead of UTC",
        ),
        pytest.param(
            {"from_day": "2026-01-15"},
            {"at": {"$gte": utc(1, 14, 23)}},
            id="a winter day, one hour ahead",
        ),
        pytest.param(
            {"from_day": "2026-03-29"},
            {"at": {"$gte": utc(3, 28, 23)}},
            id="the day the clock moves, which starts an hour ahead",
        ),
        pytest.param(
            {"q": " Adler (U17) "},
            {"$or": [{"team": ADLER_U17}, {"label": ADLER_U17}]},
            id="a metacharacter in the search",
        ),
        pytest.param({"q": "   "}, {}, id="a blank search, which is none"),
        pytest.param(
            {"type": ["ban", "address_change"]},
            {"action": {"$in": ["ban.added", "ban.removed", "address_change.started", "address_change.discarded"]}},
            id="the type's expansion",
        ),
        pytest.param({"by": "kontakt"}, {"by": "kontakt"}, id="who, an equality"),
    ],
)
def test_a_filter_compiles_to_what_the_store_compares(filters: dict[str, Any], query: dict[str, Any]):
    """A wrong term hides rows and nothing fails: the page reads as a shorter log."""

    assert build_action_log_query(FLActionLogFilterPayload.model_validate(filters)) == query


def test_the_read_puts_nothing_in_a_query_string():
    """`http.answered` logs a query string and the scrubber reads no `%40`, so a filter there keeps an address for 30 days."""

    operation = application().openapi()["paths"][f"/api/v{API_VERSION}/action_log/view"]["post"]

    assert [parameter for parameter in operation.get("parameters", []) if parameter["in"] == "query"] == []
