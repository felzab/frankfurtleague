"""
FLKontakt — email and phone validation.

Before Wave 4 the backend applied **none**: both fields were a bare optional string, so the only
check anywhere was the frontend's. These tests pin the rules now that the backend owns them.
"""

import pytest
from pydantic import ValidationError

from app.shared.schemas.kontakt import FLKontakt


def test_accepts_a_valid_contact(kontakt):
    parsed = FLKontakt.model_validate(kontakt())
    assert parsed.email == "kontakt@example.com"


@pytest.mark.parametrize("email", ["not-an-email", "@example.com", "a@", "a@b", "a b@example.com"])
def test_rejects_a_malformed_email(kontakt, email):
    with pytest.raises(ValidationError):
        FLKontakt.model_validate(kontakt(email=email))


@pytest.mark.parametrize("telefon", ["ext. two", "abc", "+", "12", "0" * 21])
def test_rejects_a_malformed_phone_number(kontakt, telefon):
    with pytest.raises(ValidationError):
        FLKontakt.model_validate(kontakt(telefon=telefon))


@pytest.mark.parametrize("telefon", ["+49 69 1234567", "069 123 45-67", "(069) 1234567", "069.123.4567"])
def test_accepts_the_phone_formats_in_use(kontakt, telefon):
    assert FLKontakt.model_validate(kontakt(telefon=telefon)).telefon == telefon


def test_treats_both_fields_as_optional(kontakt):
    parsed = FLKontakt.model_validate(kontakt(telefon=None, email=None))
    assert parsed.telefon is None
    assert parsed.email is None


# The "" -> None coercion predates Wave 4 and must survive it: an empty form field means
# "not provided", not "malformed".
def test_coerces_empty_strings_to_none(kontakt):
    parsed = FLKontakt.model_validate(kontakt(telefon="", email=""))
    assert parsed.telefon is None
    assert parsed.email is None
