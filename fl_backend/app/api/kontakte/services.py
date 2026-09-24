"""
API · what an erasure of one contact person has to reach, spelled apart from the request

The slot names are read off `FLSaisonTeamKontakte` rather than typed here, the shape
`app/api/schiedsrichter/services.py :: build_ghost_schiedsrichter` reads for the ghost's two contact fields.
"""

from collections.abc import Mapping, Sequence
from typing import Any, get_args

from app.api.teams.schemas import FLKontaktperson, FLSaisonTeamKontakte
from app.core.collections import Collection
from app.core.crud import literal_pattern
from app.shared.folding import sign_in_identifier, trimmed_pattern

# `get_args` of a bare `FLKontaktperson` is `()`, so a fourth role typed without `| None` is missed
# here in silence. `test_every_slot_the_model_declares_is_covered` is what catches one, not the scan.
KONTAKT_SLOTS: tuple[str, ...] = tuple(
    name for name, field in FLSaisonTeamKontakte.model_fields.items() if FLKontaktperson in get_args(field.annotation)
)


def same_address(identifier: str) -> Mapping[str, Any]:
    """A pre-filter; the sign-in fold decides.

    A `strength: 2` collation with an index per slot is the indexed answer, refused for what it
    would index: rows a league counts in hundreds, and log images nothing indexes inside.
    """

    # `i` because the identifier is lower-cased and a stored address need not be: a payload keeps the
    # local part's case.
    return {"$regex": trimmed_pattern(literal_pattern(identifier)), "$options": "i"}


def _rows_possibly_naming(identifier: str) -> Mapping[str, Any]:
    """The stage both pipelines below open with; `rows_naming` then keeps the rows the fold confirms.

    One selection and not two: a reveal listing rows the clearing does not reach confirms an erasure
    against people it will leave standing.
    """

    return {"$or": [{f"kontakte.{slot}.email": same_address(identifier)} for slot in KONTAKT_SLOTS]}


def build_matching_rows_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every row that may name this address in a slot, projected to those addresses and `bestaetigungen`.

    On the sign-in fold: a payload keeps the local part's case, so equality leaves `Wiltrudis@`
    standing and reports it gone.
    """

    return [
        {"$match": _rows_possibly_naming(identifier)},
        # The bookkeeping block's PRESENCE rides along: the clearing nulls its seat only where the
        # block exists, since a dotted `$set` into an absent one creates a block short of its keys.
        {"$project": {**{f"kontakte.{slot}.email": 1 for slot in KONTAKT_SLOTS}, "bestaetigungen": 1}},
    ]


# The address rides along because `find_matching_slots` picks the seat by it, off the row itself.
SEAT_FIELDS: tuple[str, ...] = ("email", "vorname", "nachname")


def build_matching_seats_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """The seats' names and their season.

    Nothing else of the block: a confirmation answers WHO, and a read serving the records would hand
    a fresh copy of them to whoever is about to destroy them.
    """

    return [
        {"$match": _rows_possibly_naming(identifier)},
        {"$project": {"saison_id": 1, **{f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_SLOTS for field in SEAT_FIELDS}}},
        # Ordered here rather than by the reader: a reader counting seats needs one season's together,
        # and natural order is the order the rows were written in.
        {"$sort": {"saison_id": 1}},
    ]


def build_orphaned_images_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """The log rows that may still HOLD this person; `images_holding` decides.

    A swap orphans the pre-image carrying the address out, past `build_redaction_filter`'s ids; the
    log's retention (`app/core/constraints.py :: TTL_INDEXES`) expires a row long after the erasure
    is owed.
    """

    return [
        {
            "$match": {
                # `collection` first, the one half of this an index serves: `aktionen_target` is a
                # prefix match here, and nothing indexes inside `before`.
                "collection": {"$in": [str(Collection.SAISON_TEAMS), str(Collection.BEWERBUNGEN)]},
                "$or": [{f"before.kontakte.{slot}.email": same_address(identifier)} for slot in KONTAKT_SLOTS],
            }
        },
        {"$project": {f"before.kontakte.{slot}.email": 1 for slot in KONTAKT_SLOTS}},
    ]


def find_matching_slots(row: Mapping[str, Any], identifier: str) -> tuple[str, ...]:
    """Which of this row's slots name the asker, each stored address on the sign-in fold.

    Never `casefold`, which reads „straße“ and „strasse“ as one domain and so clears a second
    person's seat on the first person's request.
    """

    kontakte = row.get("kontakte") or {}

    # `str` around it because the slot is declared `bsonType: "string"` and nothing narrower, so what
    # sits there is only as trustworthy as whatever wrote the row.
    return tuple(slot for slot in KONTAKT_SLOTS if sign_in_identifier(str((kontakte.get(slot) or {}).get("email") or "")) == identifier)


def rows_naming(rows: Sequence[Mapping[str, Any]], identifier: str) -> list[Mapping[str, Any]]:
    """The rows the pre-filter reached that the fold confirms, so no row counts, clears or redacts on the server's `i` alone.

    That `i` ignores case beyond ASCII (ſ for s), where the fold lowers ASCII alone.
    """

    return [row for row in rows if find_matching_slots(row, identifier)]


def images_holding(rows: Sequence[Mapping[str, Any]], identifier: str) -> list[Any]:
    """The ids of the log rows whose pre-image names this person; a `delete_many` row's `before` is a list of images."""

    def images_of(row: Mapping[str, Any]) -> list[Any]:
        before = row.get("before")
        return before if isinstance(before, list) else [before]

    return [row["_id"] for row in rows if any(find_matching_slots(image, identifier) for image in images_of(row) if isinstance(image, Mapping))]


def build_clearing_update(slots: Sequence[str], *, bestaetigungen: bool = False) -> Mapping[str, Any]:
    """Null the named slots, and their confirmation bookkeeping where the caller found a block.

    Dotted keys, so the block itself survives: `app/core/constraints.py :: _KONTAKTE_REQUIRED` names
    all four members required, and on an application the block is non-nullable outright.
    """

    cleared: dict[str, Any] = {f"kontakte.{slot}": None for slot in slots}

    # The seat's confirmation bookkeeping goes with the person: a live link would otherwise
    # outlive the erasure and confirm a slot that names nobody.
    if bestaetigungen:
        cleared.update({f"bestaetigungen.{slot}": None for slot in slots})

        # An application's submission digest was taken over this person's details too, and a hash of
        # personal data is still personal data (`docs/backend/spec.md :: I346`).
        return {"$set": cleared, "$unset": {"idempotenz_fingerabdruck": ""}}

    return {"$set": cleared}
