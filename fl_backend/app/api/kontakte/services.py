"""API · what an erasure of one contact person has to reach, spelled apart from the request."""

from collections.abc import Iterable, Mapping, Sequence, Set
from typing import Any

from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.collections import Collection
from app.core.crud import literal_pattern
from app.shared.folding import sign_in_identifier, trimmed_pattern


def same_address(identifier: str) -> Mapping[str, Any]:
    """A pre-filter; the sign-in fold decides.

    A `strength: 2` collation with an index per slot is the indexed answer, refused for what it
    would index: rows a league counts in hundreds, and log images nothing indexes inside.
    """

    # `i` because the identifier is lower-cased and a stored address need not be: a payload keeps the
    # local part's case.
    return {"$regex": trimmed_pattern(literal_pattern(identifier)), "$options": "i"}


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

    kontakte = row.get("kontakte") or {}

    # `str` around it because the slot is declared `bsonType: "string"` and nothing narrower, so what
    # sits there is only as trustworthy as whatever wrote the row.
    return tuple(slot for slot in KONTAKT_ROLLEN if sign_in_identifier(str((kontakte.get(slot) or {}).get("email") or "")) == identifier)


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


def seat_image_edits(image: Mapping[str, Any], identifiers: Iterable[str], *, links: bool) -> dict[str, None]:
    """The seats these people hold in one log image, emptied as the live write empties them.

    On the fold, image by image: a slot somebody else held keeps them, their earlier states being
    their consent trail.
    """

    return _emptied_seats(image, {slot for identifier in identifiers for slot in find_matching_slots(image, identifier)}, links=links)


def every_seat_image_edits(image: Mapping[str, Any]) -> dict[str, None]:
    """Every seat one log image of a season row holds, emptied with its link.

    A club handing its row on takes every person it ever seated there, earlier holders included: the
    row's page promised each deletion at once.
    """

    kontakte = image.get("kontakte")
    seated = {slot for slot in KONTAKT_ROLLEN if isinstance(kontakte, Mapping) and isinstance(kontakte.get(slot), Mapping)}

    return _emptied_seats(image, seated, links=True)


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

        # An application's submission digest was taken over this person's details too, and a hash of
        # personal data is still personal data (`docs/backend/spec.md :: I346`). A season row holds
        # none, so the `$unset` there removes nothing.
        return {"$set": cleared, "$unset": {"idempotenz_fingerabdruck": ""}}

    return {"$set": cleared}
