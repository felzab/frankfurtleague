from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Final

from app.api.aktionen.schemas import FLAktorAdapter, FLAktorMitAdresse
from app.api.kontakte.services import same_address
from app.api.schiedsrichter.services import ADRESSWECHSEL_FELD
from app.api.sperrliste.services import withheld_actor
from app.core.collections import Collection as DbCollection
from app.core.crud import build_sort
from app.core.recording import ERASED_ACTOR_MARKER
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import parse_object_id


def akteur_adressen(rows: Iterable[Mapping[str, Any]]) -> list[str]:
    """Every address an actor of these stored rows is named by, folded as the ban list is asked."""

    return [
        sign_in_identifier(actor.email) for row in rows if isinstance(actor := FLAktorAdapter.validate_python(row["actor"]), FLAktorMitAdresse)
    ]


def mit_vorenthaltenem_akteur(row: Mapping[str, Any], gesperrt: Collection[str]) -> dict[str, Any]:
    """A stored row with its actor as both reads serve it (`docs/backend/spec.md :: I452`).

    The stored image is left as recorded: it is what a restore of the write starts from.
    """

    actor = FLAktorAdapter.validate_python(row["actor"])
    if not isinstance(actor, FLAktorMitAdresse):
        return dict(row)

    email = withheld_actor(actor.email, gesperrt)

    return {**row, "actor": {**actor.model_dump(), "email": email, "email_gesperrt": email is None}}


def document_id_term(value: str | None) -> dict[str, Any] | None:
    """One document's history — `aktionen_target`'s first purpose.

    Compiled rather than dumped: a row stores the id as its collection does — an `ObjectId`
    everywhere but `saisons`, whose `_id` is the season string — and text matches no `ObjectId`.
    """

    if value is None:
        return None

    compiled = parse_object_id(value)

    return {"document_id": value if compiled is None else compiled}


def build_aktionen_sort(*, order: str) -> list[tuple[str, int]]:
    """The log page's order. `at` is the only key: every other ordering over a log of writes is a report.

    Named rather than inline so the index test can assert on what the endpoint actually sends
    (`fl_backend/tests/core/test_constraints_execution.py`).
    """

    # `_id` breaks the tie in `order`'s OWN direction, so one transaction's rows read the way the log
    # does and the pair is `aktionen_queue`'s key or its exact inverse. Pinned descending,
    # `order=asc` would match neither and scan the whole log.
    direction = 1 if order == "asc" else -1

    return build_sort(sort_by="at", order=order, chain=(("_id", direction),))


@dataclass(frozen=True)
class ImageAddress:
    """One address a log image keeps, where it sits inside the image, and what takes its place."""

    path: str
    # The field itself, or the block holding it where the whole block is the address's.
    overwritten: str
    replacement: Any


# Every address an image keeps on a document the erasure neither removes nor clears; a seat's are
# the seat step's (`app/api/kontakte/crud.py`). A required field naming who acted takes the marker,
# so a replayed image still validates.
IMAGE_ADDRESSES: Final[Mapping[DbCollection, tuple[ImageAddress, ...]]] = MappingProxyType(
    {
        DbCollection.BERECHTIGUNGEN: (
            ImageAddress("adresse", "adresse", None),
            ImageAddress("erteilt_von", "erteilt_von", ERASED_ACTOR_MARKER),
        ),
        DbCollection.SPERRLISTE: (ImageAddress("erstellt_von", "erstellt_von", ERASED_ACTOR_MARKER),),
        DbCollection.EINLADUNGEN: (ImageAddress("erstellt_von", "erstellt_von", ERASED_ACTOR_MARKER),),
        DbCollection.BEWERBUNGEN: (ImageAddress("entscheidung.von", "entscheidung.von", ERASED_ACTOR_MARKER),),
        DbCollection.REGISTRIERUNGEN: (ImageAddress("entscheidung.von", "entscheidung.von", ERASED_ACTOR_MARKER),),
        DbCollection.SCHIEDSRICHTER: (
            # A row since re-addressed: the referee step reaches only the rows naming the person now.
            ImageAddress("kontakt.email", "kontakt.email", None),
            ImageAddress(f"{ADRESSWECHSEL_FELD}.email", ADRESSWECHSEL_FELD, None),
        ),
    }
)


def build_address_images_filter(collection: DbCollection, identifier: str) -> Mapping[str, Any]:
    """The log rows of one collection whose images may hold this address; `address_image_edits` decides on the fold."""

    return {
        # `collection` first, the half `aktionen_target` serves: nothing indexes inside `before`.
        "collection": str(collection),
        "$or": [{f"before.{address.path}": same_address(identifier)} for address in IMAGE_ADDRESSES[collection]],
    }


def address_image_edits(image: Mapping[str, Any], *, identifier: str, addresses: Sequence[ImageAddress]) -> dict[str, Any]:
    """Each of these addresses one image holds on the fold, mapped to what takes its place."""

    edits: dict[str, Any] = {}
    for address in addresses:
        held: Any = image
        for key in address.path.split("."):
            held = held.get(key) if isinstance(held, Mapping) else None

        if isinstance(held, str) and sign_in_identifier(held) == identifier:
            edits[address.overwritten] = address.replacement

    return edits
