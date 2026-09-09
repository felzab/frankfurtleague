import pytest
from pydantic import ValidationError

from app.shared.schemas.bounds import KONTAKT_EMAIL_MAX_LENGTH
from app.shared.schemas.kontakt import FLKontakt, FLKontaktPayload


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
    parsed = FLKontaktPayload.model_validate(kontakt())
    assert parsed.email == "kontakt@example.com"


@pytest.mark.parametrize("email", ["not-an-email", "@example.com", "a@", "a@b", "a b@example.com"])
def test_rejects_a_malformed_email(kontakt, email):
    """`a@b` is the load-bearing case: a naive 'contains an @' check lets it through."""
    with pytest.raises(ValidationError):
        FLKontaktPayload.model_validate(kontakt(email=email))


def test_accepts_an_address_at_the_length_ceiling(kontakt):
    address = address_of_length(KONTAKT_EMAIL_MAX_LENGTH)
    # Asserted so a helper that built the wrong length reads as that, not as the ceiling moving.
    assert len(address) == KONTAKT_EMAIL_MAX_LENGTH
    assert FLKontaktPayload.model_validate(kontakt(email=address)).email == address


def test_rejects_an_address_one_character_over_the_length_ceiling(kontakt):
    """That 255 is refused, not WHICH bound refuses it: email-validator's own ceiling is this number too, so the case below pins ours."""
    with pytest.raises(ValidationError):
        FLKontaktPayload.model_validate(kontakt(email=address_of_length(KONTAKT_EMAIL_MAX_LENGTH + 1)))


def test_publishes_the_ceiling_the_zod_mirror_copies():
    """`EmailStr` alone refuses 255 without stating a bound, and a mirror copies a number only from a PUBLISHED one."""
    email = FLKontaktPayload.model_json_schema()["properties"]["email"]

    assert [option["maxLength"] for option in email["anyOf"] if "maxLength" in option] == [KONTAKT_EMAIL_MAX_LENGTH]


@pytest.mark.parametrize("local_part_length", [64, 65])
def test_accepts_a_local_part_at_and_over_rfc_5321s_64_octets(kontakt, local_part_length):
    """email-validator applies that cap only under `strict`, which `EmailStr` does not pass.

    Pinned because the zod mirror matches deliberately: bounding it there alone would refuse an
    address the API stores.
    """
    address = "a" * local_part_length + "@example.com"
    assert FLKontaktPayload.model_validate(kontakt(email=address)).email == address


@pytest.mark.parametrize("telefon", ["ext. two", "abc", "+", "12", "0" * 21])
def test_rejects_a_malformed_phone_number(kontakt, telefon):
    with pytest.raises(ValidationError):
        FLKontaktPayload.model_validate(kontakt(telefon=telefon))


@pytest.mark.parametrize(
    "telefon",
    ["+49 69 1234567\n", "\n\n1234567", "+49\t69\t1234567", "+49 69 1234567\r", "069 123\x0b4567"],
)
def test_rejects_a_phone_number_carrying_a_control_character(kontakt, telefon):
    """A whitespace class inside `^...$` lets a newline through end to end, and the value is stored and rendered as text."""
    with pytest.raises(ValidationError):
        FLKontaktPayload.model_validate(kontakt(telefon=telefon))


@pytest.mark.parametrize("telefon", ["+49 69 1234567", "069 123 45-67", "(069) 1234567", "069.123.4567"])
def test_accepts_the_phone_formats_in_use(kontakt, telefon):
    assert FLKontaktPayload.model_validate(kontakt(telefon=telefon)).telefon == telefon


def test_treats_both_fields_as_optional(kontakt):
    parsed = FLKontaktPayload.model_validate(kontakt(telefon=None, email=None))
    assert parsed.telefon is None
    assert parsed.email is None


def test_coerces_empty_strings_to_none(kontakt):
    """An untouched contact box must not fail validation: empty means not provided, never malformed."""
    parsed = FLKontaktPayload.model_validate(kontakt(telefon="", email=""))
    assert parsed.telefon is None
    assert parsed.email is None


class TestTheReadShapeJudgesNeitherMember:
    """The pair's whole point. Each value here is one the payload above refuses and a stored row can hold."""

    @pytest.mark.parametrize("telefon", ["069 1234 ", "069-1234-", "(069) 1234567."])
    def test_a_stored_number_the_narrowed_rule_would_refuse_is_served(self, kontakt, telefon):
        """Trailing punctuation, which the rule accepted until a final digit was required of it."""
        assert FLKontakt.model_validate(kontakt(telefon=telefon)).telefon == telefon

    def test_a_stored_address_the_payload_would_refuse_is_served(self, kontakt):
        """`email-validator`'s tables move without us, so an address it accepted once can stop passing."""
        address = address_of_length(KONTAKT_EMAIL_MAX_LENGTH + 1)

        assert FLKontakt.model_validate(kontakt(email=address)).email == address

    def test_a_stored_empty_string_is_answered_as_it_stands(self, kontakt):
        """No coercion on the read side: a repaired copy would report a value the collection does not hold."""
        parsed = FLKontakt.model_validate(kontakt(telefon="", email=""))

        assert parsed.telefon == ""
        assert parsed.email == ""

    def test_both_members_are_still_required_keys(self, kontakt):
        """The narrowing is the rule and never the key: a row missing one is the 500 this pair exists to avoid."""
        with pytest.raises(ValidationError):
            FLKontakt.model_validate({"telefon": None})
