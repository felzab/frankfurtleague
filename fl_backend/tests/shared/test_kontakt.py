from collections.abc import Callable
from typing import Any

import pytest
from pydantic import BaseModel, TypeAdapter, ValidationError

from app.api.address_change.schemas import FLAddressChangeMove, FLAddressChangeRecord
from app.api.bewerbungen.schemas import FLBewerbungRecord
from app.api.outbox.schemas import FLOutboxRow
from app.api.registrierungen.schemas import FLRegistrierungRecord
from app.api.schiedsrichter.schemas import (
    FLPatchSchiedsrichterPayload,
    FLPostSchiedsrichterPayload,
    FLSchiedsrichterKontaktRecord,
    FLSchiedsrichterRecord,
)
from app.api.spieler.schemas import FLSpielerRecord
from app.api.teams.schemas import FLKontaktpersonRecord, FLSaisonTeamKontakteRecord, FLSaisonTeamRecord
from app.shared.schemas.bounds import KONTAKT_EMAIL_MAX_LENGTH
from app.shared.schemas.kontakt import FLKontakt, FLKontaktPayload
from app.shared.schemas.literals import KONTAKT_ROLLEN

Body = Callable[[dict[str, Any]], dict[str, Any]]


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
    """`email-validator` alone refuses 255 without stating a bound, and a mirror copies a number only from a PUBLISHED one."""
    email = FLKontaktPayload.model_json_schema()["properties"]["email"]

    assert email["maxLength"] == KONTAKT_EMAIL_MAX_LENGTH


@pytest.mark.parametrize("local_part_length", [64, 65])
def test_accepts_a_local_part_at_and_over_rfc_5321s_64_octets(kontakt, local_part_length):
    """email-validator applies that cap only under `strict`, which `league_address` does not pass.

    Pinned because the zod mirror matches deliberately: bounding it there alone would refuse an
    address the API stores.
    """
    address = "a" * local_part_length + "@example.com"
    assert FLKontaktPayload.model_validate(kontakt(email=address)).email == address


@pytest.mark.parametrize("phone", ["ext. two", "abc", "+", "12", "0" * 21])
def test_rejects_a_malformed_phone_number(kontakt, phone):
    with pytest.raises(ValidationError):
        FLKontaktPayload.model_validate(kontakt(phone=phone))


@pytest.mark.parametrize(
    "phone",
    ["+49 69 1234567\n", "\n\n1234567", "+49\t69\t1234567", "+49 69 1234567\r", "069 123\x0b4567"],
)
def test_rejects_a_phone_number_carrying_a_control_character(kontakt, phone):
    """A whitespace class inside `^...$` lets a newline through end to end, and the value is stored and rendered as text."""
    with pytest.raises(ValidationError):
        FLKontaktPayload.model_validate(kontakt(phone=phone))


@pytest.mark.parametrize("phone", ["+49 69 1234567", "069 123 45-67", "(069) 1234567", "069.123.4567"])
def test_accepts_the_phone_formats_in_use(kontakt, phone):
    assert FLKontaktPayload.model_validate(kontakt(phone=phone)).phone == phone


def test_the_telephone_is_optional(kontakt):
    assert FLKontaktPayload.model_validate(kontakt(phone=None)).phone is None


def test_coerces_an_empty_telephone_to_none(kontakt):
    """An untouched telephone box must not fail validation: empty means not provided, never malformed."""
    assert FLKontaktPayload.model_validate(kontakt(phone="")).phone is None


def the_referee_body(kontakt: dict[str, Any]) -> dict[str, Any]:
    return {"name": "Anna Pfeife", "schule": None, "default_payment": 20, "kontakt": kontakt}


def the_referee_save_body(kontakt: dict[str, Any]) -> dict[str, Any]:
    return {**the_referee_body(kontakt), "version": 0}


# The contact block alone, and each referee payload whole: a payload redeclaring `kontakt` would
# pass a case over the block's own type.
BODIES = [
    pytest.param(FLKontaktPayload, lambda block: block, id="the contact block"),
    pytest.param(FLPostSchiedsrichterPayload, the_referee_body, id="the referee create"),
    pytest.param(FLPatchSchiedsrichterPayload, the_referee_save_body, id="the referee save"),
]


class TestTheAddressIsRequired:
    """A referee's address is how they learn an administrator entered them, so no payload stores a referee without one."""

    @pytest.mark.parametrize(("payload", "body"), BODIES)
    @pytest.mark.parametrize("email", [None, ""], ids=["null", "an emptied box"])
    def test_a_payload_without_an_address_is_refused(self, kontakt, payload: type[BaseModel], body: Body, email):
        with pytest.raises(ValidationError):
            payload.model_validate(body(kontakt(email=email)))

    @pytest.mark.parametrize(("payload", "body"), BODIES)
    def test_the_same_body_with_an_address_is_accepted(self, kontakt, payload: type[BaseModel], body: Body):
        """The control: a body refused for something besides the address would pass the case above."""
        payload.model_validate(body(kontakt()))


class TestTheReadShapeJudgesNeitherMember:
    """The pair's whole point. Each value here is one the payload above refuses and a stored row can hold."""

    @pytest.mark.parametrize("phone", ["069 1234 ", "069-1234-", "(069) 1234567."])
    def test_a_stored_number_the_narrowed_rule_would_refuse_is_served(self, kontakt, phone):
        """Trailing punctuation, which the rule accepted until a final digit was required of it."""
        assert FLKontakt.model_validate(kontakt(phone=phone)).phone == phone

    def test_a_stored_address_the_payload_would_refuse_is_served(self, kontakt):
        """`email-validator`'s tables move without us, so an address it accepted once can stop passing."""
        address = address_of_length(KONTAKT_EMAIL_MAX_LENGTH + 1)

        assert FLKontakt.model_validate(kontakt(email=address)).email == address

    def test_a_stored_empty_string_is_answered_as_it_stands(self, kontakt):
        """No coercion on the read side: a repaired copy would report a value the collection does not hold."""
        parsed = FLKontakt.model_validate(kontakt(phone="", email=""))

        assert parsed.phone == ""
        assert parsed.email == ""

    def test_both_members_are_still_required_keys(self):
        """The narrowing is the rule and never the key: a row missing one is the 500 this pair exists to avoid."""
        with pytest.raises(ValidationError):
            FLKontakt.model_validate({"phone": None})


# Each stored address field of a record model, at the model that declares it; the record models nesting one are wired
# below, so a field turned back to a plain string is caught at its own model.
STORED_ADDRESSES: list[tuple[type[BaseModel], str]] = [
    (FLRegistrierungRecord, "email"),
    (FLSpielerRecord, "email"),
    (FLSchiedsrichterKontaktRecord, "email"),
    (FLKontaktpersonRecord, "email"),
    (FLAddressChangeRecord, "address"),
    (FLAddressChangeRecord, "email"),
    (FLAddressChangeMove, "old"),
    (FLAddressChangeMove, "new"),
    (FLOutboxRow, "to"),
]


class TestAStoredAddress:
    """Every lookup of a person by address is an equality on the fold, so a row stored otherwise escapes an erasure."""

    @pytest.mark.parametrize(("model", "field"), STORED_ADDRESSES, ids=lambda value: getattr(value, "__name__", value))
    def test_the_read_back_names_one_its_fold_would_change(self, model: type[BaseModel], field: str):
        adapter = TypeAdapter(model.model_fields[field].rebuild_annotation())

        assert adapter.validate_python("tom@beispielschule.de") == "tom@beispielschule.de"
        for unfolded in ("Tom@beispielschule.de", " tom@beispielschule.de"):
            with pytest.raises(ValidationError):
                adapter.validate_python(unfolded)

    def test_the_records_nesting_one_take_the_stored_shape(self):
        """A page's read keeps the plain address; the record model is what the read-back judges."""

        assert FLSaisonTeamRecord.model_fields["kontakte"].annotation == FLSaisonTeamKontakteRecord | None
        assert FLBewerbungRecord.model_fields["kontakte"].annotation == FLSaisonTeamKontakteRecord
        assert FLSchiedsrichterRecord.model_fields["kontakt"].annotation == FLSchiedsrichterKontaktRecord
        assert {seat: FLSaisonTeamKontakteRecord.model_fields[seat].annotation for seat in KONTAKT_ROLLEN} == dict.fromkeys(
            KONTAKT_ROLLEN, FLKontaktpersonRecord | None
        )
