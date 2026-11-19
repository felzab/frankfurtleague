from collections.abc import Mapping
from typing import Any, Final


def season_has_ended(*, saison_status: Any) -> bool:
    """Whether a season is over, read off `saisons.status` rather than computed from a date; a season not yet created is not past."""

    return saison_status == "past"


# `season_has_ended`'s negation for a read that narrows in the query. Every write stores a season's status, which is why
# the readers of this filter's rows subscript it.
SAISON_NOT_ENDED_FILTER: Final[Mapping[str, Any]] = {"status": {"$ne": "past"}}
