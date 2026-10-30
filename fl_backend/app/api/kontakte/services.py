"""API · what an erasure of one contact person has to reach, spelled apart from the request."""

from collections.abc import Iterable, Mapping, Sequence, Set
from typing import Any

from app.core.collections import Collection
from app.core.crud import literal_pattern
from app.core.recording import row_images
from app.shared.folding import person_name_key, sign_in_identifier, trimmed_pattern, trimmed_prefix_pattern
from app.shared.schemas.literals import KONTAKT_ROLLEN


def same_address(identifier: str) -> Mapping[str, Any]:
    """A case-blind pre-filter, the sign-in fold deciding.

    For a grant's rows and images alone, which an erasure and an address change's effect read: a grant is pasted through the
    Playground, folded by the runbook's hand and checked folded only at a deploy's preflight, and a log image keeps the
    spelling its grant had for the log's twelve months; every other record stores the fold its write made.
    """

    # Folded here whatever a caller hands on: built off an unfolded spelling, a padded or a blank one above all, the
    # pattern reads less than that spelling's fold claims.
    folded = sign_in_identifier(identifier)
    local, at, _ = folded.rpartition("@")
    # No `@`, so no local part: the fold equates the identifier whole, and a start alone, anchoring an empty
    # prefix, reads every stored string.
    if not at:
        return {"$regex": trimmed_pattern(literal_pattern(folded)), "$options": "i"}

    # Anchored on the local part and its `@`, which the fold changes by ASCII case alone (`i`): it maps a
    # domain from more spellings than a pattern lists, so the read takes every mailbox sharing that local part.
    return {"$regex": trimmed_prefix_pattern(literal_pattern(local + at)), "$options": "i"}


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
SEAT_FIELDS: tuple[str, ...] = ("email", "vorname", "nachname")


def build_accepted_application_pipeline(*, saison_id: str, team_id: Any) -> list[Mapping[str, Any]]:
    """The club's accepted application for a season, projected to what the clearing judges and `confirmations`.

    Every one, unbounded: a capped read would leave an application holding the outgoing people that
    nothing reaches again.
    """

    return [
        {"$match": {"saison_id": saison_id, "team_id": team_id, "status": "accepted"}},
        {"$project": {**{f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in SEAT_FIELDS}, "confirmations": 1}},
    ]


# The collections whose log images seat a contact person.
SEAT_IMAGE_COLLECTIONS: tuple[Collection, ...] = (Collection.SAISON_TEAMS, Collection.BEWERBUNGEN)


def build_seat_images_filter(identifier: str) -> Mapping[str, Any]:
    """Log rows whose images seat this person; `seat_image_edits` decides which slot.

    By what an image holds, never by row id: a swap orphans an image carrying the address out, and
    the log keeps it its whole retention (`app/core/constraints.py :: TTL_INDEXES`).
    """

    return {
        # `collection` first, the one half of this an index serves: `action_log_target` is a prefix
        # match here, and nothing indexes inside `before`.
        "collection": {"$in": [str(collection) for collection in SEAT_IMAGE_COLLECTIONS]},
        "$or": [{f"before.kontakte.{slot}.email": sign_in_identifier(identifier)} for slot in KONTAKT_ROLLEN],
    }


def find_matching_slots(row: Mapping[str, Any], identifier: str) -> tuple[str, ...]:
    """Which of this row's slots name the asker, each stored address on the sign-in fold.

    Never `casefold`, which reads „straße“ and „strasse“ as one domain and so clears a second
    person's seat on the first person's request.
    """

    # Every shape checked before it is read: a log image is whatever a row held when its write ran,
    # and a person's Widerspruch must not answer 500 over an older one.
    kontakte = row.get("kontakte")
    seats = [kontakte.get(slot) for slot in KONTAKT_ROLLEN] if isinstance(kontakte, Mapping) else [None] * len(KONTAKT_ROLLEN)
    emails = [seat.get("email") if isinstance(seat, Mapping) else None for seat in seats]

    named = zip(KONTAKT_ROLLEN, emails, strict=True)

    return tuple(slot for slot, email in named if isinstance(email, str) and sign_in_identifier(email) == identifier)


def seat_address_carry_edits(image: Mapping[str, Any], *, alt: str, neue: str, staying: Set[tuple[Any, str]]) -> dict[str, str]:
    """Each seat of one log image at the replaced address carried to the new one, but one `staying` names.

    A seat still standing there is nobody's proven own, and that address's erasure reaches its images.
    """

    return {f"kontakte.{slot}.email": neue for slot in find_matching_slots(image, alt) if (image.get("_id"), slot) not in staying}


def _emptied_seats(image: Mapping[str, Any], slots: Set[str], *, links: bool) -> dict[str, None]:
    if not slots:
        return {}

    edits: dict[str, None] = {f"kontakte.{slot}": None for slot in slots}
    # Where the live write takes the link with the seat, and only where the image holds the block: a
    # Widerspruch keeps it, its day recorded on it.
    if links and isinstance(image.get("confirmations"), Mapping):
        edits.update({f"confirmations.{slot}": None for slot in slots})

    # The submission digest was taken over every seat's details, theirs among them.
    if "idempotency_fingerprint" in image:
        edits["idempotency_fingerprint"] = None

    return edits


# A seat's name as `app/shared/folding.py :: person_name_key` compares it, first name and surname apart.
PersonName = tuple[str, str]


def seat_name(seat: Any) -> PersonName | None:
    """`None` where either half is blank: a blank name is nobody's, and matching it would empty every unnamed seat."""

    if not isinstance(seat, Mapping):
        return None

    name = (person_name_key(seat.get("vorname")), person_name_key(seat.get("nachname")))

    return name if all(name) else None


def departing_names(rows: Iterable[Mapping[str, Any]], identifiers: Set[str]) -> dict[Any, frozenset[PersonName]]:
    """Per document, by the `_id` its images carry, every name its log images seat these addresses under.

    Each write's own pre-image is among them, so the live seat's name always is.
    """

    names: dict[Any, set[PersonName]] = {}
    for row in rows:
        for _, image in row_images(row):
            if not isinstance(image, Mapping):
                continue

            slots = {slot for identifier in identifiers for slot in find_matching_slots(image, identifier)}
            # Each slot was found in a block `find_matching_slots` has checked is a mapping.
            held = (seat_name(image["kontakte"][slot]) for slot in slots)
            names.setdefault(image.get("_id"), set()).update(name for name in held if name is not None)

    return {document: frozenset(held) for document, held in names.items() if held}


def departing_slots(row: Mapping[str, Any], identifiers: Iterable[str], names: Set[PersonName] = frozenset()) -> tuple[str, ...]:
    """The slots these people hold in one row or log image, by address on the fold and by any name handed in."""

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


def seat_image_edits(
    image: Mapping[str, Any], identifiers: Iterable[str], *, links: bool, names: Set[PersonName] = frozenset()
) -> dict[str, None]:
    """The seats these people hold in one log image, emptied as the live write empties them.

    On the fold, image by image: a slot somebody else held keeps them, their earlier states being
    their consent trail.
    """

    return _emptied_seats(image, set(departing_slots(image, identifiers, names)), links=links)


def contact_block_image_edits(image: Mapping[str, Any]) -> dict[str, None]:
    """One season row image's contacts and links, emptied as the write clearing them empties them.

    Every person the row ever seated goes, earlier holders included, and a declined seat's link with
    them; nothing else does.
    """

    blocks = {key: image.get(key) for key in ("kontakte", "confirmations")}
    held = any(isinstance(block, Mapping) and any(isinstance(block.get(slot), Mapping) for slot in KONTAKT_ROLLEN) for block in blocks.values())

    # The fields the image holds alone: a row no save has minted a link on holds no `confirmations`.
    return {key: None for key, block in blocks.items() if block is not None} if held else {}


def build_clearing_update(slots: Sequence[str], *, confirmations: bool = False) -> Mapping[str, Any]:
    """Null the named slots, and their confirmation bookkeeping where the caller found a block.

    Dotted keys, so the block itself survives: `app/api/teams/schemas.py :: FLSaisonTeamKontakte` requires
    all four members, and on an application the block is non-nullable outright.
    """

    cleared: dict[str, Any] = {f"kontakte.{slot}": None for slot in slots}

    # The seat's confirmation bookkeeping goes with the person, on an application and on a season row
    # alike: a live link would otherwise outlive the erasure and confirm a slot that names nobody.
    if confirmations:
        cleared.update({f"confirmations.{slot}": None for slot in slots})

    # Whatever the block: the submission digest was taken over this person's details too, and a hash
    # of personal data is personal data. An `$unset` creates nothing
    # where none is held.
    return {"$set": cleared, "$unset": {"idempotency_fingerprint": ""}}
