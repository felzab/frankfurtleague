"""
API · what an erasure of one contact person has to reach, spelled apart from the request

The slot names are read off `FLSaisonTeamKontakte` rather than typed here, the shape
`app/api/schiedsrichter/services.py :: ANONYMISED_KONTAKT` uses for a referee's two contact fields.
"""

import re
from typing import Any, Mapping, Sequence, get_args

from app.api.teams.schemas import FLKontaktperson, FLSaisonTeamKontakte
from app.core.collections import Collection

# `get_args` of a bare `FLKontaktperson` is `()`, so a fourth role typed without `| None` is missed
# here in silence. `test_every_slot_the_model_declares_is_covered` is what catches one, not the scan.
KONTAKT_SLOTS: tuple[str, ...] = tuple(
    name for name, field in FLSaisonTeamKontakte.model_fields.items() if FLKontaktperson in get_args(field.annotation)
)


def _same_address(email: str) -> Mapping[str, Any]:
    """Anchored and escaped, so the case is all this ignores.

    A collation with `strength: 2` would be the indexed answer, and
    `app/core/crud.py :: aggregate_many_from_db` takes none.
    """

    return {"$regex": f"^{re.escape(email)}$", "$options": "i"}


def build_matching_rows_pipeline(email: str) -> list[Mapping[str, Any]]:
    """Every row naming this address in a slot, projected to the addresses alone.

    Case-insensitive: `EmailStr` keeps the local part's case, and `bewerbungen` has no payload to
    normalise through, so equality leaves `Wiltrudis@` standing and reports it gone.
    """

    return [
        {"$match": {"$or": [{f"kontakte.{slot}.email": _same_address(email)} for slot in KONTAKT_SLOTS]}},
        {"$project": {f"kontakte.{slot}.email": 1 for slot in KONTAKT_SLOTS}},
    ]


def build_orphaned_image_filter(email: str) -> Mapping[str, Any]:
    """Every log row still HOLDING this person, whatever document it happens to name.

    A swap moves the address out of its row, so the pre-image carrying it out belongs to a document
    `build_redaction_filter`'s ids never reach, and nothing ages the log out.
    """

    return {
        # `collection` first, the one half of this an index serves: `aktionen_target` is a prefix
        # match here, and nothing indexes inside `before`.
        "collection": {"$in": [str(Collection.SAISON_TEAMS), str(Collection.BEWERBUNGEN)]},
        "$or": [{f"before.kontakte.{slot}.email": _same_address(email)} for slot in KONTAKT_SLOTS],
    }


def find_matching_slots(row: Mapping[str, Any], email: str) -> tuple[str, ...]:
    """Which of this row's slots name the address, on the pipeline's case-insensitive terms.

    `casefold` and not the pattern again: full folding is the wider of the two, so a matched row
    always yields a slot, never an empty `$set`.
    """

    kontakte = row.get("kontakte") or {}
    wanted = email.casefold()

    # `str` around it because the slot is declared `bsonType: "string"` and nothing narrower, so what
    # sits there is only as trustworthy as whatever wrote the row.
    return tuple(slot for slot in KONTAKT_SLOTS if str((kontakte.get(slot) or {}).get("email") or "").casefold() == wanted)


def build_clearing_update(slots: Sequence[str]) -> Mapping[str, Any]:
    """Null the named slots and nothing else.

    Dotted keys, so the block itself survives: `app/core/constraints.py :: _KONTAKTE_REQUIRED` names
    all four members required, and on an application the block is non-nullable outright.
    """

    return {"$set": {f"kontakte.{slot}": None for slot in slots}}
