from collections.abc import Mapping
from typing import Any


def build_key_filter(*, key: str) -> Mapping[str, Any]:
    """The key lookup, carrying the unique index's partial term.

    An equality alone does not imply `$type`, so without the term the planner scans the whole collection.
    """

    return {"idempotency_key": {"$eq": key, "$type": "string"}}
