"""What every mailed link asking a person to confirm themselves judges alike: its deadline, and the age it asks."""

from http import HTTPStatus
from typing import Any

from app.core.codes import Code
from app.core.exceptions import FieldFault
from app.shared.age import whole_years_between
from app.shared.schemas.bounds import BIRTH_DATE_MAX_AGE_YEARS


def deadline_passed(*, deadline: Any, today: str) -> bool:
    """Whether a link's deadline is strictly behind `today`; anything but a stored day is no deadline passed.

    Strictly, so the deadline's own day still answers: the mail names that day, and a link dying at the midnight before it
    lies to the person reading the mail. A caller reading a link without one as over says so itself.
    """

    return isinstance(deadline, str) and deadline < today


def find_age_refusal(*, birth_date: str, today: str, minimum_age: int) -> FieldFault | None:
    """`confirmation_age`: the typed birthdate is under the caller's floor or past every birth date's ceiling, in whole years.

    The floor is the caller's, each flow judging its own. Its own code rather than a `payload_refused`, whose mark on the
    field names no floor, and the bounds go with it, so the field's message names the range the write judges. Judged
    before any write, so a mistyped year spends nothing.
    """

    if minimum_age <= whole_years_between(born=birth_date, today=today) <= BIRTH_DATE_MAX_AGE_YEARS:
        return None

    return FieldFault(
        path=("birth_date",),
        code=Code.CONFIRMATION_AGE,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        bounds={"min": minimum_age, "max": BIRTH_DATE_MAX_AGE_YEARS},
    )
