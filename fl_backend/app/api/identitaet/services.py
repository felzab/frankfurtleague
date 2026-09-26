"""
API · the subject read's judgements, apart from the handles they are asked of

Here rather than in `crud.py`, which opens collections: a services module is what
`fl_backend/tests/core/test_write_shapes.py :: TestEveryServiceModuleDecidesFromItsArguments` sweeps,
so a judgement left beside a handle is one nothing stops from growing a read of its own.
"""

from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from app.api.kontakte.services import KONTAKT_SLOTS, same_address
from app.api.saisons.schemas import FLSaisonStatus
from app.api.schiedsrichter.services import build_real_referees_filter
from app.shared.einwilligung import is_confirmed
from app.shared.folding import sign_in_identifier

# A retired pupil or referee row is matched by nothing, where an unconfirmed one is read and judged:
# a person who has left meets the landing of a mailbox holding nothing, never the pending one
# (`docs/backend/spec.md :: I376`).
_LIVE: Mapping[str, Any] = {"inactive_since": None}


def build_seat_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every junction row whose block may name the address."""

    return [
        {"$match": {"$or": [{f"kontakte.{slot}.email": same_address(identifier)} for slot in KONTAKT_SLOTS]}},
        # `name` rides along free, this read opening the row anyway, and it is the row's own rather
        # than the club's (`docs/backend/spec.md :: I13`).
        {
            "$project": {
                "saison_id": 1,
                "team_id": 1,
                "name": 1,
                **{f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_SLOTS for field in ("email", "einwilligung.bestaetigt_am")},
            }
        },
        # Ordered in the read rather than by the reader: two clubs' seats held by one inbox are
        # otherwise answered in whatever order the collection was written in.
        {"$sort": {"saison_id": 1, "team_id": 1}},
    ]


def build_referee_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """The stored address rides along so `folds_to` can judge it, and the stamp so the confirmation can; nothing else of the person does."""

    return [
        # The ghost by its id and not only by its null address or its retirement: either of those
        # is a value a hand edit can change, and the id is the one thing naming the row as nobody.
        {"$match": {"kontakt.email": same_address(identifier), **_LIVE, **build_real_referees_filter()}},
        {"$project": {"kontakt.email": 1, "einwilligung.bestaetigt_am": 1}},
        {"$sort": {"_id": 1}},
    ]


def build_pupil_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Equality and no pattern: `spieler.email` stores the folded form."""

    return [{"$match": {"email": identifier, **_LIVE}}, {"$project": {"einwilligung.bestaetigt_am": 1}}, {"$sort": {"_id": 1}}]


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


def seat_is_confirmed(row: Mapping[str, Any], slot: str) -> bool:
    """Per SLOT: one address in two slots of one row may be confirmed in one and entered by an administrator in the other."""

    return is_confirmed((((row.get("kontakte") or {}).get(slot)) or {}).get("einwilligung"))


def awaits_confirmation(confirmations: Iterable[bool]) -> bool:
    """Whether a mailbox holds records that could grant a panel and has confirmed none of them (`docs/backend/spec.md :: I374`)."""

    judged = list(confirmations)

    return bool(judged) and not any(judged)


def grants_a_panel(saison_status: FLSaisonStatus) -> bool:
    """Whether a seat on a season of this status admits its holder to the team's panel (`docs/backend/spec.md :: I375`).

    A `future` season's seat grants too: a team's people act for it before its season starts.
    """

    return saison_status in ("active", "future")
