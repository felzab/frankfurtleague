import pytest
from pydantic import ValidationError

from app.shared.schemas.addresses import FLAddress


def test_accepts_a_valid_address(address):
    parsed = FLAddress.model_validate(address())
    assert parsed.plz == "60314"


@pytest.mark.parametrize("field", ["strasse", "stadt"])
def test_rejects_an_empty_required_string(address, field):
    with pytest.raises(ValidationError):
        FLAddress.model_validate(address(**{field: ""}))


def test_accepts_an_empty_stadtteil(address):
    assert FLAddress.model_validate(address(stadtteil="")).stadtteil == ""


@pytest.mark.parametrize("plz", ["ABCDE", "1234", "123456", "1234a", ""])
def test_rejects_a_plz_that_is_not_five_digits(address, plz):
    """`ABCDE` is the load-bearing case: a length-only check lets it through."""
    with pytest.raises(ValidationError):
        FLAddress.model_validate(address(plz=plz))


def test_accepts_a_five_digit_plz(address):
    """`00000`: all-zero must read as neither empty nor falsy anywhere in the chain."""
    assert FLAddress.model_validate(address(plz="00000")).plz == "00000"


@pytest.mark.parametrize("hausnummer", ["12", "12a", "12-14", "12A", "7b", ""])
def test_accepts_the_house_number_charset(address, hausnummer):
    assert FLAddress.model_validate(address(hausnummer=hausnummer)).hausnummer == hausnummer


@pytest.mark.parametrize("hausnummer", ["7/3", "12 a", "12½", "twelve"])
def test_rejects_a_house_number_outside_the_charset(address, hausnummer):
    with pytest.raises(ValidationError):
        FLAddress.model_validate(address(hausnummer=hausnummer))
