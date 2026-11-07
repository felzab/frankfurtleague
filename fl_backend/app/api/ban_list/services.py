"""API · the ban list's judgements, spelled apart from the request"""

from collections.abc import Iterable
from http import HTTPStatus

from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import BAN_DURATION_SAISONS, SAISON_ID_LENGTH


def compose_barred_until_saison_id(*, running_saison_id: str) -> str:
    """The last season a ban entered now still covers, `BAN_DURATION_SAISONS` past the running season.

    Raises rather than composing a bound nothing can compare: the activation's lapse orders two of
    these as STRINGS, which holds only at one width.
    """

    # `isascii()` beside `isdigit()`, which alone is true of Arabic-Indic and fullwidth digits: `int`
    # reads those as a year and returns an ASCII bound that sorts nowhere near the id it came from
    # (`app/api/bewerbungen/services.py :: next_saison_id`).
    if not (running_saison_id.isascii() and running_saison_id.isdigit() and len(running_saison_id) == SAISON_ID_LENGTH):
        raise ValueError(f"a ban is bounded against a season id of {SAISON_ID_LENGTH} ASCII digits, and this league's is not one")

    bound = f"{int(running_saison_id) + BAN_DURATION_SAISONS:0{SAISON_ID_LENGTH}d}"

    # The ANSWER's width, where the clause above guards the input's: the format widens rather than
    # truncating, and a wider bound sorts nowhere near the ids it is compared with.
    if len(bound) != SAISON_ID_LENGTH:
        raise ValueError(f"a bound {BAN_DURATION_SAISONS} seasons past {running_saison_id} needs over {SAISON_ID_LENGTH} digits")

    return bound


def find_no_saison_refusal(*, running_saison_id: str | None) -> WriteRefusal | None:
    """`ban_list_no_saison`: while no season is running there is nothing to count five seasons from.

    A ban written there would need an unbounded row, which is the shape the lapse exists to refuse.
    """

    if running_saison_id is not None:
        return None

    return WriteRefusal(
        error_code=Code.BAN_LIST_NO_SAISON,
        status=HTTPStatus.CONFLICT,
    )


def find_admin_refusal(*, address: str, administrators: Iterable[str], incoming: bool) -> WriteRefusal | None:
    """`ban_list_admin`: the address has a row in `grants`, in effect or waiting, or a holder's live change moves to it.

    The target's state, so 409: the ban is refused for what the address is, and ending the grant or the change is what
    changes it. `incoming` is judged here because nothing judges a ban at the switch: the hourly pass would move the grant
    onto an address that cannot sign in or be mailed.
    """

    if not incoming and address not in {sign_in_identifier(administrator) for administrator in administrators}:
        return None

    return WriteRefusal(
        error_code=Code.BAN_LIST_ADMIN,
        status=HTTPStatus.CONFLICT,
    )
