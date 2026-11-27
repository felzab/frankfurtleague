from collections.abc import Iterable
from http import HTTPStatus

from app.core.codes import Code
from app.core.exceptions import APIError, FieldFault, FieldPath
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


def find_address_barred_refusal(*, barred: bool, path: FieldPath) -> FieldFault | None:
    """`address_barred` on the box at `path`: a ban holds the address typed there.

    The ban's own add asks it, ahead of `uniq_ban_list_address`, which answers only a race; and so does every write that
    mails a link to a typed address, since no mail but the ban's own notice reaches a banned one.
    """

    if not barred:
        return None

    return FieldFault(path=path, code=Code.ADDRESS_BARRED, status=HTTPStatus.CONFLICT)


def find_admin_refusal(*, address: str, administrators: Iterable[str], incoming: bool) -> FieldFault | None:
    """`ban_list_admin` on the typed address: it has a row in `grants`, in effect or waiting, or a holder's live change moves to it.

    The target's state, so 409: the ban is refused for what the address is, and ending the grant or the change is what
    changes it. `incoming` is judged here because nothing judges a ban at the switch: the hourly pass would move the grant
    onto an address that cannot sign in or be mailed.
    """

    if not incoming and address not in set(administrators):
        return None

    return FieldFault(path=("email",), code=Code.BAN_LIST_ADMIN, status=HTTPStatus.CONFLICT)
