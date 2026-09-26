from collections.abc import Mapping
from typing import Any


def is_confirmed(einwilligung: Any) -> bool:
    """Whether a consent record carries its own person's confirmation (`docs/backend/spec.md :: I387`).

    In `shared`: three packages read a seat's, a pupil's and a referee's record, and a copy each is how
    one comes to grant what another refuses.
    """

    # `bestaetigt_am` alone: the one key a seat's `Kenntnisnahme` and a person's `Einwilligung` share.
    stamp = einwilligung.get("bestaetigt_am") if isinstance(einwilligung, Mapping) else None

    # Only a non-empty string confirms: the validator types the stamp as a string or null, so `""` is
    # storable by a hand edit, and the public name read already withholds on it.
    return isinstance(stamp, str) and stamp != ""
