import importlib
import pkgutil
import warnings
from collections.abc import Callable, Iterator, Mapping
from typing import Annotated, Any, cast

import pytest
from pydantic import BaseModel, TypeAdapter, ValidationError
from pydantic.warnings import UnsupportedFieldAttributeWarning

import app
from app.api.identity.schemas import FLErasureAddressPayload, FLErasurePayload
from app.shared.folding import league_address
from app.shared.schemas.bounds import KONTAKT_EMAIL_MAX_LENGTH

# Built from code points rather than spelled: each renders like the ASCII character beside it, and a
# reader fixing the "typo" would leave every case below comparing ASCII with ASCII.
FULL_WIDTH_STOP = chr(0xFF0E)
FULL_WIDTH_AT = chr(0xFF20)
PARENTHESISED_ONE = chr(0x2474)
HALF_WIDTH_VOICED_MARK = chr(0xFF9E)

# Every address here is one `EmailStr` accepts, so each refusal below is the address rule's own rather
# than the library's, and its local part is not ASCII.
BEYOND_ASCII = [
    pytest.param("jürgen@schule.de", id="an umlaut"),
    pytest.param(f"{chr(0xFF41)}nna@schule.de", id="a full-width letter"),
    pytest.param(f"anna{FULL_WIDTH_STOP}{FULL_WIDTH_STOP}mueller@schule.de", id="two full-width stops"),
    pytest.param(f"anna{FULL_WIDTH_STOP}@schule.de", id="a full-width stop closing the local part"),
    pytest.param(f"anna{FULL_WIDTH_AT}x@schule.de", id="a full-width at sign"),
    pytest.param(f"{PARENTHESISED_ONE}a@schule.de", id="a parenthesised digit"),
    pytest.param(f"{HALF_WIDTH_VOICED_MARK}anna@schule.de", id="a half-width voiced mark"),
]

# Refused as well: the rule takes no domain above ASCII rather than converting one, so the stored form is the fold of
# what was typed.
UNICODE_DOMAIN = f"anna@m{chr(0xFC)}ller.de"

# The control each refusal is read against, so a rule refusing every address fails here rather than passing the cases
# above.
PLAIN = "Anna@Schule.DE"
PLAIN_STORED = "anna@schule.de"


def _every_module() -> Iterator[str]:
    for module in pkgutil.walk_packages(app.__path__, prefix="app."):
        # `app.asgi` builds the served app from the environment on import, and declares no model.
        if module.name != "app.asgi":
            yield module.name


def _every_model(root: type[BaseModel]) -> Iterator[type[BaseModel]]:
    for model in root.__subclasses__():
        yield model
        yield from _every_model(model)


# The two validators an address type runs: the league's rule, and pydantic's own, which a field typed
# `EmailStr` alone runs without the rule -- the field this sweep is here to find. By name for the
# second, `EmailStr` being an `Annotated` alias to the checker.
EMAIL_STR_VALIDATOR = "EmailStr._validate"

# A nested model is a field of its own, swept as that model's.
NESTED_SCHEMAS = frozenset({"model", "dataclass", "typed-dict", "definition-ref", "definitions"})


def _validates_an_address(schema: Any) -> bool:
    """Whether a field's core schema runs an address validator, a nullable or a union arm included."""

    if isinstance(schema, Mapping):
        if schema.get("type") in NESTED_SCHEMAS:
            return False
        function = schema.get("function")
        if isinstance(function, Mapping):
            validator = function.get("function")
            if validator is league_address or getattr(validator, "__qualname__", "") == EMAIL_STR_VALIDATOR:
                return True
        return any(_validates_an_address(value) for value in schema.values())
    if isinstance(schema, list):
        return any(_validates_an_address(value) for value in schema)

    return False


def _address_fields() -> dict[str, TypeAdapter[Any]]:
    """Every field of every model under `app/` validated as an address, by the league's rule or by `EmailStr` without it."""

    for name in _every_module():
        importlib.import_module(name)

    fields: dict[str, TypeAdapter[Any]] = {}
    for model in _every_model(BaseModel):
        if not model.__module__.startswith("app."):
            continue
        for field_name, field in model.model_fields.items():
            # The field whole, so what it publishes is what the API document carries for it. Its
            # alias means nothing outside its model, which pydantic warns of and which judges nothing here.
            with warnings.catch_warnings(action="ignore", category=UnsupportedFieldAttributeWarning):
                # A field's type read at run time, which no type expression spells, so the checker takes it as `Any`.
                adapter = TypeAdapter(cast(Any, Annotated[field.annotation, field]))
            if _validates_an_address(adapter.core_schema):
                fields[f"{model.__module__}.{model.__qualname__}.{field_name}"] = adapter

    return fields


ADDRESS_FIELDS = _address_fields()

# The payloads the rule was written for, by name: a discovery that finds none of them would leave
# the sweep below comparing nothing and passing.
KNOWN_ADDRESS_FIELDS = {
    "app.api.bewerbungen.schemas.FLBewerbungKontaktEmailPayload.email",
    "app.api.identity.schemas.FLSubjectPayload.email",
    "app.api.registrierungen.schemas.FLPostRegistrierungPayload.email",
    "app.api.sperrliste.schemas.FLPostSperrlistePayload.email",
    "app.api.teams.schemas._KontaktpersonWritablePayload.email",
    "app.shared.schemas.kontakt.FLKontaktPayload.email",
}


class TestEveryAddressPayloadHoldsTheSameRule:
    """The routes taking these payloads key a ban; every other payload stores or joins the same address, so one keyed later crashes there."""

    def test_the_sweep_finds_the_payloads_it_is_for(self):
        assert KNOWN_ADDRESS_FIELDS <= set(ADDRESS_FIELDS)

    @pytest.mark.parametrize("field", sorted(ADDRESS_FIELDS))
    @pytest.mark.parametrize("email", BEYOND_ASCII)
    def test_the_field_refuses_a_local_part_beyond_ascii(self, field: str, email: str):
        with pytest.raises(ValidationError):
            ADDRESS_FIELDS[field].validate_python(email)

    @pytest.mark.parametrize("field", sorted(ADDRESS_FIELDS))
    def test_the_field_refuses_a_unicode_domain(self, field: str):
        with pytest.raises(ValidationError):
            ADDRESS_FIELDS[field].validate_python(UNICODE_DOMAIN)

    @pytest.mark.parametrize("field", sorted(ADDRESS_FIELDS))
    def test_the_field_stores_an_ascii_address_folded(self, field: str):
        assert ADDRESS_FIELDS[field].validate_python(PLAIN) == PLAIN_STORED

    def test_the_refusal_quotes_nothing_of_the_address(self):
        """The message reaches the log line `payload_refused` writes, and an erasure reaches no log sink."""

        local_part = "zorbanax"
        with pytest.raises(ValidationError) as raised:
            ADDRESS_FIELDS["app.api.sperrliste.schemas.FLPostSperrlistePayload.email"].validate_python(
                f"{local_part}{FULL_WIDTH_AT}x@schule.de"
            )

        assert local_part not in raised.value.errors()[0]["msg"]


# The lookup the reveal and the sign-out take, and the erasure's, which takes it beside the request it answers.
ERASURE_PAYLOADS: Mapping[str, Callable[[str], Any]] = {
    "the lookup": lambda email: FLErasureAddressPayload(email=email),
    "the erasure": lambda email: FLErasurePayload(email=email, reason="Mail vom 30.03.2026"),
}


class TestTheErasureLooksUpWhatAnyRuleStored:
    """GDPR Art. 17: a seat stored before today's rules may hold an address they refuse, and refusing it here leaves that person unerasable."""

    @pytest.mark.parametrize("payload", list(ERASURE_PAYLOADS.values()), ids=list(ERASURE_PAYLOADS))
    @pytest.mark.parametrize("email", [*BEYOND_ASCII, pytest.param("anna..mueller@schule.de", id="an address the installed EmailStr refuses")])
    def test_the_erasure_takes_an_address_no_address_rule_admits(self, email: str, payload: Callable[[str], Any]):
        assert payload(email).email == email

    @pytest.mark.parametrize(
        "email",
        [
            pytest.param("", id="empty"),
            pytest.param("anna.mueller", id="no at sign"),
            pytest.param(f"{'a' * KONTAKT_EMAIL_MAX_LENGTH}@schule.de", id="past the ceiling"),
        ],
    )
    @pytest.mark.parametrize("payload", list(ERASURE_PAYLOADS.values()), ids=list(ERASURE_PAYLOADS))
    def test_the_erasure_refuses_what_names_no_stored_seat(self, email: str, payload: Callable[[str], Any]):
        with pytest.raises(ValidationError):
            payload(email)
