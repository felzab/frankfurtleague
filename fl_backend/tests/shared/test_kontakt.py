import pytest
from pydantic import ValidationError

from app.shared.schemas.bounds import KONTAKT_EMAIL_MAX_LENGTH
from app.shared.schemas.kontakt import FLKontakt


# Every domain label stays under the 63-octet cap, so a boundary case can only fail on the total.
def address_of_length(total: int) -> str:
    local = "a" * 64
    remaining = total - len(local) - 1
    labels: list[str] = []
    while remaining > 0:
        size = min(60, remaining)
        labels.append("b" * size)
        remaining -= size
        if remaining > 0:
            remaining -= 1
    domain = ".".join(labels)
    return f"{local}@{domain}"


def test_accepts_a_valid_contact(kontakt):
    parsed = FLKontakt.model_validate(kontakt())
    assert parsed.email == "kontakt@example.com"


@pytest.mark.parametrize("email", ["not-an-email", "@example.com", "a@", "a@b", "a b@example.com"])
def test_rejects_a_malformed_email(kontakt, email):
    """`a@b` is the load-bearing case: a naive 'contains an @' check lets it through."""
    with pytest.raises(ValidationError):
        FLKontakt.model_validate(kontakt(email=email))


def test_accepts_an_address_at_the_length_ceiling(kontakt):
    address = address_of_length(KONTAKT_EMAIL_MAX_LENGTH)
    # Asserted so a helper that built the wrong length reads as that, not as the ceiling moving.
    assert len(address) == KONTAKT_EMAIL_MAX_LENGTH
    assert FLKontakt.model_validate(kontakt(email=address)).email == address


def test_rejects_an_address_one_character_over_the_length_ceiling(kontakt):
    """The boundary, not a wildly long string: a bound set anywhere passes that, and only this pins the number the zod mirror copies."""
    with pytest.raises(ValidationError):
        FLKontakt.model_validate(kontakt(email=address_of_length(KONTAKT_EMAIL_MAX_LENGTH + 1)))


@pytest.mark.parametrize("local_part_length", [64, 65])
def test_accepts_a_local_part_at_and_over_rfc_5321s_64_octets(kontakt, local_part_length):
    """email-validator applies that cap only under `strict`, which `EmailStr` does not pass.

    Pinned because the zod mirror matches deliberately: bounding it there alone would refuse an
    address the API stores.
    """
    address = "a" * local_part_length + "@example.com"
    assert FLKontakt.model_validate(kontakt(email=address)).email == address


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
