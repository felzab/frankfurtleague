"""
API · a retired referee's row, judged as the reactivation and the editor's save read it

A person who answered their link either way is asked nothing again: one who objected and is mailed a fresh link is
asked for what they refused. A confirmed referee's address keys their sign-in, retired or not, so only an address
change moves it.
"""

from typing import Any

import pytest

from app.api.schiedsrichter.schemas import FLPatchSchiedsrichterPayload
from app.api.schiedsrichter.services import (
    CONFIRMATION_FIELD,
    EINWILLIGUNG_FIELD,
    find_confirmed_address_refusal,
    owes_reactivation_mint,
    save_moves_the_link,
)
from app.core.codes import Code

EMAIL = "anna.koerner@example.com"


def retired_row(*, declined_at: str | None) -> dict[str, Any]:
    """The fields `INVITE_FIELDS` projects: retired, holding an address a link can go to, and never confirmed."""

    return {
        "inactive_since": "2026-01-01",
        "kontakt": {"email": EMAIL},
        EINWILLIGUNG_FIELD: {"confirmed_at": None},
        CONFIRMATION_FIELD: {"declined_at": declined_at},
    }


@pytest.mark.parametrize(
    ("declined_at", "owed"),
    [
        pytest.param("2026-03-03", False, id="objected"),
    ],
)
def test_a_referee_who_objected_is_minted_no_link(declined_at: str | None, owed: bool):
    assert owes_reactivation_mint(stored=retired_row(declined_at=declined_at)) is owed


def confirmed_row(*, inactive_since: str | None) -> dict[str, Any]:
    """The fields the editor's save projects of a referee who confirmed their own link."""

    return {"kontakt": {"email": EMAIL}, EINWILLIGUNG_FIELD: {"confirmed_at": "2026-02-01"}, "inactive_since": inactive_since}


def sent_address(email: str) -> str:
    """The address the editor's save stores, as its payload hands it on."""

    payload = FLPatchSchiedsrichterPayload.model_validate(
        {
            "name": "Anna Körner",
            "schule": "Bettina-Schule",
            "default_payment": 25,
            "kontakt": {"phone": "+49 69 5550303", "email": email},
            "version": 0,
        }
    )

    return payload.kontakt.email


def test_a_save_moves_a_retired_confirmed_referee_s_address_never_and_a_respelled_address_moves_nothing():
    """The save is refused whole on the move; an address in capitals is the same mailbox, so it lands and owes no link."""

    moved = find_confirmed_address_refusal(
        stored=confirmed_row(inactive_since="2026-03-01"), payload_email=sent_address("a.koerner@neuepost.example.org")
    )
    # The local part in capitals too: the address validator folds a domain itself, a local part only the league's fold.
    respelled = sent_address("Anna.Koerner@EXAMPLE.com")
    serving = confirmed_row(inactive_since=None)

    assert moved is not None and moved.error_code == Code.SCHIEDSRICHTER_ADDRESS_ONLY_PER_CHANGE
    assert find_confirmed_address_refusal(stored=serving, payload_email=respelled) is None
    assert save_moves_the_link(stored=serving, payload_email=respelled) is False
