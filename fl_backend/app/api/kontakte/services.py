from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from app.shared.folding import sign_in_identifier
from app.shared.schemas.literals import KONTAKT_SEATS


def rows_seating(*identifiers: str) -> Mapping[str, Any]:
    """Every reader of a person's seats selects through this one stage, season rows and applications alike.

    Where two selections part, an erasure's reveal names people its clearing leaves standing, and a
    sign-in counts rows the account page never serves.
    """

    # One clause per slot, each served by its own index: an `$or` with an unindexed clause scans the collection.
    # Folded here, the form every seat stores.
    folded = sorted({sign_in_identifier(identifier) for identifier in identifiers})

    return {"$or": [{f"kontakte.{slot}.email": {"$in": folded}} for slot in KONTAKT_SEATS]}


def find_matching_slots(row: Mapping[str, Any], identifier: str) -> tuple[str, ...]:
    """Which of this row's slots name the asker, each stored address on the sign-in fold the identifier was taken on."""

    # Every shape checked before it is read: a block or a seat may stand emptied, and a person's Widerspruch must not
    # answer 500 over one.
    kontakte = row.get("kontakte")
    seats = [kontakte.get(slot) for slot in KONTAKT_SEATS] if isinstance(kontakte, Mapping) else [None] * len(KONTAKT_SEATS)
    emails = [seat.get("email") if isinstance(seat, Mapping) else None for seat in seats]

    named = zip(KONTAKT_SEATS, emails, strict=True)

    return tuple(slot for slot, email in named if isinstance(email, str) and sign_in_identifier(email) == identifier)


def departing_slots(row: Mapping[str, Any], identifiers: Iterable[str]) -> tuple[str, ...]:
    """The slots these people hold in one row, by address on the fold."""

    slots = {slot for identifier in identifiers for slot in find_matching_slots(row, identifier)}

    return tuple(slot for slot in KONTAKT_SEATS if slot in slots)


def build_clearing_update(slots: Sequence[str], *, confirmations: bool = False, takes_the_notice_back: bool = False) -> Mapping[str, Any]:
    """Null the named slots, their confirmation bookkeeping where the caller found a block, and a deletion notice whose day this moves.

    Dotted keys, so the block itself survives: a season row's block requires all four fields, and on an application the
    block is non-nullable outright.
    """

    cleared: dict[str, Any] = {f"kontakte.{slot}": None for slot in slots}

    # The seat's confirmation bookkeeping goes with the person, on an application and on a season row
    # alike: a live link would otherwise outlive the erasure and confirm a slot that names nobody.
    if confirmations:
        cleared.update({f"confirmations.{slot}": None for slot in slots})
    if takes_the_notice_back:
        cleared["erasure_announced_at"] = None

    return {"$set": cleared}
