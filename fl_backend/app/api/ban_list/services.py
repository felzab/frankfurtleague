from collections.abc import Iterable
from http import HTTPStatus

from app.core.codes import Code
from app.core.exceptions import APIError
from app.shared.schemas.bounds import BAN_DURATION_SAISONS


def compose_barred_until_saison_id(*, running_saison_id: str) -> str:
    """The last season a ban entered now still covers, `BAN_DURATION_SAISONS` past the running season.

    The activation's lapse orders two of these as strings, which holds while every id is four ASCII digits, as the
    season's record model holds them.
    """

    return str(int(running_saison_id) + BAN_DURATION_SAISONS)


def find_no_saison_refusal(*, running_saison_id: str | None) -> APIError | None:
    """`ban_list_no_saison`: while no season is running there is nothing to count `BAN_DURATION_SAISONS` seasons from.

    A ban written there would need an unbounded row, which is the shape the lapse exists to refuse.
    """

    if running_saison_id is not None:
        return None

    return APIError(HTTPStatus.CONFLICT, Code.BAN_LIST_NO_SAISON)


def find_listed_refusal(*, listed: bool) -> APIError | None:
    """`duplicate_key`: the list holds the address already, refused as `uniq_ban_list_address` refuses a second row."""

    if not listed:
        return None

    return APIError(HTTPStatus.CONFLICT, Code.DUPLICATE_KEY)


def find_admin_refusal(*, address: str, administrators: Iterable[str], incoming: bool) -> APIError | None:
    """`ban_list_admin`: the address has a row in `grants`, in effect or waiting, or a holder's live change moves to it.

    The target's state, so 409: the ban is refused for what the address is, and ending the grant or the change is what
    changes it. `incoming` is judged here because nothing judges a ban at the switch: the hourly pass would move the grant
    onto an address that cannot sign in or be mailed.
    """

    if not incoming and address not in set(administrators):
        return None

    return APIError(HTTPStatus.CONFLICT, Code.BAN_LIST_ADMIN)
