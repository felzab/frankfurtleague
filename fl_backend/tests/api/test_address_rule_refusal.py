import asyncio
import importlib
import json
import pkgutil
import warnings
from collections.abc import Callable, Iterator, Mapping
from typing import Annotated, Any, cast

import pymongo
import pytest
from httpx2 import Response
from pydantic import BaseModel, EmailStr, TypeAdapter, ValidationError
from pydantic.warnings import UnsupportedFieldAttributeWarning

import app
from app.api.identitaet.schemas import FLErasureAdressePayload, FLErasurePayload
from app.core.codes import Code
from app.core.config import API_VERSION
from app.shared.folding import league_address
from app.shared.schemas.bounds import KONTAKT_EMAIL_MAX_LENGTH
from tests.app_client import app_client
from tests.config import BASE_AUTH, UNANSWERED_DEADLINE_S, UNANSWERED_URI

# Built from code points rather than spelled: each renders like the ASCII character beside it, and a
# reader fixing the "typo" would leave every case below comparing ASCII with ASCII.
FULL_WIDTH_STOP = chr(0xFF0E)
FULL_WIDTH_AT = chr(0xFF20)
PARENTHESISED_ONE = chr(0x2474)
HALF_WIDTH_VOICED_MARK = chr(0xFF9E)

UMLAUT_LOCAL_PART = "jürgen@schule.de"

# Every address here is one `EmailStr` accepts, so each refusal below is the address rule's own rather
# than the library's, and its local part is not ASCII.
BEYOND_ASCII = [
    pytest.param(UMLAUT_LOCAL_PART, id="an umlaut"),
    pytest.param(f"{chr(0xFF41)}nna@schule.de", id="a full-width letter"),
    pytest.param(f"anna{FULL_WIDTH_STOP}{FULL_WIDTH_STOP}mueller@schule.de", id="two full-width stops"),
    pytest.param(f"anna{FULL_WIDTH_STOP}@schule.de", id="a full-width stop closing the local part"),
    pytest.param(f"anna{FULL_WIDTH_AT}x@schule.de", id="a full-width at sign"),
    pytest.param(f"{PARENTHESISED_ONE}a@schule.de", id="a parenthesised digit"),
    pytest.param(f"{HALF_WIDTH_VOICED_MARK}anna@schule.de", id="a half-width voiced mark"),
]

# The control each refusal is read against, above ASCII in its DOMAIN alone, so a rule refusing every
# character above ASCII fails here rather than passing the cases above.
UNICODE_DOMAIN = f"anna@m{chr(0xFC)}ller.de"
UNICODE_DOMAIN_STORED = "anna@xn--mller-kva.de"

# The control's answer: a well-formed request that got past validation and reached the database. The
# refusal's is `payload_refused`, and a keying crash answers `unhandled_crash`.
UNREACHED_DATABASE = {Code.DATABASE_FAILED, Code.UNKNOWN_OUTCOME}


def registered(email: str) -> Response:
    body = {"token": "x" * 43, "vorname": "Anna", "nachname": "Müller", "email": email, "position": None, "nummer": None, "stufe": None}

    async def _answered() -> Response:
        async with app_client(UNANSWERED_URI) as http:
            # The app's deadline would hold the control against this unanswered server; nested in
            # this one it cannot extend it. A refused body touches no driver, so no deadline turns a
            # 422 into the control's.
            with pymongo.timeout(UNANSWERED_DEADLINE_S):
                return await http.post(f"/api/v{API_VERSION}/registrierungen", headers=BASE_AUTH, json=body)

    return asyncio.run(_answered())


class TestARegistrationRefusesALocalPartBeyondAscii:
    """A 422 at the box, never a 500 at the ban list's keying.

    The one route keying an address a request carries that no actor check stands before, so a server
    answering nothing still shows where the refusal falls. The administrators' keying payloads are
    held by `TestEveryAddressPayloadHoldsTheSameRule` below, and the two routes keying a STORED
    address by `app/api/schiedsrichter/services.py :: find_missing_address_refusal`.
    """

    @pytest.mark.parametrize("email", BEYOND_ASCII)
    def test_the_address_passes_emailstr(self, email: str):
        """The premise of every case here: an address `EmailStr` refused would be refused with no address rule at all."""

        TypeAdapter(EmailStr).validate_python(email)

    def test_the_address_is_refused_before_anything_is_keyed(self):
        """One shape: `TestEveryAddressPayloadHoldsTheSameRule` crosses every shape with every field."""

        response = registered(UMLAUT_LOCAL_PART)

        assert (response.status_code, response.json()["error_code"]) == (422, Code.PAYLOAD_REFUSED)

    def test_an_address_above_ascii_in_its_domain_alone_reaches_the_database(self):
        """The control: without it, a route refusing every body would pass the case above."""

        response = registered(UNICODE_DOMAIN)

        assert response.status_code == 500, response.json()
        assert response.json()["error_code"] in UNREACHED_DATABASE, response.json()


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
    "app.api.identitaet.schemas.FLSubjectPayload.email",
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
    def test_the_field_stores_a_unicode_domain_as_its_punycode(self, field: str):
        assert ADDRESS_FIELDS[field].validate_python(UNICODE_DOMAIN) == UNICODE_DOMAIN_STORED

    def test_the_refusal_quotes_nothing_of_the_address(self):
        """The message reaches the log line `payload_refused` writes, and an erasure reaches no log sink."""

        local_part = "zorbanax"
        with pytest.raises(ValidationError) as raised:
            ADDRESS_FIELDS["app.api.sperrliste.schemas.FLPostSperrlistePayload.email"].validate_python(
                f"{local_part}{FULL_WIDTH_AT}x@schule.de"
            )

        assert local_part not in raised.value.errors()[0]["msg"]


# The lookup the reveal and the sign-out take, and the erasure's, which takes it beside the request it answers.
LOESCHUNG_PAYLOADS: Mapping[str, Callable[[str], Any]] = {
    "the lookup": lambda email: FLErasureAdressePayload(email=email),
    "the erasure": lambda email: FLErasurePayload(email=email, anlass="Mail vom 30.03.2026"),
}


class TestTheLoeschungLooksUpWhatAnyRuleStored:
    """GDPR Art. 17: a seat stored before today's rules may hold an address they refuse, and refusing it here leaves that person unerasable."""

    @pytest.mark.parametrize("payload", list(LOESCHUNG_PAYLOADS.values()), ids=list(LOESCHUNG_PAYLOADS))
    @pytest.mark.parametrize("email", [*BEYOND_ASCII, pytest.param("anna..mueller@schule.de", id="an address the installed EmailStr refuses")])
    def test_the_loeschung_takes_an_address_no_address_rule_admits(self, email: str, payload: Callable[[str], Any]):
        assert payload(email).email == email

    @pytest.mark.parametrize(
        "email",
        [
            pytest.param("", id="empty"),
            pytest.param("anna.mueller", id="no at sign"),
            pytest.param(f"{'a' * KONTAKT_EMAIL_MAX_LENGTH}@schule.de", id="past the ceiling"),
        ],
    )
    @pytest.mark.parametrize("payload", list(LOESCHUNG_PAYLOADS.values()), ids=list(LOESCHUNG_PAYLOADS))
    def test_the_loeschung_refuses_what_names_no_stored_seat(self, email: str, payload: Callable[[str], Any]):
        with pytest.raises(ValidationError):
            payload(email)


# The payloads whose `email` reaches a `$regex` under no address rule, each with what its route's body
# carries beside it. Raw JSON, because a lone surrogate is a JSON escape no encoder of a `str` writes.
FREE_STRING_PAYLOADS: Mapping[str, tuple[type[FLErasureAdressePayload], str]] = {
    "the lookup": (FLErasureAdressePayload, ""),
    "the erasure": (FLErasurePayload, ', "anlass": "Mail vom 30.03.2026"'),
}

PLAIN_ADDRESS = "a@schule.de"


def validated_raw(payload: str, value: str) -> FLErasureAdressePayload:
    """`value` is JSON string content, escapes included, decoded as the route decodes its body before validating it."""

    model, rest = FREE_STRING_PAYLOADS[payload]

    return model.model_validate(json.loads(f'{{"email": "{value}"{rest}}}'))


class TestAStringNoDatabaseStoresIsRefusedAtTheBox:
    """A lone surrogate reaching the driver fails its encoding as a 500; the payload refuses it first."""

    @pytest.mark.parametrize("payload", list(FREE_STRING_PAYLOADS))
    def test_a_lone_surrogate_is_refused(self, payload: str):
        with pytest.raises(ValidationError) as raised:
            validated_raw(payload, "a\\ud800@schule.de")

        assert [error["loc"] for error in raised.value.errors()] == [("email",)]

    @pytest.mark.parametrize("payload", list(FREE_STRING_PAYLOADS))
    def test_the_same_body_spelled_plainly_is_taken(self, payload: str):
        """The control: without it, a payload refusing every raw body would pass the case above."""

        assert validated_raw(payload, PLAIN_ADDRESS).email == PLAIN_ADDRESS
