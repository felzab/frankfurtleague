"""API · what an erasure of one contact person has to reach, spelled apart from the request."""

from collections.abc import Iterable, Mapping, Sequence, Set
from typing import Any

from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.collections import Collection
from app.core.crud import literal_pattern
from app.core.recording import row_images
from app.shared.folding import canonical_address, person_name_key, sign_in_identifier, trimmed_pattern


def same_address(identifier: str) -> Mapping[str, Any]:
    """A pre-filter; the sign-in fold decides.

    A `strength: 2` collation with an index per slot is the indexed answer, refused for what it
    would index: rows a league counts in hundreds, and log images nothing indexes inside.
    """

    # `i` because the identifier is lower-cased and a stored address need not be: a payload keeps the
    # local part's case.
    spellings = (identifier, *_unicode_spelling(identifier))
    return {"$regex": trimmed_pattern("|".join(literal_pattern(spelling) for spelling in spellings)), "$options": "i"}


def _unicode_spelling(identifier: str) -> tuple[str, ...]:
    """The identifier with its punycode domain decoded: a hand-typed row may store it so, and the fold claims it."""

    local, at, domain = identifier.rpartition("@")
    if not at or "xn--" not in domain:
        return ()

    try:
        decoded = canonical_address(identifier).rpartition("@")[2]
        # A label decoding to a lone surrogate is one the driver cannot send.
        decoded.encode("utf-8")
    except ValueError:
        return ()

    return (f"{local}@{decoded}",) if decoded != domain else ()


def rows_possibly_naming(identifier: str) -> Mapping[str, Any]:
    """Every reader of a person's seats selects through this one stage, season rows and applications alike.

    Where two selections part, an erasure's reveal names people its clearing leaves standing, and a
    sign-in counts rows the account page never serves.
    """

    return {"$or": [{f"kontakte.{slot}.email": same_address(identifier)} for slot in KONTAKT_ROLLEN]}


def build_matching_rows_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every row that may name this address in a slot, projected to those addresses and `bestaetigungen`.

    On the sign-in fold: a payload keeps the local part's case, so equality leaves `Wiltrudis@`
    standing and reports it gone.
    """

    return [
        {"$match": rows_possibly_naming(identifier)},
        # The bookkeeping block's PRESENCE rides along: the clearing nulls its seat only where the
        # block exists, since a dotted `$set` into an absent one creates a block short of its keys.
        {"$project": {**{f"kontakte.{slot}.email": 1 for slot in KONTAKT_ROLLEN}, "bestaetigungen": 1}},
    ]


# The address rides along because `find_matching_slots` picks the seat by it, off the row itself.
SEAT_FIELDS: tuple[str, ...] = ("email", "vorname", "nachname")


def build_matching_seats_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """The seats' names and their season.

    Nothing else of the block: a confirmation answers WHO, and a read serving the records would hand
    a fresh copy of them to whoever is about to destroy them.
    """

    return [
        {"$match": rows_possibly_naming(identifier)},
        {"$project": {"saison_id": 1, **{f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in SEAT_FIELDS}}},
        # Ordered here rather than by the reader: a reader counting seats needs one season's together,
        # and natural order is the order the rows were written in.
        {"$sort": {"saison_id": 1}},
    ]


def build_seat_images_filter(identifier: str) -> Mapping[str, Any]:
    """Log rows whose images may seat this person; `seat_image_edits` decides.

    By what an image holds, never by row id: a swap orphans an image carrying the address out, and
    the log keeps it its whole retention (`app/core/constraints.py :: TTL_INDEXES`).
    """

    return {
        # `collection` first, the one half of this an index serves: `aktionen_target` is a prefix
        # match here, and nothing indexes inside `before`.
        "collection": {"$in": [str(Collection.SAISON_TEAMS), str(Collection.BEWERBUNGEN)]},
        "$or": [{f"before.kontakte.{slot}.email": same_address(identifier)} for slot in KONTAKT_ROLLEN],
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


def rows_naming(rows: Sequence[Mapping[str, Any]], identifier: str) -> list[Mapping[str, Any]]:
    """The rows the pre-filter reached that the fold confirms, so no row counts, clears or redacts on the server's `i` alone.

    That `i` ignores case beyond ASCII (ſ for s), where the fold lowers ASCII alone.
    """

    return [row for row in rows if find_matching_slots(row, identifier)]


def _emptied_seats(image: Mapping[str, Any], slots: Set[str], *, links: bool) -> dict[str, None]:
    if not slots:
        return {}

    edits: dict[str, None] = {f"kontakte.{slot}": None for slot in slots}
    # Where the live write takes the link with the seat, and only where the image holds the block: a
    # Widerspruch keeps it, its day recorded on it.
    if links and isinstance(image.get("bestaetigungen"), Mapping):
        edits.update({f"bestaetigungen.{slot}": None for slot in slots})

    # The submission digest was taken over every seat's details, theirs among them.
    if "idempotenz_fingerabdruck" in image:
        edits["idempotenz_fingerabdruck"] = None

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


def seat_image_edits(
    image: Mapping[str, Any], identifiers: Iterable[str], *, links: bool, names: Set[PersonName] = frozenset()
) -> dict[str, None]:
    """The seats these people hold in one log image, emptied as the live write empties them.

    On the fold, image by image: a slot somebody else held keeps them, their earlier states being
    their consent trail.
    """

    slots = {slot for identifier in identifiers for slot in find_matching_slots(image, identifier)}

    # By name too where the caller reached the document by id: one address is one person, and inside
    # one document so is one name, so a corrected address takes its earlier seat. `names` comes from
    # that document's images (`departing_names`).
    kontakte = image.get("kontakte")
    if names and isinstance(kontakte, Mapping):
        slots |= {slot for slot in KONTAKT_ROLLEN if seat_name(kontakte.get(slot)) in names}

    return _emptied_seats(image, slots, links=links)


def contact_block_image_edits(image: Mapping[str, Any]) -> dict[str, None]:
    """One season row image's contacts and links, emptied as the write clearing them empties them.

    Every person the row ever seated goes, earlier holders included, and a declined seat's link with
    them; nothing else does.
    """

    blocks = {key: image.get(key) for key in ("kontakte", "bestaetigungen")}
    held = any(isinstance(block, Mapping) and any(isinstance(block.get(slot), Mapping) for slot in KONTAKT_ROLLEN) for block in blocks.values())

    # The fields the image holds alone: one recorded before links existed gains no `bestaetigungen`.
    return {key: None for key, block in blocks.items() if block is not None} if held else {}


def build_clearing_update(slots: Sequence[str], *, bestaetigungen: bool = False) -> Mapping[str, Any]:
    """Null the named slots, and their confirmation bookkeeping where the caller found a block.

    Dotted keys, so the block itself survives: `app/core/constraints.py :: _KONTAKTE_REQUIRED` names
    all four members required, and on an application the block is non-nullable outright.
    """

    cleared: dict[str, Any] = {f"kontakte.{slot}": None for slot in slots}

    # The seat's confirmation bookkeeping goes with the person, on an application and on a season row
    # alike: a live link would otherwise outlive the erasure and confirm a slot that names nobody.
    if bestaetigungen:
        cleared.update({f"bestaetigungen.{slot}": None for slot in slots})

    # Whatever the block: the submission digest was taken over this person's details too, and a hash
    # of personal data is personal data (`docs/backend/spec.md :: I346`). An `$unset` creates nothing
    # where none is held.
    return {"$set": cleared, "$unset": {"idempotenz_fingerabdruck": ""}}
