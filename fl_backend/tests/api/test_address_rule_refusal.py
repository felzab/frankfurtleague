import asyncio
import importlib
import pkgutil
import warnings
from collections.abc import Iterator, Mapping
from typing import Annotated, Any

import pymongo
import pytest
from httpx2 import Response
from pydantic import BaseModel, EmailStr, TypeAdapter, ValidationError
from pydantic.warnings import UnsupportedFieldAttributeWarning

import app
from app.api.kontakte.schemas import FLKontaktErasurePayload
from app.core.config import API_VERSION
from app.core.exception_handlers import DATABASE_FAILED, PAYLOAD_REFUSED, UNKNOWN_OUTCOME
from app.core.security import ACTOR_HEADER
from app.shared.schemas.bounds import KONTAKT_EMAIL_MAX_LENGTH
from tests.app_client import app_client
from tests.config import ADMIN_AUTH, BASE_AUTH, UNANSWERED_DEADLINE_S, UNANSWERED_URI

# Built from code points rather than spelled: each renders like the ASCII character beside it, and a
# reader fixing the "typo" would leave every case below comparing ASCII with ASCII.
FULL_WIDTH_STOP = chr(0xFF0E)
FULL_WIDTH_AT = chr(0xFF20)
PARENTHESISED_ONE = chr(0x2474)
HALF_WIDTH_VOICED_MARK = chr(0xFF9E)

UMLAUT_LOCAL_PART = "jürgen@schule.de"

# Every address here is one `EmailStr` accepts, so each refusal below is the address rule's own rather
# than the library's, and its local part is not ASCII (`docs/backend/spec.md :: I332`).
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
# refusal's is `REQ-VAL-001`, and a keying crash answers `SRV-FAIL-001`. Either database code, since
# which one a cut write answers is `app/core/exception_handlers.py :: db_exception_handler`'s question.
UNREACHED_DATABASE = {DATABASE_FAILED, UNKNOWN_OUTCOME}

ADMIN_HEADERS = {**ADMIN_AUTH, ACTOR_HEADER: "admin@frankfurtleague.de"}

REFEREE_ID = "6890a1b2c3d4e5f607830001"


def _referee(email: str) -> dict[str, Any]:
    return {"name": "Anna Pfeife", "schule": None, "default_payment": 20, "kontakt": {"telefon": None, "email": email}}


def _registration(email: str) -> dict[str, Any]:
    return {"token": "x" * 43, "vorname": "Anna", "nachname": "Müller", "email": email, "position": None, "nummer": None, "stufe": None}


# The four routes that key an address a request carries on the ban list, each with the body it needs
# and the headers its guards ask for: a guard refusing first would answer 401 and hide the judgement.
ROUTES = {
    "POST /registrierungen": ("POST", "/registrierungen", BASE_AUTH, _registration),
    "POST /sperrliste": ("POST", "/sperrliste", ADMIN_HEADERS, lambda email: {"email": email, "grund": "Falsche Angabe"}),
    "POST /schiedsrichter": ("POST", "/schiedsrichter", ADMIN_HEADERS, _referee),
    "PATCH /schiedsrichter/{schiedsrichter_id}": ("PATCH", f"/schiedsrichter/{REFEREE_ID}", ADMIN_HEADERS, _referee),
}


def answered(route: str, email: str) -> Response:
    method, path, headers, body = ROUTES[route]

    return requested(method, path, headers, json=body(email))


def requested(method: str, path: str, headers: Mapping[str, str], **sent: Any) -> Response:
    async def _answered() -> Response:
        async with app_client(UNANSWERED_URI) as http:
            # The app's request deadline would hold each control against this unanswered server,
            # and nested inside this one it cannot extend it. A refused body touches no driver
            # call, so no deadline turns a 422 into the control's answer.
            with pymongo.timeout(UNANSWERED_DEADLINE_S):
                return await http.request(method, f"/api/v{API_VERSION}{path}", headers=headers, **sent)

    return asyncio.run(_answered())


class TestEveryKeyingRouteRefusesALocalPartBeyondAscii:
    """`docs/backend/spec.md :: I329`: a 422 at the box, never a 500 at the ban list's keying.

    The two routes keying a STORED address are held by `app/api/schiedsrichter/services.py :: find_missing_address_refusal` instead.
    """

    @pytest.mark.parametrize("email", BEYOND_ASCII)
    def test_the_address_passes_emailstr(self, email: str):
        """The premise of every case here: an address `EmailStr` refused would be refused with no address rule at all."""

        TypeAdapter(EmailStr).validate_python(email)

    @pytest.mark.parametrize("route", list(ROUTES))
    def test_the_address_is_refused_before_anything_is_keyed(self, route: str):
        """One shape per route: `TestEveryAddressPayloadHoldsTheSameRule` crosses every shape with every field these routes take."""

        response = answered(route, UMLAUT_LOCAL_PART)

        assert (response.status_code, response.json()["error_code"]) == (422, PAYLOAD_REFUSED)

    @pytest.mark.parametrize("route", list(ROUTES))
    def test_an_address_above_ascii_in_its_domain_alone_reaches_the_database(self, route: str):
        """The control: without it, a route refusing every body would pass the matrix above."""

        response = answered(route, UNICODE_DOMAIN)

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


def _publishes_an_address(schema: Mapping[str, Any]) -> bool:
    # A nullable field publishes its type as one arm of `anyOf`.
    return any(arm.get("format") == "email" for arm in [schema, *schema.get("anyOf", [])])


def _address_fields() -> dict[str, TypeAdapter[Any]]:
    """Every field of every model under `app/` publishing itself as an address, found by that contract rather than by the rule under test."""

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
                adapter = TypeAdapter(Annotated[field.annotation, field])
            if _publishes_an_address(adapter.json_schema()):
                fields[f"{model.__module__}.{model.__qualname__}.{field_name}"] = adapter

    return fields


ADDRESS_FIELDS = _address_fields()

# The payloads the rule was written for, by name: a discovery that finds none of them would leave
# the sweep below comparing nothing and passing.
KNOWN_ADDRESS_FIELDS = {
    "app.api.bewerbungen.schemas.FLBewerbungKontaktEmailPayload.email",
    "app.api.identitaet.schemas.FLSubjektPayload.email",
    "app.api.registrierungen.schemas.FLPostRegistrierungPayload.email",
    "app.api.sperrliste.schemas.FLPostSperrlistePayload.email",
    "app.api.teams.schemas._KontaktpersonWritablePayload.email",
    "app.shared.schemas.kontakt.FLKontaktPayload.email",
}


class TestEveryAddressPayloadHoldsTheSameRule:
    """The four routes above key a ban; every other payload stores or joins the same address, so one keyed later crashes there."""

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
        """The message reaches the log line `REQ-VAL-001` writes, and an erasure reaches no log sink."""

        local_part = "zorbanax"
        with pytest.raises(ValidationError) as raised:
            ADDRESS_FIELDS["app.api.sperrliste.schemas.FLPostSperrlistePayload.email"].validate_python(
                f"{local_part}{FULL_WIDTH_AT}x@schule.de"
            )

        assert local_part not in raised.value.errors()[0]["msg"]


class TestTheErasureLooksUpWhatAnyRuleStored:
    """GDPR Art. 17: a seat stored before today's rules may hold an address they refuse, and refusing it here leaves that person unerasable."""

    @pytest.mark.parametrize("email", [*BEYOND_ASCII, pytest.param("anna..mueller@schule.de", id="an address the installed EmailStr refuses")])
    def test_the_erasure_takes_an_address_no_address_rule_admits(self, email: str):
        assert FLKontaktErasurePayload(email=email).email == email

    @pytest.mark.parametrize(
        "email",
        [
            pytest.param("", id="empty"),
            pytest.param("anna.mueller", id="no at sign"),
            pytest.param(f"{'a' * KONTAKT_EMAIL_MAX_LENGTH}@schule.de", id="past the ceiling"),
        ],
    )
    def test_the_erasure_refuses_what_names_no_stored_seat(self, email: str):
        with pytest.raises(ValidationError):
            FLKontaktErasurePayload(email=email)


# The routes whose `email` reaches a `$regex` under no address rule. Raw bytes, because a lone
# surrogate is a JSON escape no encoder of a `str` writes.
FREE_STRING_ROUTES = {
    "POST /kontakte/erasure/ansicht": "/kontakte/erasure/ansicht",
    "POST /kontakte/erasure": "/kontakte/erasure",
}

PLAIN_ADDRESS = "a@schule.de"


def posted_raw(route: str, value: str) -> Response:
    """`value` is JSON string content, escapes included, placed between the quotes unchanged."""

    body = f'{{"email": "{value}"}}'.encode("ascii")

    return requested("POST", FREE_STRING_ROUTES[route], {**ADMIN_HEADERS, "content-type": "application/json"}, content=body)


class TestAStringNoDatabaseStoresIsRefusedAtTheBox:
    """A lone surrogate reaching the driver fails its encoding as a 500; the payload refuses it first."""

    @pytest.mark.parametrize("route", list(FREE_STRING_ROUTES))
    def test_a_lone_surrogate_is_refused(self, route: str):
        response = posted_raw(route, "a\\ud800@schule.de")

        assert (response.status_code, response.json()["error_code"]) == (422, PAYLOAD_REFUSED)

    @pytest.mark.parametrize("route", list(FREE_STRING_ROUTES))
    def test_the_same_body_spelled_plainly_reaches_the_database(self, route: str):
        """The control: without it, a route refusing every raw body would pass the case above."""

        response = posted_raw(route, PLAIN_ADDRESS)

        assert response.status_code == 500, response.json()
        assert response.json()["error_code"] in UNREACHED_DATABASE, response.json()
