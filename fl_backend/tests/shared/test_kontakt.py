import pytest
from pydantic import ValidationError

from app.shared.schemas.kontakt import FLKontakt


def test_accepts_a_valid_contact(kontakt):
    parsed = FLKontakt.model_validate(kontakt())
    assert parsed.email == "kontakt@example.com"


@pytest.mark.parametrize("email", ["not-an-email", "@example.com", "a@", "a@b", "a b@example.com"])
def test_rejects_a_malformed_email(kontakt, email):
    """`a@b` is the load-bearing case: a naive 'contains an @' check lets it through."""
    with pytest.raises(ValidationError):
        FLKontakt.model_validate(kontakt(email=email))


@pytest.mark.parametrize("telefon", ["ext. two", "abc", "+", "12", "0" * 21])
def test_rejects_a_malformed_phone_number(kontakt, telefon):
    with pytest.raises(ValidationError):
        FLKontakt.model_validate(kontakt(telefon=telefon))


@pytest.mark.parametrize(
    "telefon",
    ["+49 69 1234567\n", "\n\n1234567", "+49\t69\t1234567", "+49 69 1234567\r", "069 123\x0b4567"],
)
def test_rejects_a_phone_number_carrying_a_control_character(kontakt, telefon):
    """A whitespace class inside `^...$` lets a newline through end to end, and the value is stored and rendered as text."""
    with pytest.raises(ValidationError):
        FLKontakt.model_validate(kontakt(telefon=telefon))


@pytest.mark.parametrize("telefon", ["+49 69 1234567", "069 123 45-67", "(069) 1234567", "069.123.4567"])
def test_accepts_the_phone_formats_in_use(kontakt, telefon):
    assert FLKontakt.model_validate(kontakt(telefon=telefon)).telefon == telefon


def test_treats_both_fields_as_optional(kontakt):
    parsed = FLKontakt.model_validate(kontakt(telefon=None, email=None))
    assert parsed.telefon is None
    assert parsed.email is None


def test_coerces_empty_strings_to_none(kontakt):
    """An untouched contact box must not fail validation: empty means not provided, never malformed."""
    parsed = FLKontakt.model_validate(kontakt(telefon="", email=""))
    assert parsed.telefon is None
    assert parsed.email is None
