"""FLAddress — the constraints Wave 4 moved here from the frontend's FLAddressSchema."""

import pytest
from pydantic import ValidationError

from app.shared.schemas.addresses import FLAddress


def test_accepts_a_valid_address(address):
    """The positive baseline: without it, every rejection test below could pass on a broken fixture."""
    parsed = FLAddress.model_validate(address())
    assert parsed.plz == "60314"


@pytest.mark.parametrize("field", ["strasse", "stadt"])
def test_rejects_an_empty_required_string(address, field):
    """`strasse` and `stadt` are the two fields with no meaningful empty value."""
    with pytest.raises(ValidationError):
        FLAddress.model_validate(address(**{field: ""}))


def test_accepts_an_empty_stadtteil(address):
    """The counterpart to the test above: `stadtteil` is optional, because not every address has one."""
    assert FLAddress.model_validate(address(stadtteil="")).stadtteil == ""


@pytest.mark.parametrize("plz", ["ABCDE", "1234", "123456", "1234a", ""])
def test_rejects_a_plz_that_is_not_five_digits(address, plz):
    """Wrong length in both directions, plus non-digits — `ABCDE` is what a length-only check let through."""
    with pytest.raises(ValidationError):
        FLAddress.model_validate(address(plz=plz))


def test_accepts_a_five_digit_plz(address):
    """`00000` specifically: all-zero must not be mistaken for empty or falsy anywhere in the chain."""
    assert FLAddress.model_validate(address(plz="00000")).plz == "00000"


@pytest.mark.parametrize("hausnummer", ["12", "12a", "12-14", "12A", "7b", ""])
def test_accepts_the_house_number_charset(address, hausnummer):
    """Plain, suffixed, ranged, both letter cases, and empty — every real shape a venue number takes."""
    assert FLAddress.model_validate(address(hausnummer=hausnummer)).hausnummer == hausnummer


@pytest.mark.parametrize("hausnummer", ["7/3", "12 a", "12½", "twelve"])
def test_rejects_a_house_number_outside_the_charset(address, hausnummer):
    """Slashes, inner spaces, fractions and words — plausible-looking inputs the pattern excludes."""
    with pytest.raises(ValidationError):
        FLAddress.model_validate(address(hausnummer=hausnummer))
