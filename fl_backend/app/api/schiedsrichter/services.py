from collections.abc import Mapping, Sequence
from typing import Any

from app.api.spiele.schemas import unplayed_filter
from app.core.collections import Collection
from app.core.exceptions import WriteRefusal
from app.core.sentinels import GHOST_INACTIVE_SINCE, GHOST_SCHIEDSRICHTER_ID
from app.shared.schemas.kontakt import FLKontakt

# A played fixture never blocks: its `schiedsrichter` is a record of who officiated.
REFEREE_STILL_ASSIGNED = "REQ-RETIRE-004"

# Its own code rather than the 404 every other endpoint answers for this id: an administrator who
# reached the ghost is owed the reason it cannot be erased, not the claim that it is not there.
GHOST_ERASED = "REQ-ANONYMISE-004"


def build_ghost_schiedsrichter() -> dict[str, Any]:
    """The row an erased referee's fixtures are repointed to, as it is first written.

    Retired, so `REQ-BOOKING-001` refuses it every new fixture under the rule a retired referee
    already meets rather than under one written for the ghost.
    """

    return {
        "_id": GHOST_SCHIEDSRICHTER_ID,
        "name": None,
        "schule": None,
        # Zero rather than a rate: no fee was ever agreed with nobody, and each fixture keeps the
        # `payment` it recorded (`docs/backend/spec.md :: I6`).
        "default_payment": 0,
        # Read off the model, so a contact field added later arrives null here rather than missing.
        "kontakt": dict.fromkeys(FLKontakt.model_fields),
        "inactive_since": GHOST_INACTIVE_SINCE,
    }


# The one term excluding the ghost, spelled once for the list read and for the by-id filter below.
_NOT_THE_GHOST: Mapping[str, Any] = {"$ne": GHOST_SCHIEDSRICHTER_ID}


def build_real_referees_filter() -> Mapping[str, Any]:
    """Every referee a person stands behind, which is the whole collection but the ghost."""

    return {"_id": dict(_NOT_THE_GHOST)}


def build_referee_filter(schiedsrichter_id: Any) -> Mapping[str, Any]:
    """One real referee by id, answering nothing for the ghost.

    One spelling for the read, the edit, the retirement and the reactivation: reached by any, the
    ghost takes a name onto every erased referee's fixtures or returns to the picker.
    """

    return {"_id": {"$eq": schiedsrichter_id, **_NOT_THE_GHOST}}


def build_assignment_filter(schiedsrichter_id: Any) -> Mapping[str, Any]:
    """Every fixture naming this referee, played or not — the set the erasure repoints."""

    return {"schiedsrichter.schiedsrichter_id": schiedsrichter_id}


def build_unplayed_assignment_filter(schiedsrichter_id: Any) -> Mapping[str, Any]:
    """Every fixture this referee holds that is still to be played, which is what the retirement's refusal judges.

    Composed from `build_assignment_filter` rather than spelled again, so the path cannot be
    narrowed on one seam alone.
    """

    return {**build_assignment_filter(schiedsrichter_id), **unplayed_filter()}


def build_ghost_repoint() -> Mapping[str, Any]:
    """What a fixture's booking becomes once the person behind it is deleted.

    `payment` stays: it records what THIS match agreed (`docs/backend/spec.md :: I6`). The ghost has
    no name, and every surface reads a null one.
    """

    return {"$set": {"schiedsrichter.schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID, "schiedsrichter.name": None}}


def build_booked_image_filter(schiedsrichter_id: Any) -> Mapping[str, Any]:
    """Every `spiele` log row whose pre-image names this referee.

    Selected inside the image rather than by the fixtures they hold today: a reassigned fixture, and a
    removed one, each leave an image naming them that no id can reach.
    """

    # `collection` first, the one half an index serves — nothing indexes inside `before`, as the
    # contact erasure's orphan sweep also finds
    # (`app/api/kontakte/services.py :: build_orphaned_image_filter`). A `delete_many` row's image is
    # an ARRAY, matched on its members.
    return {"collection": str(Collection.SPIELE), "before.schiedsrichter.schiedsrichter_id": schiedsrichter_id}


def first_stamped(*, stored: Mapping[str, Any], field: str, today: str) -> str:
    """The day already stamped, or today.

    A second press of the retirement would otherwise move the day a referee stopped officiating,
    which is the day a fee is reconciled against.
    """

    stamped = stored.get(field)

    return today if stamped is None else str(stamped)


def find_ghost_erasure_refusal(*, schiedsrichter_id: Any) -> WriteRefusal | None:
    """Why erasing this id must be refused, or `None`."""

    if schiedsrichter_id != GHOST_SCHIEDSRICHTER_ID:
        return None

    return WriteRefusal(
        error_code=GHOST_ERASED,
        message=(
            "this row stands behind nobody: it is what the fixtures of every already-erased referee name, so it holds "
            "no personal data to delete and deleting it would leave those fixtures naming a referee that is gone"
        ),
    )


def find_referee_retire_refusal(*, upcoming_spiel_nrs: Sequence[int]) -> WriteRefusal | None:
    """Why retiring this referee must be refused, or `None`.

    `upcoming_spiel_nrs` is `unplayed_spiel_nrs`'s definition of "still to come".
    """

    if not upcoming_spiel_nrs:
        return None

    named = ", ".join(str(nr) for nr in upcoming_spiel_nrs[:5])
    rest = f" and {len(upcoming_spiel_nrs) - 5} more" if len(upcoming_spiel_nrs) > 5 else ""

    return WriteRefusal(
        error_code=REFEREE_STILL_ASSIGNED,
        message=(
            f"{len(upcoming_spiel_nrs)} unplayed fixture(s) are assigned to them (spiel_nr {named}{rest}); "
            "reassign or cancel those fixtures first"
        ),
    )
