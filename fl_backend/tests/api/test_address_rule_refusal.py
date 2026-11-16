from collections.abc import Callable, Mapping
from typing import Any, Final

import pytest
from pydantic import TypeAdapter, ValidationError

from app.api.identity.schemas import FLErasureAddressPayload, FLErasurePayload
from app.shared.folding import league_address
from app.shared.schemas.kontakt import CustomEmail

# Built from code points rather than spelled: each renders like the ASCII character beside it, and a
# reader fixing the "typo" would leave every case below comparing ASCII with ASCII.
FULL_WIDTH_STOP = chr(0xFF0E)
FULL_WIDTH_AT = chr(0xFF20)
PARENTHESISED_ONE = chr(0x2474)
HALF_WIDTH_VOICED_MARK = chr(0xFF9E)

# Every address here is one `EmailStr` accepts, so each refusal below is the address rule's own rather
# than the library's, and its local part is not ASCII.
BEYOND_ASCII = [
    pytest.param("jürgen@schule.example.org", id="an umlaut"),
    pytest.param(f"{chr(0xFF41)}nna@schule.example.org", id="a full-width letter"),
    pytest.param(f"anna{FULL_WIDTH_STOP}{FULL_WIDTH_STOP}mueller@schule.example.org", id="two full-width stops"),
    pytest.param(f"anna{FULL_WIDTH_STOP}@schule.example.org", id="a full-width stop closing the local part"),
    pytest.param(f"anna{FULL_WIDTH_AT}x@schule.example.org", id="a full-width at sign"),
    pytest.param(f"{PARENTHESISED_ONE}a@schule.example.org", id="a parenthesised digit"),
    pytest.param(f"{HALF_WIDTH_VOICED_MARK}anna@schule.example.org", id="a half-width voiced mark"),
]

# The league's address type, as every address payload under `app/` declares it.
ADDRESS: Final = TypeAdapter(CustomEmail)


def test_the_refusal_quotes_nothing_of_the_address():
    """The message reaches the log line `payload_refused` writes, and an erasure reaches no log sink."""

    local_part = "zorbanax"
    with pytest.raises(ValidationError) as raised:
        ADDRESS.validate_python(f"{local_part}{FULL_WIDTH_AT}x@schule.example.org")

    assert local_part not in raised.value.errors()[0]["msg"]


@pytest.mark.parametrize("email", BEYOND_ASCII)
def test_the_rule_refuses_each_local_part_beyond_ascii(email: str):
    """Once, on the rule every address field runs: `tests/shared/email_addresses.json` names none of these spellings."""

    with pytest.raises(ValueError):
        league_address(email)


# The lookup the reveal and the sign-out take, and the erasure's, which takes it beside the request it answers.
ERASURE_PAYLOADS: Mapping[str, Callable[[str], Any]] = {
    "the lookup": lambda email: FLErasureAddressPayload(email=email),
    "the erasure": lambda email: FLErasurePayload(email=email, reason="Mail vom 30.03.2026"),
}


class TestTheErasureLooksUpWhatAnyRuleStored:
    """GDPR Art. 17: a seat stored before today's rules may hold an address they refuse, and refusing it here leaves that person unerasable."""

    @pytest.mark.parametrize("payload", list(ERASURE_PAYLOADS.values()), ids=list(ERASURE_PAYLOADS))
    # One address the league's rule refuses and one the installed `EmailStr` does: the field runs neither.
    @pytest.mark.parametrize(
        "email",
        [
            pytest.param("jürgen@schule.example.org", id="an address the league's rule refuses"),
            pytest.param("anna..mueller@schule.example.org", id="an address the installed EmailStr refuses"),
        ],
    )
    def test_the_erasure_takes_an_address_no_address_rule_admits(self, email: str, payload: Callable[[str], Any]):
        assert payload(email).email == email
