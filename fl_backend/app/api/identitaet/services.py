"""
API · the subject read's judgements, apart from the handles they are asked of

Here rather than in `crud.py`, which opens collections: a services module is what
`fl_backend/tests/core/test_write_shapes.py :: TestEveryServiceModuleDecidesFromItsArguments` sweeps,
so a judgement left beside a handle is one nothing stops from growing a read of its own.
"""

import re
from collections.abc import Mapping, Sequence
from typing import Any

from app.api.kontakte.services import KONTAKT_SLOTS
from app.shared.folding import sign_in_identifier


def _same_address(identifier: str) -> Mapping[str, Any]:
    """The pre-filter, which narrows; `folds_to` is what decides.

    Its own copy rather than `app/api/kontakte/services.py :: _same_address`, which is the whole of
    that erasure's decision: one name over a narrowing and a decision lets either move for the
    other's reason.
    """

    # Case is not the fold's rule but a wider one: MongoDB's `i` holds U+0345 equal to an iota,
    # where the fold leaves them two addresses. So this admits rows the fold then refuses.

    # Accepted as a scan: a `strength: 2` collation is index-backed and keeps the „ß“ decision, and
    # four indexes buy a scan of rows a league counts in hundreds. Tens of thousands would change that.
    return {"$regex": f"^{re.escape(identifier)}$", "$options": "i"}


def build_seat_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every junction row whose block may name the address."""

    return [
        {"$match": {"$or": [{f"kontakte.{slot}.email": _same_address(identifier)} for slot in KONTAKT_SLOTS]}},
        # `name` rides along free, this read opening the row anyway, and it is the row's own rather
        # than the club's (`docs/backend/spec.md :: I13`).
        {"$project": {"saison_id": 1, "team_id": 1, "name": 1, **{f"kontakte.{slot}.email": 1 for slot in KONTAKT_SLOTS}}},
        # Ordered in the read rather than by the reader: two clubs' seats held by one inbox are
        # otherwise answered in whatever order the collection was written in.
        {"$sort": {"saison_id": 1, "team_id": 1}},
    ]


def build_referee_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """The stored address rides along so `folds_to` can judge it; nothing else of the person does."""

    return [{"$match": {"kontakt.email": _same_address(identifier)}}, {"$project": {"kontakt.email": 1}}, {"$sort": {"_id": 1}}]


def build_pupil_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Equality and no pattern: `spieler.email` stores the folded form, so the identifier IS the stored value."""

    return [{"$match": {"email": identifier}}, {"$project": {"_id": 1}}, {"$sort": {"_id": 1}}]


def folds_to(stored: Any, identifier: str) -> bool:
    """Whether one stored address is this mailbox, on the fold both ends of the join share.

    The null arm carries an empty seat slot and a referee whose `kontakt.email` is null, each
    declared so in `app/core/constraints.py`.
    """

    return stored is not None and sign_in_identifier(str(stored)) == identifier


def seats_naming(rows: Sequence[Mapping[str, Any]], identifier: str) -> list[tuple[Mapping[str, Any], str]]:
    """One pair per SLOT rather than per row: one address stands in two of a block's person slots wherever one person was entered twice."""

    return [
        (row, slot)
        for row in rows
        for slot in KONTAKT_SLOTS
        if folds_to(((row.get("kontakte") or {}).get(slot) or {}).get("email"), identifier)
    ]
