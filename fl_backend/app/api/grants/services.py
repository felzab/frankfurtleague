from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from http import HTTPStatus
from typing import Any, Final

from bson import ObjectId

from app.api.grants.schemas import FLGrantChange, FLGrantNoticeStage
from app.api.outbox.schemas import FLGrantData
from app.core.codes import Code
from app.core.exceptions import APIError, FieldFault
from app.core.security import refused_session, signed_in_since
from app.shared.schemas.custom import as_utc
from app.shared.schemas.literals import FLAdminTier

OWNER: Final[FLAdminTier] = "owner"
ADMINISTRATION: Final[FLAdminTier] = "administration"


def in_effect(row: Mapping[str, Any], now: datetime) -> bool:
    """Whether a stored grant holds at `now`, the one comparison every reader in effect shares: a waiting row is who will hold."""

    return as_utc(row["effective_from"]) <= now.astimezone(UTC)


def admin_tier_of(address: str, grants: Sequence[Mapping[str, Any]]) -> FLAdminTier | None:
    """The tier this folded address's row carries, in effect or waiting, or `None`."""

    return next((grant["admin_tier"] for grant in grants if grant["address"] == address), None)


def holds_an_owners_power(*, actor: str, grants: Sequence[Mapping[str, Any]]) -> bool:
    """Whether this folded address's own row is `owner`, its session left to the caller.

    One judgement for every refusal keyed on an owner's power, so no two of them can part on who holds it.
    """

    return admin_tier_of(actor, grants) == OWNER


def handover_due(grants: Sequence[Mapping[str, Any]], now: datetime) -> Mapping[str, Any] | None:
    """The row whose waiting handover has reached its date: at most one, a second being refused at its start."""

    return next((grant for grant in grants if grant.get("owner_from") is not None and as_utc(grant["owner_from"]) <= now.astimezone(UTC)), None)


def find_exists_refusal(*, address: str, grants: Sequence[Mapping[str, Any]]) -> FieldFault | None:
    """`grant_exists`: a grant already holds the address, of either tier, a waiting one included."""

    if admin_tier_of(address, grants) is None:
        return None

    return FieldFault(path=("email",), code=Code.GRANT_EXISTS, status=HTTPStatus.CONFLICT)


def find_only_owner_refusal(*, actor: str, auth_time: int, grants: Sequence[Mapping[str, Any]]) -> APIError | None:
    """`grant_only_owner`: only the owner adds, removes, hands over or withdraws, judged inside the transaction.

    The guard's refused session where the owner's row is dated after the sign-in: a handover completing between the
    guard's read and this transaction dates the row anew, and a session older than it holds nothing of the role.
    """

    if not holds_an_owners_power(actor=actor, grants=grants):
        return APIError(HTTPStatus.FORBIDDEN, Code.GRANT_ONLY_OWNER)

    # Here and never in `holds_an_owners_power`, whose other caller judges the owner's own erasure, which no session's
    # age may let through.
    own = next(grant for grant in grants if grant["address"] == actor)
    if not signed_in_since(auth_time, as_utc(own["effective_from"])):
        return refused_session()

    return None


def find_barred_refusal(*, barred: bool) -> APIError | None:
    """`grant_barred`: the address is on the ban list, which another administrator decided.

    The target's state, so 409: lifting the ban is what changes it.
    """

    if not barred:
        return None

    return APIError(HTTPStatus.CONFLICT, Code.GRANT_BARRED)


def find_owner_row_refusal(*, grant: Mapping[str, Any]) -> APIError | None:
    """`grant_owner`: the `owner` row is removed by no route and named by no handover."""

    if grant.get("admin_tier") != OWNER:
        return None

    return APIError(HTTPStatus.CONFLICT, Code.GRANT_OWNER)


def find_handover_refusal(*, grant: Mapping[str, Any], grants: Sequence[Mapping[str, Any]], now: datetime) -> APIError | None:
    """`grant_handover_waiting` while any row waits on one, `grant_not_in_effect` for a row whose own wait still runs."""

    if any(row.get("owner_from") is not None for row in grants):
        return APIError(HTTPStatus.CONFLICT, Code.GRANT_HANDOVER_WAITING)

    if not in_effect(grant, now):
        return APIError(HTTPStatus.CONFLICT, Code.GRANT_NOT_IN_EFFECT)

    return None


@dataclass(frozen=True)
class Notice:
    """One notice a grants write owes: the record it is keyed by, and its facts."""

    grant_id: ObjectId
    data: FLGrantData


def compose_notice(
    *,
    grant_id: ObjectId,
    change: FLGrantChange,
    stage: FLGrantNoticeStage,
    address: str | None,
    new_address: str | None = None,
    effective_from: datetime | None = None,
) -> Notice:
    return Notice(
        grant_id=grant_id,
        data=FLGrantData(kind="grant", change=change, stage=stage, address=address, new_address=new_address, effective_from=effective_from),
    )


def compose_handover_end(grant: Mapping[str, Any], *, address: str | None) -> list[Notice]:
    """The withdrawal's notice of a handover a row's end takes with it, whose holders hold a date; none where none waits."""

    if grant.get("owner_from") is None:
        return []

    return [compose_notice(grant_id=grant["_id"], change="handover", stage="withdrawn", address=address)]
