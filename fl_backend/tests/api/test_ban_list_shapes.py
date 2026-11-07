import pytest
from pydantic import ValidationError

from app.api.ban_list.schemas import FLPostBanListEntryPayload


@pytest.mark.parametrize(
    "ban_reason",
    [
        pytest.param("zorbanax@beispielschule.de", id="an address alone"),
        pytest.param("Falsche Angabe, siehe zorbanax@beispielschule.de", id="an address inside a sentence"),
        pytest.param("Kontakt: ANNA@XN--MLLER-KVA.DE", id="an address in a punycode domain"),
    ],
)
def test_a_reason_carrying_an_address_is_refused(ban_reason: str):
    """A reason is served, mailed and outlives the erasure, so an address typed here is a second person's on a row they cannot reach."""

    with pytest.raises(ValidationError) as raised:
        FLPostBanListEntryPayload(email="admin@beispielschule.de", ban_reason=ban_reason, notify=False)

    assert [error["type"] for error in raised.value.errors()] == ["address_in_free_text"]
