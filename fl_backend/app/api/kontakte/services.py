from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from app.shared.folding import sign_in_identifier
from app.shared.schemas.literals import KONTAKT_SEATS


def rows_seating(*identifiers: str) -> Mapping[str, Any]:
    """Every reader of a person's seats selects through this one stage, season rows and applications alike.

    Where two selections part, an erasure's reveal names people its clearing leaves standing, and a
    sign-in counts rows the account page never serves.
    """

    # One clause per seat, each served by its own index: an `$or` with an unindexed clause scans the collection.
    # Folded here, the form every seat stores.
    folded = sorted({sign_in_identifier(identifier) for identifier in identifiers})

    return {"$or": [{f"kontakte.{seat}.email": {"$in": folded}} for seat in KONTAKT_SEATS]}


def find_matching_seats(row: Mapping[str, Any], identifier: str) -> tuple[str, ...]:
    """Which of this row's seats name the asker, each stored address on the sign-in fold the identifier was taken on."""

    # Every shape checked before it is read: a block or a seat may stand emptied, and a person's Widerspruch must not
    # answer 500 over one.
    kontakte = row.get("kontakte")
    persons = [kontakte.get(seat) for seat in KONTAKT_SEATS] if isinstance(kontakte, Mapping) else [None] * len(KONTAKT_SEATS)
    emails = [person.get("email") if isinstance(person, Mapping) else None for person in persons]

    named = zip(KONTAKT_SEATS, emails, strict=True)

    return tuple(seat for seat, email in named if isinstance(email, str) and sign_in_identifier(email) == identifier)


def departing_seats(row: Mapping[str, Any], identifiers: Iterable[str]) -> tuple[str, ...]:
    """The seats these people hold in one row, by address on the fold."""

    seats = {seat for identifier in identifiers for seat in find_matching_seats(row, identifier)}

    return tuple(seat for seat in KONTAKT_SEATS if seat in seats)


def build_clearing_update(seats: Sequence[str], *, confirmations: bool = False, takes_the_notice_back: bool = False) -> Mapping[str, Any]:
    """Null the named seats, their confirmation bookkeeping where the caller found a block, and a deletion notice whose day this moves.

    Dotted keys, so the block itself survives: a season row's block requires all four fields, and on an application the
    block is non-nullable outright.
    """

    cleared: dict[str, Any] = {f"kontakte.{seat}": None for seat in seats}

    # The seat's confirmation bookkeeping goes with the person, on an application and on a season row
    # alike: a live link would otherwise outlive the erasure and confirm a seat that names nobody.
    if confirmations:
        cleared.update({f"confirmations.{seat}": None for seat in seats})
    if takes_the_notice_back:
        cleared["erasure_announced_at"] = None

    return {"$set": cleared}
