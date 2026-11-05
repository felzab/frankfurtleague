from collections.abc import Mapping
from typing import Any, Final


def is_confirmed(einwilligung: Any) -> bool:
    """Whether a consent record carries its own person's confirmation.

    In `shared`: every package judging a consent record reads it here, and a copy each is how one comes
    to grant what another refuses.
    """

    # `confirmed_at` alone: the one key a seat's `Kenntnisnahme` and a person's `Einwilligung` share. A seat's
    # record is null until its person answers.
    return isinstance(einwilligung, Mapping) and einwilligung.get("confirmed_at") is not None


# `app/api/spieler/services.py :: name_is_public` as a Mongo expression, here for `is_confirmed`'s reason: a pupil's
# squad read and a fixture's referee join both read it. By `$type`, as an absent key and a stored null are one state.
NAME_IS_PUBLIC: Final[Mapping[str, Any]] = {
    "$and": [
        {"$eq": [{"$type": "$einwilligung"}, "object"]},
        {"$eq": ["$einwilligung.scope", "kader_oeffentlich"]},
        {"$eq": [{"$type": "$einwilligung.confirmed_at"}, "string"]},
    ]
}
