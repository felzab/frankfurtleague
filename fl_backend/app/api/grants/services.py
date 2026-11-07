"""
API · the grants' refusals, the one reading of a stored row, and the facts of their notices, apart from the handles they are asked of

Each refusal takes what its caller read inside its own transaction, so a retry after a conflict
judges the list afresh.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from http import HTTPStatus
from typing import Any, Final

from bson import ObjectId

from app.api.grants.schemas import FLGrantChange, FLGrantNoticeStage
from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.shared.schemas.custom import as_utc

OWNER: Final = "owner"
ADMINISTRATION: Final = "administration"


def in_effect(row: Mapping[str, Any], now: datetime) -> bool:
    """Whether a stored grant holds at `now`, the one comparison every reader in effect shares: a waiting row is who will hold."""

    return as_utc(row["effective_from"]) <= now.astimezone(UTC)


def admin_tier_of(address: str, grants: Sequence[Mapping[str, Any]]) -> str | None:
    """The tier this folded address's row carries, in effect or waiting, or `None`."""

    return next((str(grant["admin_tier"]) for grant in grants if grant["address"] == address), None)


def holds_an_owners_power(*, actor: str, grants: Sequence[Mapping[str, Any]]) -> bool:
    """Whether the acting administrator's own row is `owner`.

    One judgement for every refusal keyed on an owner's power, so no two of them can part on who holds it. The actor check
    already refused a session older than the row's date, and a handover sets that date.
    """

    return admin_tier_of(actor, grants) == OWNER


def handover_due(grants: Sequence[Mapping[str, Any]], now: datetime) -> Mapping[str, Any] | None:
    """The row whose waiting handover has reached its date: at most one, a second being refused at its start."""

    return next((grant for grant in grants if grant.get("owner_from") is not None and as_utc(grant["owner_from"]) <= now.astimezone(UTC)), None)


def find_exists_refusal(*, address: str, grants: Sequence[Mapping[str, Any]]) -> WriteRefusal | None:
    """`grant_exists`: a grant already holds the address, of either tier, a waiting one included."""

    if admin_tier_of(address, grants) is None:
        return None

    return WriteRefusal(
        error_code=Code.GRANT_EXISTS,
        status=HTTPStatus.CONFLICT,
        fields=(("email",),),
    )


def find_only_owner_refusal(*, actor: str, grants: Sequence[Mapping[str, Any]]) -> WriteRefusal | None:
    """`grant_only_owner`: only the owner adds, removes, hands over or withdraws, judged inside the transaction."""

    if holds_an_owners_power(actor=actor, grants=grants):
        return None

    return WriteRefusal(
        error_code=Code.GRANT_ONLY_OWNER,
        status=HTTPStatus.FORBIDDEN,
    )


def find_barred_refusal(*, barred: bool) -> WriteRefusal | None:
    """`grant_barred`: the address is on the ban list, which another administrator decided.

    The target's state, so 409: lifting the ban is what changes it.
    """

    if not barred:
        return None

    return WriteRefusal(
        error_code=Code.GRANT_BARRED,
        status=HTTPStatus.CONFLICT,
    )


def find_owner_row_refusal(*, grant: Mapping[str, Any]) -> WriteRefusal | None:
    """`grant_owner`: the `owner` row is removed by no route and named by no handover."""

    if grant.get("admin_tier") != OWNER:
        return None

    return WriteRefusal(
        error_code=Code.GRANT_OWNER,
        status=HTTPStatus.CONFLICT,
    )


def find_handover_refusal(*, grant: Mapping[str, Any], grants: Sequence[Mapping[str, Any]], now: datetime) -> WriteRefusal | None:
    """`grant_handover_waiting` while any row waits on one, `grant_not_in_effect` for a row whose own wait still runs."""

    if any(row.get("owner_from") is not None for row in grants):
        return WriteRefusal(error_code=Code.GRANT_HANDOVER_WAITING, status=HTTPStatus.CONFLICT)

    if not in_effect(grant, now):
        return WriteRefusal(error_code=Code.GRANT_NOT_IN_EFFECT, status=HTTPStatus.CONFLICT)

    return None


@dataclass(frozen=True)
class Notice:
    """One notice a grants write owes: the record it is keyed by, and its facts (`FLGrantData`)."""

    grant_id: ObjectId
    data: dict[str, Any]


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
        data={
            "kind": "grant",
            "change": change,
            "stage": stage,
            "address": address,
            "new_address": new_address,
            "effective_from": effective_from,
        },
    )


def compose_handover_end(grant: Mapping[str, Any]) -> list[Notice]:
    """The withdrawal's notice of a handover a row's end takes with it, whose holders hold a date; none where none waits."""

    if grant.get("owner_from") is None:
        return []

    return [compose_notice(grant_id=grant["_id"], change="handover", stage="withdrawn", address=str(grant["address"]))]
