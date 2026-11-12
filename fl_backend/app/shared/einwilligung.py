from collections.abc import Mapping
from typing import Any, Final


def is_confirmed(einwilligung: Any) -> bool:
    """Whether a consent record carries its own person's confirmation.

    One judgement for every package, since a copy each lets one grant what another refuses.
    """

    # `confirmed_at` alone: the one key a seat's `Kenntnisnahme` and a person's `Einwilligung` share. A seat's
    # record is null until its person answers.
    return isinstance(einwilligung, Mapping) and einwilligung.get("confirmed_at") is not None


# `name_is_public` as a Mongo expression, kept equal to it, and shared so no two reads judge a name apart. By `$type`,
# as an absent key and a stored null are one state.
NAME_IS_PUBLIC: Final[Mapping[str, Any]] = {
    "$and": [
        {"$eq": [{"$type": "$einwilligung"}, "object"]},
        {"$eq": ["$einwilligung.scope", "kader_public"]},
        {"$eq": [{"$type": "$einwilligung.confirmed_at"}, "string"]},
    ]
}
