import pytest
from pydantic import ValidationError

from app.shared.schemas.addresses import FLAddress, FLAddressPayload
from app.shared.schemas.bounds import (
    ADDRESS_HAUSNUMMER_MAX_LENGTH,
    ADDRESS_STADT_MAX_LENGTH,
    ADDRESS_STADTTEIL_MAX_LENGTH,
    ADDRESS_STRASSE_MAX_LENGTH,
)

# The filler is per field, not one constant: `hausnummer` has an alphabet, so an `x` would prove the
# pattern refusing a long value and leave the ceiling itself untested.
CAPPED_FIELDS = [
    ("strasse", ADDRESS_STRASSE_MAX_LENGTH, "x"),
    ("stadt", ADDRESS_STADT_MAX_LENGTH, "x"),
    ("hausnummer", ADDRESS_HAUSNUMMER_MAX_LENGTH, "1"),
    ("stadtteil", ADDRESS_STADTTEIL_MAX_LENGTH, "x"),
]

# Neither `hausnummer` nor `stadtteil` is here: an empty house number is legal, not every venue
# having one, and a district is the one part of an address a place can genuinely lack.
NON_EMPTY_FIELDS = ["strasse", "stadt"]


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


@pytest.mark.parametrize(
    "hausnummer",
    [
        "12",
        "12a",
        "12-14",
        "12A",
        # `12bcBC` is not an address: it carries every letter of
        # `fl_backend/app/shared/schemas/addresses.py :: HAUSNUMMER_PATTERN` the rows beside it leave
        # untouched, so a narrowed class, or one that stops repeating, refuses a value the API accepts.
        "12bcBC",
        "",
    ],
)
def test_accepts_the_house_number_charset(address, hausnummer):
    assert FLAddress.model_validate(address(hausnummer=hausnummer)).hausnummer == hausnummer


@pytest.mark.parametrize("hausnummer", ["7/3", "12 a", "12½", "twelve"])
def test_rejects_a_house_number_outside_the_charset(address, hausnummer):
    with pytest.raises(ValidationError):
        FLAddress.model_validate(address(hausnummer=hausnummer))


@pytest.mark.parametrize(("field", "cap", "filler"), CAPPED_FIELDS)
def test_the_payload_refuses_a_value_over_its_cap(address, assert_rejects, field, cap, filler):
    """The error type is asserted, so a value refused by the field's pattern cannot pass for the ceiling working."""
    failure = assert_rejects(FLAddressPayload, address(**{field: filler * (cap + 1)}), field)

    assert [error["type"] for error in failure.errors()] == ["string_too_long"]


@pytest.mark.parametrize(("field", "cap", "filler"), CAPPED_FIELDS)
def test_the_payload_accepts_a_value_at_its_cap(address, field, cap, filler):
    """The bound is inclusive, so the longest legal value must not be the first refused one."""
    at_the_cap = filler * cap

    assert getattr(FLAddressPayload.model_validate(address(**{field: at_the_cap})), field) == at_the_cap


@pytest.mark.parametrize("field", NON_EMPTY_FIELDS)
def test_the_payload_keeps_the_non_empty_floor(address, assert_rejects, field):
    """Both fields are redeclared to carry a ceiling, and a redeclaration drops the floor unless it restates it."""
    assert_rejects(FLAddressPayload, address(**{field: ""}), field)


def test_the_payload_keeps_the_house_number_alphabet(address, assert_rejects):
    """Redeclared for its ceiling, and a redeclaration drops the pattern unless it restates it -- which nothing else would catch.

    `12 a` is the tightest of the refused values, one space away from the legal `12a`.
    """
    assert_rejects(FLAddressPayload, address(hausnummer="12 a"), "hausnummer")


def test_the_payload_still_accepts_an_empty_house_number(address):
    """An empty house number is legal, and a redeclaration carrying a ceiling must not quietly turn the field into a required one."""
    assert FLAddressPayload.model_validate(address(hausnummer="")).hausnummer == ""


@pytest.mark.parametrize(("field", "cap", "filler"), CAPPED_FIELDS)
def test_the_read_model_still_accepts_a_stored_value_the_payload_would_refuse(address, field, cap, filler):
    """A read model refusing a stored address would answer 500 for the whole list because of one row."""
    over_the_cap = filler * (cap + 1)

    assert getattr(FLAddress.model_validate(address(**{field: over_the_cap})), field) == over_the_cap
