"""API · what an erasure of one contact person has to reach, spelled apart from the request."""

from collections.abc import Iterable, Mapping, Sequence, Set
from typing import Any

from app.core.crud import literal_pattern
from app.shared.folding import person_name_key, sign_in_identifier, trimmed_pattern
from app.shared.schemas.literals import KONTAKT_ROLLEN


def same_address(identifier: str) -> Mapping[str, Any]:
    """A case-blind pre-filter, the sign-in fold deciding.

    For a grant's rows alone, which an erasure and an address change's effect read: a grant is pasted through the Playground,
    folded by the runbook's hand and checked folded only at a deploy's preflight; every other record stores the fold its
    write made.
    """

    # Folded here whatever a caller hands on: built off an unfolded spelling, a padded or a blank one above all, the
    # pattern reads less than that spelling's fold claims. The fold moves a value by its trim and its ASCII case alone,
    # which the pattern's anchors and `i` take.
    return {"$regex": trimmed_pattern(literal_pattern(sign_in_identifier(identifier))), "$options": "i"}


def rows_seating(*identifiers: str) -> Mapping[str, Any]:
    """Every reader of a person's seats selects through this one stage, season rows and applications alike.

    Where two selections part, an erasure's reveal names people its clearing leaves standing, and a
    sign-in counts rows the account page never serves.
    """

    # One clause per slot, each its own index's (`app/core/constraints.py :: SUPPORT_INDEXES`): an `$or` with an
    # unindexed clause scans the collection. Folded here, the form every seat stores.
    folded = sorted({sign_in_identifier(identifier) for identifier in identifiers})

    return {"$or": [{f"kontakte.{slot}.email": {"$in": folded}} for slot in KONTAKT_ROLLEN]}


# The address rides along because `find_matching_slots` picks the seat by it, off the row itself.
SEAT_FIELDS: tuple[str, ...] = ("email", "first_name", "last_name")


def build_accepted_application_pipeline(*, saison_id: str, team_id: Any) -> list[Mapping[str, Any]]:
    """The club's accepted application for a season, projected to what the clearing judges and `confirmations`.

    Every one, unbounded: a capped read would leave an application holding the outgoing people that
    nothing reaches again.
    """

    return [
        {"$match": {"saison_id": saison_id, "team_id": team_id, "status": "accepted"}},
        {"$project": {**{f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in SEAT_FIELDS}, "confirmations": 1}},
    ]


def find_matching_slots(row: Mapping[str, Any], identifier: str) -> tuple[str, ...]:
    """Which of this row's slots name the asker, each stored address on the sign-in fold the identifier was taken on."""

    # Every shape checked before it is read: a block or a seat may stand emptied, and a person's Widerspruch must not
    # answer 500 over one.
    kontakte = row.get("kontakte")
    seats = [kontakte.get(slot) for slot in KONTAKT_ROLLEN] if isinstance(kontakte, Mapping) else [None] * len(KONTAKT_ROLLEN)
    emails = [seat.get("email") if isinstance(seat, Mapping) else None for seat in seats]

    named = zip(KONTAKT_ROLLEN, emails, strict=True)

    return tuple(slot for slot, email in named if isinstance(email, str) and sign_in_identifier(email) == identifier)


# A seat's name as `app/shared/folding.py :: person_name_key` compares it, first name and surname apart.
PersonName = tuple[str, str]


def seat_name(seat: Any) -> PersonName | None:
    """`None` where either half is blank: a blank name is nobody's, and matching it would empty every unnamed seat."""

    if not isinstance(seat, Mapping):
        return None

    name = (person_name_key(seat.get("first_name")), person_name_key(seat.get("last_name")))

    return name if all(name) else None


def departing_slots(row: Mapping[str, Any], identifiers: Iterable[str], names: Set[PersonName] = frozenset()) -> tuple[str, ...]:
    """The slots these people hold in one row, by address on the fold and by any name handed in."""

    slots = {slot for identifier in identifiers for slot in find_matching_slots(row, identifier)}

    # By name only inside a document the caller reached by id, where
    # one name is one person, so a corrected address takes its seat; the replacement hands in the
    # outgoing row's names.
    kontakte = row.get("kontakte")
    if names and isinstance(kontakte, Mapping):
        slots |= {slot for slot in KONTAKT_ROLLEN if seat_name(kontakte.get(slot)) in names}

    return tuple(slot for slot in KONTAKT_ROLLEN if slot in slots)


def seated_people(row: Mapping[str, Any]) -> tuple[frozenset[str], frozenset[PersonName]]:
    """Every address a row seats, on the fold, and every name: who leaves with the row when another club takes its place."""

    kontakte = row.get("kontakte")
    seats = (
        [seat for seat in (kontakte.get(slot) for slot in KONTAKT_ROLLEN) if isinstance(seat, Mapping)] if isinstance(kontakte, Mapping) else []
    )
    addresses = frozenset(sign_in_identifier(seat["email"]) for seat in seats if isinstance(seat.get("email"), str))

    return addresses, frozenset(name for name in map(seat_name, seats) if name is not None)


def build_clearing_update(slots: Sequence[str], *, confirmations: bool = False, takes_the_notice_back: bool = False) -> Mapping[str, Any]:
    """Null the named slots, their confirmation bookkeeping where the caller found a block, and a deletion notice whose day this moves.

    Dotted keys, so the block itself survives: `app/api/teams/schemas.py :: FLSaisonTeamKontakte` requires
    all four members, and on an application the block is non-nullable outright.
    """

    cleared: dict[str, Any] = {f"kontakte.{slot}": None for slot in slots}

    # The seat's confirmation bookkeeping goes with the person, on an application and on a season row
    # alike: a live link would otherwise outlive the erasure and confirm a slot that names nobody.
    if confirmations:
        cleared.update({f"confirmations.{slot}": None for slot in slots})
    if takes_the_notice_back:
        cleared["erasure_announced_at"] = None

    # Whatever the block: the submission digest was taken over this person's details too, and a hash
    # of personal data is personal data. An `$unset` creates nothing
    # where none is held.
    return {"$set": cleared, "$unset": {"idempotency_fingerprint": ""}}
