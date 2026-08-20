import pytest
from pydantic import ValidationError

from app.shared.schemas.addresses import FLAddress, FLAddressPayload
from app.shared.schemas.bounds import ADDRESS_STADT_MAX_LENGTH, ADDRESS_STRASSE_MAX_LENGTH

CAPPED_FIELDS = [("strasse", ADDRESS_STRASSE_MAX_LENGTH), ("stadt", ADDRESS_STADT_MAX_LENGTH)]


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


@pytest.mark.parametrize(("field", "cap"), CAPPED_FIELDS)
def test_the_payload_refuses_a_value_over_its_cap(address, assert_rejects, field, cap):
    assert_rejects(FLAddressPayload, address(**{field: "x" * (cap + 1)}), field)


@pytest.mark.parametrize(("field", "cap"), CAPPED_FIELDS)
def test_the_payload_accepts_a_value_at_its_cap(address, field, cap):
    """The bound is inclusive, so the longest legal value must not be the first refused one."""
    at_the_cap = "x" * cap

    assert getattr(FLAddressPayload.model_validate(address(**{field: at_the_cap})), field) == at_the_cap


@pytest.mark.parametrize("field", [field for field, _ in CAPPED_FIELDS])
def test_the_payload_keeps_the_non_empty_floor(address, assert_rejects, field):
    """Both fields are redeclared to carry a ceiling, and a redeclaration drops the floor unless it restates it."""
    assert_rejects(FLAddressPayload, address(**{field: ""}), field)


@pytest.mark.parametrize(("field", "cap"), CAPPED_FIELDS)
def test_the_read_model_still_accepts_a_stored_value_the_payload_would_refuse(address, field, cap):
    """A read model refusing a stored address would answer 500 for the whole list because of one row."""
    over_the_cap = "x" * (cap + 1)

    assert getattr(FLAddress.model_validate(address(**{field: over_the_cap})), field) == over_the_cap
