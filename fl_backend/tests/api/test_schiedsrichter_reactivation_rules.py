"""
API · whom bringing a retired referee back asks again, judged on the row as the reactivation reads it

A person who answered their link either way is asked nothing again: one who objected and is mailed a fresh link is
asked for what they refused.
"""

from typing import Any

import pytest

from app.api.schiedsrichter.services import CONFIRMATION_FIELD, EINWILLIGUNG_FIELD, owes_reactivation_mint


def retired_row(*, declined_at: str | None) -> dict[str, Any]:
    """The fields `INVITE_FIELDS` projects: retired, holding an address a link can go to, and never confirmed."""

    return {
        "inactive_since": "2026-01-01",
        "kontakt": {"email": "anna.koerner@example.com"},
        EINWILLIGUNG_FIELD: {"confirmed_at": None},
        CONFIRMATION_FIELD: {"declined_at": declined_at},
    }


@pytest.mark.parametrize(
    ("declined_at", "owed"),
    [
        # The control, without which the objection's case could pass on a row that owes no mint for another reason.
        pytest.param(None, True, id="unanswered"),
        pytest.param("2026-03-03", False, id="objected"),
    ],
)
def test_a_referee_who_objected_is_minted_no_link(declined_at: str | None, owed: bool):
    assert owes_reactivation_mint(stored=retired_row(declined_at=declined_at)) is owed
