"""
SHARED · the consent record's appended entries, and the one way a writer composes them

Art. 7(1) DSGVO puts the proof of a consent on the league, and a block rewritten in place loses
whether and when it was withdrawn. So every act on a pupil's, a referee's, a registration's or a
contact seat's record appends one entry to the block's own `verlauf`, and no write edits or removes
one.

Invariants:
- A block that exists is moved by dotted `$set`s beside one `$push`, never `$set` whole: that erases its entries.
- An entry's choices and speaker are cut from the block the act leaves; only its label is the writer's.

See: docs/glossary.md
"""

from collections.abc import Mapping
from typing import Any, Final, Literal

# Inside the block rather than beside it: the copy writers carry a block whole, and the history
# travels with it wherever it is carried.
VERLAUF: Final = "verlauf"

# `abgelehnt` is the Widerspruch's wire word (`docs/glossary.md :: Bestätigung`), and a Widerspruch
# empties the slot, so it is no entry and has no act here.
FLEinwilligungAkt = Literal["erteilt", "bestaetigt", "widerrufen"]

# Who spoke, under the field each vocabulary names it with: a person's own consent, and what a
# contact seat was told.
_PROVENANCE_FIELDS: Final = ("erteilt_von", "erfasst_von")


def compose_eintrag(*, block: Mapping[str, Any], akt: FLEinwilligungAkt, ueber: str, am: str, text_version: str) -> dict[str, Any]:
    """One entry: the choices and the speaker the block holds once the act lands.

    The label is the writer's: an account-page press records its control's on the entry, and the
    block keeps the one its person confirmed.
    """

    provenance = [field for field in _PROVENANCE_FIELDS if field in block]
    if not isinstance(block.get("umfang"), str) or not text_version or len(provenance) != 1:
        raise ValueError(f"no consent entry can be cut from a block naming the provenance {provenance}, under the label {text_version!r}")

    return {
        "am": am,
        "akt": akt,
        "ueber": ueber,
        "umfang": block["umfang"],
        # Absent reads `false`, as both read models default it: a record predating the field never
        # granted media.
        "medien": bool(block.get("medien", False)),
        "text_version": text_version,
        provenance[0]: block[provenance[0]],
    }


def compose_born_record(*, block: Mapping[str, Any], akt: FLEinwilligungAkt, ueber: str, am: str) -> dict[str, Any]:
    """A block this write creates whole, carrying its first entry under the block's own label.

    Only where no stored entry can stand: an insert, a slot written whole, a block that was null.
    """

    if VERLAUF in block:
        raise ValueError("a block being born carries no entries of its own; the act is the first one")

    eintrag = compose_eintrag(block=block, akt=akt, ueber=ueber, am=am, text_version=str(block.get("text_version") or ""))

    return {**block, VERLAUF: [eintrag]}


def compose_record_move(
    *, pfad: str, stored: Mapping[str, Any], moved: Mapping[str, Any], akt: FLEinwilligungAkt, ueber: str, am: str, text_version: str
) -> dict[str, dict[str, Any]]:
    """The moved fields and one appended entry, in ONE update on the block at `pfad`.

    `stored` is read in the writer's own transaction, so the entry is what the block then holds.
    """

    if VERLAUF in moved:
        raise ValueError("an act appends its entry; no write sets the entries")

    eintrag = compose_eintrag(block={**stored, **moved}, akt=akt, ueber=ueber, am=am, text_version=text_version)

    return {"$set": {f"{pfad}.{field}": value for field, value in moved.items()}, "$push": {f"{pfad}.{VERLAUF}": eintrag}}
