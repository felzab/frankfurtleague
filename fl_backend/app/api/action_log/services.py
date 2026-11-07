from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from types import MappingProxyType
from typing import Any, Final, get_args

from app.api.action_log.schemas import FLActionLogFilterParams
from app.api.kontakte.services import same_address
from app.core import clock
from app.core.collections import Collection as DbCollection
from app.core.crud import build_query, literal_pattern
from app.core.recording import ERASED_ACTOR_MARKER, FLAction, FLActionType
from app.shared.folding import sign_in_identifier


def _actions_of(types: Sequence[FLActionType]) -> list[str]:
    """Every action of these categories: the category is the name's first half, and no stored field."""

    return [action for action in get_args(FLAction.__value__) if action.split(".")[0] in types]


def _german_midnight(day: date) -> datetime:
    """Where a German day starts, as the instant a stored `at` compares with across either clock change."""

    return datetime.combine(day, time(), tzinfo=clock.GERMANY)


def build_action_log_query(filters: FLActionLogFilterParams) -> dict[str, Any]:
    """The read's whole filter: `by` an equality, and each other term compiled, as none is stored as it is asked."""

    compiled: dict[str, Any] = {}
    if filters.cursor is not None:
        compiled["_id"] = {"$lt": filters.cursor}
    if filters.type is not None:
        compiled["action"] = {"$in": _actions_of(filters.type)}
    span: dict[str, datetime] = {}
    if filters.from_day is not None:
        span["$gte"] = _german_midnight(date.fromisoformat(filters.from_day))
    if filters.until_day is not None:
        span["$lt"] = _german_midnight(date.fromisoformat(filters.until_day) + timedelta(days=1))
    if span:
        compiled["at"] = span
    # A blank search is none: an empty pattern would keep only the rows holding a team or a label.
    if filters.q is not None and filters.q.strip():
        pattern = {"$regex": literal_pattern(filters.q.strip()), "$options": "i"}
        compiled["$or"] = [{"team": pattern}, {"label": pattern}]

    return build_query(filters, terms={"by"}, compiled=compiled)


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
        DbCollection.GRANTS: (
            ImageAddress("address", "address", None),
            ImageAddress("granted_by", "granted_by", ERASED_ACTOR_MARKER),
        ),
        DbCollection.BAN_LIST: (ImageAddress("created_by", "created_by", ERASED_ACTOR_MARKER),),
        DbCollection.INVITATIONS: (ImageAddress("created_by", "created_by", ERASED_ACTOR_MARKER),),
        DbCollection.BEWERBUNGEN: (ImageAddress("decision.by", "decision.by", ERASED_ACTOR_MARKER),),
        DbCollection.REGISTRIERUNGEN: (ImageAddress("decision.by", "decision.by", ERASED_ACTOR_MARKER),),
        # A row since re-addressed: the referee step reaches only the rows naming the person now.
        DbCollection.SCHIEDSRICHTER: (ImageAddress("kontakt.email", "kontakt.email", None),),
        DbCollection.SPIELER: (ImageAddress("email", "email", None),),
        # Either address of a change, and the administrators who started or approved one, whose marker keeps the image valid.
        DbCollection.ADDRESS_CHANGES: (
            ImageAddress("address", "address", None),
            ImageAddress("email", "email", None),
            ImageAddress("approval.started_by", "approval.started_by", ERASED_ACTOR_MARKER),
            ImageAddress("approval.approved_by", "approval.approved_by", ERASED_ACTOR_MARKER),
        ),
    }
)


def carried_by_the_effect(addresses: Sequence[ImageAddress], new_address: str) -> tuple[ImageAddress, ...]:
    """What an effect writes over the replaced address in these images: who acted carries to the new address.

    A record's own subject's address goes, as the erasure takes it.
    """

    return tuple(
        ImageAddress(address.path, address.overwritten, new_address if address.replacement == ERASED_ACTOR_MARKER else None)
        for address in addresses
    )


# The collections whose images an effect re-keys: a change's and a grant's, reached by address alone once the effect has
# moved the person; every other record's images are reached by their record's id.
EFFECT_IMAGE_COLLECTIONS: Final = (DbCollection.ADDRESS_CHANGES, DbCollection.GRANTS)


def build_address_images_filter(collection: DbCollection, identifier: str) -> Mapping[str, Any]:
    """The log rows of one collection whose images hold this address; `address_image_edits` decides which field."""

    # A grant's images by pattern, as its rows are read (`app/api/grants/erasure.py`): a pasted row keeps its
    # typed spelling into the image its revoke files. Every other image holds a fold a write stored.
    matched = same_address(identifier) if collection == DbCollection.GRANTS else sign_in_identifier(identifier)

    return {
        # `collection` first, the half `action_log_target` serves: nothing indexes inside `before`.
        "collection": str(collection),
        "$or": [{f"before.{address.path}": matched} for address in IMAGE_ADDRESSES[collection]],
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
