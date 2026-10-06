import functools
from collections.abc import Callable, Iterator, Mapping, Sequence
from collections.abc import Set as AbstractSet
from dataclasses import dataclass
from enum import StrEnum
from http import HTTPStatus
from typing import Any, NamedTuple

from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.routing import APIRoute, iter_route_contexts
from pydantic import BaseModel
from pydantic.json_schema import models_json_schema
from starlette.convertors import Convertor

from app.api.aktionen.admin_router import router as aktionen_admin_router
from app.api.berechtigungen.admin_router import router as berechtigungen_admin_router
from app.api.berechtigungen.sweep_router import router as berechtigungen_sweep_router
from app.api.bewerbungen.admin_router import router as bewerbungen_admin_router
from app.api.bewerbungen.einwilligung_router import router as bewerbungen_einwilligung_router
from app.api.bewerbungen.person_router import router as bewerbungen_person_router
from app.api.bewerbungen.public_router import router as bewerbungen_public_router
from app.api.bewerbungen.router import router as bewerbungen_router
from app.api.bewerbungen.sweep_router import router as bewerbungen_sweep_router
from app.api.bewerbungen.zustellung_router import router as bewerbungen_zustellung_router
from app.api.einwilligung.router import router as einwilligung_router
from app.api.identitaet.router import router as identitaet_router
from app.api.kontakte.admin_router import router as kontakte_admin_router
from app.api.konto.router import router as konto_router
from app.api.registrierungen.einwilligung_router import router as registrierungen_einwilligung_router
from app.api.registrierungen.person_router import router as registrierungen_person_router
from app.api.registrierungen.public_router import router as registrierungen_public_router
from app.api.registrierungen.router import router as registrierungen_router
from app.api.registrierungen.selbst_router import router as registrierungen_selbst_router
from app.api.registrierungen.sweep_router import router as registrierungen_sweep_router
from app.api.saisons.admin_router import router as saisons_admin_router
from app.api.saisons.router import router as saisons_router
from app.api.schiedsrichter.admin_router import router as schiedsrichter_admin_router
from app.api.schiedsrichter.adresswechsel_router import router as schiedsrichter_adresswechsel_router
from app.api.schiedsrichter.bestaetigung_router import router as schiedsrichter_bestaetigung_router
from app.api.schiedsrichter.person_router import router as schiedsrichter_person_router
from app.api.schiedsrichter.router import router as schiedsrichter_router
from app.api.sperrliste.admin_router import router as sperrliste_admin_router
from app.api.spiele.admin_router import router as spiele_admin_router
from app.api.spiele.router import router as spiele_router
from app.api.spieler.admin_router import router as spieler_admin_router
from app.api.spieler.person_router import router as spieler_person_router
from app.api.spieler.router import router as spieler_router
from app.api.spieler.selbst_router import router as spieler_selbst_router
from app.api.spielorte.admin_router import router as spielorte_admin_router
from app.api.spielorte.router import router as spielorte_router
from app.api.spieltage.admin_router import router as spieltage_admin_router
from app.api.spieltage.router import router as spieltage_router
from app.api.system.router import router as system_router
from app.api.teams.admin_router import router as teams_admin_router
from app.api.teams.person_router import router as teams_person_router
from app.api.teams.router import router as teams_router
from app.api.zustellung.router import router as zustellung_router
from app.core.actor_token import ActorTokenKey
from app.core.config import API_VERSION, BackendConfig
from app.core.db import get_database, get_db_client, lifespan
from app.core.domain import OPERATION_SEPARATOR, RULES
from app.core.drosselung import DROSSELUNG_ERREICHT, get_drossel
from app.core.exception_handlers import (
    BODY_UNREADABLE,
    COMPONENT_REF,
    JSON_MEDIA_TYPE,
    METHOD_NOT_SERVED,
    NO_ROUTE,
    PAYLOAD_REFUSED,
    STORES_NOTHING_WHEN,
    refusal_response,
    refused_codes,
    register_exception_handlers,
    stores_nothing,
)
from app.core.exceptions import NO_DATABASE_CLIENT
from app.core.logging import setup_custom_logger
from app.core.middlewares import TracedApp
from app.core.routing import ObjectIdConvertor
from app.core.security import (
    ACTOR_NOT_ADMIN,
    ACTOR_TOKEN_REFUSED,
    CONFIRMATION_REQUIRED,
    MISSING_ACTOR,
    MISSING_TOKEN,
    PERSON_BARRED,
    WRONG_ADMIN_KEY,
    WRONG_BASE_KEY,
    WRONG_SYSTEM_KEY,
    get_actor_token,
    get_step_up_check,
    get_token,
    verify_access_admin,
    verify_access_base,
    verify_access_system,
    verify_actor_is_admin,
    verify_admin_actor,
    verify_person_actor,
    verify_person_is_unbarred,
    verify_recent_confirmation,
    verify_step_up,
)
from app.shared.schemas.responses import FLFailureBody, FLRefusedPayloadBody

# Split by whether a router writes, never by method: `spielorte`, `schiedsrichter`, `registrierungen`
# and the ADMIN `bewerbungen` router read under `verify_access_admin`, the rest under
# `verify_access_base`. Order carries nothing here (`app/core/routing.py`).
READ_ROUTERS = (
    spiele_router,
    teams_router,
    spieltage_router,
    spieler_router,
    saisons_router,
    spielorte_router,
    schiedsrichter_router,
    bewerbungen_router,
    registrierungen_router,
    einwilligung_router,
)
WRITE_ROUTERS = (
    spiele_admin_router,
    teams_admin_router,
    spieltage_admin_router,
    spieler_admin_router,
    saisons_admin_router,
    spielorte_admin_router,
    schiedsrichter_admin_router,
    aktionen_admin_router,
    bewerbungen_admin_router,
    kontakte_admin_router,
    sperrliste_admin_router,
    berechtigungen_admin_router,
)
# Its own group because it belongs to neither: base-tier and mixed read/write, so either tuple's
# comment would go false about the tier or the methods.
PUBLIC_ROUTERS = (
    bewerbungen_public_router,
    bewerbungen_einwilligung_router,
    registrierungen_public_router,
    registrierungen_einwilligung_router,
    schiedsrichter_bestaetigung_router,
    schiedsrichter_adresswechsel_router,
)
# Its own group for the same reason: system-tier operations the application makes to itself, which
# neither tuple above describes. A POST that stores nothing sits here too, both guard sheets listing
# it beside the writes.
SYSTEM_ROUTERS = (
    bewerbungen_sweep_router,
    bewerbungen_zustellung_router,
    registrierungen_sweep_router,
    zustellung_router,
    identitaet_router,
    berechtigungen_sweep_router,
)
# Its own group, as the two above are: a signed-in person's routers read and write on the admin key
# with a person's binder in place of `bind_actor`, which no tuple above describes. A sweep walking
# the writers walks these too.
PERSON_ROUTERS = (
    spieler_person_router,
    registrierungen_person_router,
    teams_person_router,
    bewerbungen_person_router,
    spieler_selbst_router,
    registrierungen_selbst_router,
    schiedsrichter_person_router,
    konto_router,
)

# Spelled as `fl_frontend/src/core/api.ts :: FetchOptions` spells its `authType`, the value being
# published so the two can be compared (`docs/backend/spec.md :: I190`).
KEY_TIER_EXTENSION = "x-fl-tier"
KEY_TIERS = {verify_access_base: "base", verify_access_admin: "admin", verify_access_system: "system"}


class RefusalDriver(StrEnum):
    """The suite that makes a dependency's refusal happen, which holds the table's entry to what a request meets."""

    #: Met before any handler, by `fl_backend/tests/api/test_dependency_refusals.py`'s probe of every
    #: operation against an application holding no database.
    PROBE = "probe"
    #: Met only past the database, where the handler calls the check: `fl_backend/tests/api/test_step_up_execution.py`.
    STEP_UP = "step_up"
    #: Met only once the stored day's count is spent: `fl_backend/tests/api/test_drosselung_execution.py`.
    COUNT = "count"


@dataclass(frozen=True, kw_only=True)
class DependencyRefusal:
    status: HTTPStatus
    code: str
    driven_by: RefusalDriver


def _probed(status: HTTPStatus, code: str) -> DependencyRefusal:
    return DependencyRefusal(status=status, code=code, driven_by=RefusalDriver.PROBE)


# Each dependency answering a refusal of its own, the one it answers, and the suite making it happen.
# One table, so a dependency added to it is published with no second list to join.
DEPENDENCY_REFUSALS: Mapping[Callable[..., Any], DependencyRefusal] = {
    get_token: _probed(HTTPStatus.UNAUTHORIZED, MISSING_TOKEN),
    verify_access_base: _probed(HTTPStatus.UNAUTHORIZED, WRONG_BASE_KEY),
    verify_access_admin: _probed(HTTPStatus.UNAUTHORIZED, WRONG_ADMIN_KEY),
    verify_access_system: _probed(HTTPStatus.UNAUTHORIZED, WRONG_SYSTEM_KEY),
    # The actor's three, each raised by the dependency it is keyed on; a binder declaring them raises
    # none of its own, and an operation meets them through it (`dependency_refusals` walks sub-dependencies).
    get_actor_token: _probed(HTTPStatus.BAD_REQUEST, MISSING_ACTOR),
    verify_admin_actor: _probed(HTTPStatus.UNAUTHORIZED, ACTOR_TOKEN_REFUSED),
    verify_person_actor: _probed(HTTPStatus.UNAUTHORIZED, ACTOR_TOKEN_REFUSED),
    # A session older than its grant is refused here under `verify_admin_actor`'s code, which this
    # check's own dependency on it publishes on every operation running both.
    verify_actor_is_admin: _probed(HTTPStatus.FORBIDDEN, ACTOR_NOT_ADMIN),
    verify_person_is_unbarred: _probed(HTTPStatus.FORBIDDEN, PERSON_BARRED),
    verify_recent_confirmation: _probed(HTTPStatus.UNAUTHORIZED, CONFIRMATION_REQUIRED),
    verify_step_up: _probed(HTTPStatus.UNAUTHORIZED, CONFIRMATION_REQUIRED),
    get_db_client: _probed(HTTPStatus.SERVICE_UNAVAILABLE, NO_DATABASE_CLIENT),
    get_database: _probed(HTTPStatus.SERVICE_UNAVAILABLE, NO_DATABASE_CLIENT),
    # A check handed to the handler, which calls it on the calls it judges.
    get_step_up_check: DependencyRefusal(status=HTTPStatus.UNAUTHORIZED, code=CONFIRMATION_REQUIRED, driven_by=RefusalDriver.STEP_UP),
    get_drossel: DependencyRefusal(status=HTTPStatus.TOO_MANY_REQUESTS, code=DROSSELUNG_ERREICHT, driven_by=RefusalDriver.COUNT),
}
UNGUARDED_TIER = "none"

STORES_NOTHING_EXTENSION = "x-fl-stores-nothing"

# Not domain rules: each is a property of the transport, or of how much one person writes in a day.
# Each is raised in `app/core/` and declared by no `RULES` row, which is what
# `fl_backend/tests/core/test_domain.py :: test_the_protocol_codes_are_the_ones_outside_the_api_layer` holds.
PROTOCOL_CODES = frozenset(
    {
        MISSING_TOKEN,
        WRONG_BASE_KEY,
        WRONG_SYSTEM_KEY,
        WRONG_ADMIN_KEY,
        MISSING_ACTOR,
        ACTOR_NOT_ADMIN,
        ACTOR_TOKEN_REFUSED,
        PERSON_BARRED,
        CONFIRMATION_REQUIRED,
        DROSSELUNG_ERREICHT,
        PAYLOAD_REFUSED,
        BODY_UNREADABLE,
        NO_ROUTE,
        METHOD_NOT_SERVED,
    }
)

# Published for the frontend, which hands a code to no slice's mapper by its family alone
# (`fl_frontend/src/core/errors.ts :: PROTOCOL_FAMILIES`) and is compared against this.
PROTOCOL_FAMILIES_EXTENSION = "x-fl-protocol-families"


def refusal_family(code: str) -> str:
    return code.split("-")[1]


# Every failure an operation answers is `app/core/exception_handlers.py :: error_response`'s body, and
# a refused payload's adds `fields`; FastAPI's default 422, `HTTPValidationError`, is a body this API
# never sends (`docs/backend/spec.md :: I345`).
FAILURE_BODIES = (FLFailureBody, FLRefusedPayloadBody)
FASTAPI_VALIDATION_BODIES = ("HTTPValidationError", "ValidationError")


Operation = tuple[str, str]


class DocumentedRoute(NamedTuple):
    path_format: str
    methods: set[str]
    responses: Mapping[int | str, Any]
    dependant: Dependant
    convertors: Mapping[str, Convertor[Any]]

    @property
    def operations(self) -> list[Operation]:
        """Keyed as the document keys an operation: its path, then its lower-case method."""

        return [(self.path_format, method.lower()) for method in sorted(self.methods)]

    @property
    def calls(self) -> set[Callable[..., Any]]:
        """What the operation depends on directly, an include's dependencies and the router's among them."""

        return {dependency.call for dependency in self.dependant.dependencies if dependency.call is not None}


def document_routes(app: FastAPI) -> Iterator[DocumentedRoute]:
    """Each operation as FastAPI builds the document from it: an include's prefix and `responses=` applied, nested includes opened."""

    for context in iter_route_contexts(app.routes):
        # The routes `fastapi.openapi.utils.get_openapi` documents an operation for, whose path is never
        # `None`; a hidden one read here would pass a rule naming it as served while publishing nothing.
        if isinstance(context.original_route, APIRoute) and context.path_format is not None and context.include_in_schema:
            yield DocumentedRoute(
                context.path_format, context.methods or set(), context.responses, context.dependant, context.original_route.param_convertors
            )


Document = dict[str, Any]
# One edit of the document FastAPI generates, returning a new document and changing nothing it was handed.
DocumentPass = Callable[[Document], Document]


def publish_document(app: FastAPI, passes: Sequence[DocumentPass]) -> None:
    """FastAPI's documented override: `passes` applied in order, the result stored once.

    Never onto a route: a route's `openapi_extra` belongs to its module-level router, so every later
    build in the process inherits the edit and hides a defect of the first.
    """

    def openapi() -> Document:
        if app.openapi_schema:
            return app.openapi_schema

        document = get_openapi(title=app.title, version=app.version, openapi_version=app.openapi_version, routes=app.routes)
        for edit in passes:
            document = edit(document)
        app.openapi_schema = document

        return app.openapi_schema

    app.openapi = openapi


def with_operations_edited(document: Mapping[str, Any], edit: Callable[[Operation, Mapping[str, Any]], Mapping[str, Any]]) -> Document:
    """`document` with every operation replaced by what `edit` answers for it."""

    return {
        **document,
        "paths": {
            path: {method: dict(edit((path, method), operation)) for method, operation in operations.items()}
            for path, operations in document["paths"].items()
        },
    }


def with_extension(document: Mapping[str, Any], extension: str, values: Mapping[Operation, Any]) -> Document:
    return with_operations_edited(document, lambda key, operation: {**operation, extension: values[key]} if key in values else operation)


def publish_path_patterns(app: FastAPI) -> DocumentPass:
    """Each `objectid` path parameter published with the pattern its convertor matches.

    FastAPI publishes the parameter's type alone, and a path whose id misses the pattern is no path
    this operation serves: the router answers it before any handler (`docs/backend/spec.md` §1.4).
    """

    patterns: dict[Operation, set[str]] = {}
    for route in document_routes(app):
        named = {name for name, convertor in route.convertors.items() if isinstance(convertor, ObjectIdConvertor)}
        if named:
            patterns.update(dict.fromkeys(route.operations, named))

    def edit(key: Operation, operation: Mapping[str, Any]) -> Mapping[str, Any]:
        parameters = [
            {**parameter, "schema": {**parameter["schema"], "pattern": f"^{ObjectIdConvertor.regex}$"}}
            if parameter["in"] == "path" and parameter["name"] in patterns.get(key, set())
            else parameter
            for parameter in operation.get("parameters", [])
        ]

        return {**operation, "parameters": parameters} if parameters else operation

    return functools.partial(with_operations_edited, edit=edit)


def publish_key_tiers(app: FastAPI) -> DocumentPass:
    tiers: dict[Operation, str] = {}
    for route in document_routes(app):
        # Joined rather than picked: no single key satisfies two guards, so a value equal to no
        # declared tier fails the comparison rather than naming one of the two as the answer.
        joined = "+".join(sorted(KEY_TIERS[guard] for guard in route.calls & KEY_TIERS.keys()))
        tiers.update(dict.fromkeys(route.operations, joined or UNGUARDED_TIER))

    return functools.partial(with_extension, extension=KEY_TIER_EXTENSION, values=tiers)


def publish_stores_nothing(app: FastAPI) -> DocumentPass:
    declared: dict[Operation, bool | str] = {}
    for route in document_routes(app):
        calls = route.calls
        # `true`, or the query flag under which it holds: the frontend marks each call it makes to
        # such an operation a read, and is compared against this (`docs/backend/spec.md :: I327`).
        flag = True if stores_nothing in calls else next((STORES_NOTHING_WHEN[call] for call in calls if call in STORES_NOTHING_WHEN), None)
        if flag is not None:
            declared.update(dict.fromkeys(route.operations, flag))

    return functools.partial(with_extension, extension=STORES_NOTHING_EXTENSION, values=declared)


def with_protocol_families(document: Mapping[str, Any]) -> Document:
    # On the document rather than an operation: a family is the protocol's on every operation alike.
    return {**document, PROTOCOL_FAMILIES_EXTENSION: sorted({refusal_family(code) for code in PROTOCOL_CODES})}


def body_response(body: type[BaseModel], description: str) -> dict[str, Any]:
    return {"description": description, "content": {JSON_MEDIA_TYPE: {"schema": {"$ref": COMPONENT_REF.format(model=body.__name__)}}}}


RESPONSE_REF = "#/components/responses/{name}"


def shared_response_name(status: str, codes: AbstractSet[str]) -> str:
    """The status and then the codes, so a reference reads as what it publishes.

    Derived from the content and never numbered: a numbering renames every later response when one
    operation's codes change.
    """

    return ".".join([status, *sorted(codes)])


def with_shared_responses(document: Mapping[str, Any], shared: Mapping[str, Any]) -> Document:
    """`document` publishing `shared` under `components.responses` beside what it held."""

    components = document.get("components", {})
    # Sorted for the reason `with_failure_bodies` sorts the schemas.
    responses = dict(sorted({**components.get("responses", {}), **shared}.items()))

    return {**document, "components": {**components, "responses": responses}}


def with_failure_bodies(document: Mapping[str, Any]) -> Document:
    """`document` publishing this API's failure bodies in place of FastAPI's own."""

    components = document.get("components", {})
    schemas = {name: schema for name, schema in components.get("schemas", {}).items() if name not in FASTAPI_VALIDATION_BODIES}
    schemas.update(models_json_schema([(body, "serialization") for body in FAILURE_BODIES], ref_template=COMPONENT_REF)[1]["$defs"])
    failure = shared_response_name("default", set())

    def edit(_: Operation, operation: Mapping[str, Any]) -> Mapping[str, Any]:
        # Written here rather than declared to FastAPI, whose own 422 a declared `default` suppresses everywhere.
        return {**operation, "responses": {**operation["responses"], "default": {"$ref": RESPONSE_REF.format(name=failure)}}}

    # Sorted as FastAPI sorts what it generates, so a rewrite of `fl_backend/openapi.json` moves no schema.
    with_bodies = {**document, "components": {**components, "schemas": dict(sorted(schemas.items()))}}

    return with_operations_edited(with_shared_responses(with_bodies, {failure: body_response(FLFailureBody, "Failure")}), edit)


# Each operation's refusal codes, keyed by the status each is answered at.
Refusals = dict[HTTPStatus, set[str]]


def declared_refusals() -> dict[Operation, Refusals]:
    """Each operation's rule codes by status, keyed as the document keys an operation: its path, then its lower-case method."""

    declared: dict[Operation, Refusals] = {}
    for rule in RULES:
        for token in rule.operation.split(OPERATION_SEPARATOR):
            method, route = token.split(" ", 1)
            declared.setdefault((f"/api/v{API_VERSION}{route}", method.lower()), {}).setdefault(rule.status, set()).add(rule.code)

    return declared


def _dependency_calls(dependant: Dependant) -> Iterator[Callable[..., Any]]:
    """Every dependency the operation runs, a dependency's own among them."""

    for dependency in dependant.dependencies:
        if dependency.call is not None:
            yield dependency.call
        yield from _dependency_calls(dependency)


def dependency_refusals(app: FastAPI, drivers: AbstractSet[RefusalDriver] = frozenset(RefusalDriver)) -> dict[Operation, Refusals]:
    """Each operation's codes by status from the dependencies it runs, keyed as `declared_refusals` keys them; every driver's unless named."""

    table = {call: refusal for call, refusal in DEPENDENCY_REFUSALS.items() if refusal.driven_by in drivers}
    found: dict[Operation, Refusals] = {}
    for route in document_routes(app):
        refusing = set(_dependency_calls(route.dependant)) & table.keys()
        for operation in route.operations:
            for call in refusing:
                found.setdefault(operation, {}).setdefault(table[call].status, set()).add(table[call].code)

    return found


def refusal_codes(app: FastAPI) -> dict[Operation, Refusals]:
    """Each operation's refusal codes by status: its rules', its dependencies' and the codes its route's own declarations name."""

    codes = declared_refusals()
    for operation, refusals in dependency_refusals(app).items():
        for status, found in refusals.items():
            codes.setdefault(operation, {}).setdefault(status, set()).update(found)

    unnamed: list[str] = []
    for route in document_routes(app):
        for status_code, response in route.responses.items():
            # Read off the declaration and never assumed from it, so a route refusing for a second
            # reason publishes that reason's code rather than the duplicate key's.
            if not (named := refused_codes(response)):
                unnamed.extend(f"{status_code} on {method} {route.path_format}" for method in sorted(route.methods or ()))
            for operation in route.operations:
                codes.setdefault(operation, {}).setdefault(HTTPStatus(int(status_code)), set()).update(named)

    if unnamed:
        raise ValueError(f"these declare a response naming no code, so the document would publish none: {sorted(unnamed)}")

    return codes


def publish_refusals(app: FastAPI) -> DocumentPass:
    """Each operation's refusals at their statuses, derived rather than listed, so the document cannot drift from `RULES` or a declaration."""

    # At build rather than when the document is asked for: the document is built on the first read,
    # so a raise there would fail that request alone and leave the build standing.
    codes = refusal_codes(app)
    served = {operation for route in document_routes(app) for operation in route.operations}
    if unserved := sorted(codes.keys() - served):
        raise LookupError(f"RULES names operations the application does not serve: {unserved}")

    return functools.partial(with_refusals, codes=codes)


def with_refusals(document: Mapping[str, Any], codes: Mapping[Operation, Mapping[HTTPStatus, AbstractSet[str]]]) -> Document:
    """`document` with each status an operation refuses at replaced by a reference to the response publishing exactly its codes."""

    shared: dict[str, Any] = {}

    def edit(key: Operation, operation: Mapping[str, Any]) -> Mapping[str, Any]:
        statuses = {status: set(found) for status, found in codes.get(key, {}).items()}
        # FastAPI's own placement of its 422, on every operation taking input, is where a payload can be refused.
        if str(int(HTTPStatus.UNPROCESSABLE_CONTENT)) in operation["responses"]:
            statuses.setdefault(HTTPStatus.UNPROCESSABLE_CONTENT, set()).add(PAYLOAD_REFUSED)
        # A body arrives only where the operation takes one, and only a body can be undecodable.
        if "requestBody" in operation:
            statuses.setdefault(HTTPStatus.BAD_REQUEST, set()).add(BODY_UNREADABLE)
        refused: dict[str, Any] = {}
        for status, found in sorted(statuses.items()):
            # One response per whole code set and never one per reason: a status holds one response,
            # so an operation refusing there for two reasons could refer to only one of them.
            name = shared_response_name(str(int(status)), found)
            shared[name] = refusal_response(status, found)
            refused[str(int(status))] = {"$ref": RESPONSE_REF.format(name=name)}

        return {**operation, "responses": {**operation["responses"], **refused}}

    # Walked before `shared` is published, since `edit` fills it.
    edited = with_operations_edited(document, edit)

    return with_shared_responses(edited, shared)


def create_app(config: BackendConfig | None = None) -> FastAPI:
    """Build the application.

    A FUNCTION, so the composition root is a choice rather than an import side effect. `config` is
    what every request reads (`app/core/config.py :: get_app_config`), the environment's and the
    secret files' where none is passed.
    """
    # Here rather than at module scope, so `app.main` holds no `get_config` for a caller to import;
    # the ruff ban names that path too, since ruff matches the path an import spells.
    from app.core.config import get_config  # noqa: TID251

    config = config or get_config()

    # Before the app exists, so a failure while constructing it is logged in the right format.
    setup_custom_logger(config)

    app = TracedApp(lifespan=lifespan)
    app.state.config = config
    # Once, here: the `kid` a token must name is this key's thumbprint, and no request recomputes it.
    app.state.actor_token_key = ActorTokenKey.from_public_key(config.actor_token_public_key)

    register_exception_handlers(app)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.api_cors_allowed_origins_list,
        allow_credentials=True,
        # Every method the routers serve: one omitted is a preflight rejection waiting to happen.
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["*"],
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=config.api_trusted_hosts_list)

    app.include_router(system_router)
    for router in (*READ_ROUTERS, *WRITE_ROUTERS, *PUBLIC_ROUTERS, *SYSTEM_ROUTERS, *PERSON_ROUTERS):
        app.include_router(router)

    # The published prose is the decorator's rather than the docstring's: a docstring cannot
    # interpolate, so the version would reach `openapi.json` as the literal `{API_VERSION}`.
    @app.get(
        "/",
        description=f"Confirm the service is answering. The versioned API is under `/api/v{API_VERSION}`; `/system/is_live` is the probe.",
    )
    def root():
        """Confirm the service is answering."""
        return "Hello World"

    # After the last route is mounted and before anything asks for the document: `app.openapi()`
    # caches what it builds, so an edit made afterwards never reaches a reader.
    publish_document(
        app,
        (
            publish_key_tiers(app),
            publish_stores_nothing(app),
            publish_path_patterns(app),
            with_failure_bodies,
            publish_refusals(app),
            with_protocol_families,
        ),
    )

    return app
