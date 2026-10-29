import functools
from collections.abc import Callable, Iterator, Mapping, Sequence
from http import HTTPStatus
from typing import Any, NamedTuple

from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.routing import APIRoute, iter_route_contexts
from pydantic.json_schema import models_json_schema
from starlette.convertors import Convertor

from app.api.adresswechsel.admin_router import router as adresswechsel_admin_router
from app.api.adresswechsel.router import router as adresswechsel_router
from app.api.adresswechsel.sweep_router import router as adresswechsel_sweep_router
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
from app.api.identitaet.admin_router import router as identitaet_admin_router
from app.api.identitaet.person_router import router as identitaet_person_router
from app.api.identitaet.router import router as identitaet_router
from app.api.identitaet.sweep_router import router as identitaet_sweep_router
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
from app.api.schiedsrichter.bestaetigung_router import router as schiedsrichter_bestaetigung_router
from app.api.schiedsrichter.person_router import router as schiedsrichter_person_router
from app.api.schiedsrichter.router import router as schiedsrichter_router
from app.api.sperrliste.admin_router import router as sperrliste_admin_router
from app.api.spielberichte.admin_router import router as spielberichte_admin_router
from app.api.spielberichte.person_router import router as spielberichte_person_router
from app.api.spielbestaetigungen.admin_router import router as spielbestaetigungen_admin_router
from app.api.spielbestaetigungen.person_router import router as spielbestaetigungen_person_router
from app.api.spielbestaetigungen.router import router as spielbestaetigungen_router
from app.api.spielbestaetigungen.sweep_router import router as spielbestaetigungen_sweep_router
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
from app.core.db import lifespan
from app.core.exception_handlers import FAILURE_RESPONSES, FAILURE_STATUSES, STORES_NOTHING_WHEN, register_exception_handlers, stores_nothing
from app.core.logging import setup_custom_logger
from app.core.middlewares import TracedApp
from app.core.routing import ObjectIdConvertor
from app.core.security import verify_access_admin, verify_access_base, verify_access_system
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
    identitaet_admin_router,
    sperrliste_admin_router,
    berechtigungen_admin_router,
    spielbestaetigungen_admin_router,
    spielberichte_admin_router,
    adresswechsel_admin_router,
)
# Its own group because it belongs to neither: base-tier and mixed read/write, so either tuple's
# comment would go false about the tier or the methods.
PUBLIC_ROUTERS = (
    bewerbungen_public_router,
    bewerbungen_einwilligung_router,
    registrierungen_public_router,
    registrierungen_einwilligung_router,
    schiedsrichter_bestaetigung_router,
    adresswechsel_router,
    spielbestaetigungen_router,
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
    identitaet_sweep_router,
    adresswechsel_sweep_router,
    spielbestaetigungen_sweep_router,
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
    identitaet_person_router,
    spielbestaetigungen_person_router,
    spielberichte_person_router,
)

# Spelled as `fl_frontend/src/core/api.ts :: FetchOptions` spells its `authType`, the value being
# published so the two can be compared.
KEY_TIER_EXTENSION = "x-fl-tier"
KEY_TIERS = {verify_access_base: "base", verify_access_admin: "admin", verify_access_system: "system"}


UNGUARDED_TIER = "none"

STORES_NOTHING_EXTENSION = "x-fl-stores-nothing"


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
    this operation serves: the router answers it before any handler.
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
        # such an operation a read, and is compared against this.
        flag = True if stores_nothing in calls else next((STORES_NOTHING_WHEN[call] for call in calls if call in STORES_NOTHING_WHEN), None)
        if flag is not None:
            declared.update(dict.fromkeys(route.operations, flag))

    return functools.partial(with_extension, extension=STORES_NOTHING_EXTENSION, values=declared)


# A 422 alone carries `fields` (`app/core/exception_handlers.py :: error_response`'s callers), so it
# alone answers with the refused payload's body.
FAILURE_BODIES = {status: FLRefusedPayloadBody if status is HTTPStatus.UNPROCESSABLE_CONTENT else FLFailureBody for status in FAILURE_STATUSES}
# The statuses whose every refusal names when to come back: the throttle's and the unavailable database's.
RETRY_AFTER_STATUSES = frozenset({HTTPStatus.TOO_MANY_REQUESTS, HTTPStatus.SERVICE_UNAVAILABLE})
RETRY_AFTER_HEADER = {"Retry-After": {"description": "Seconds to wait before asking again", "schema": {"type": "integer"}}}
SCHEMA_REF = "#/components/schemas/{model}"


def failure_response(status: HTTPStatus) -> dict[str, Any]:
    response: dict[str, Any] = {
        "description": status.phrase,
        "content": {"application/json": {"schema": {"$ref": SCHEMA_REF.format(model=FAILURE_BODIES[status].__name__)}}},
    }
    if status in RETRY_AFTER_STATUSES:
        response["headers"] = RETRY_AFTER_HEADER

    return response


def with_failure_responses(document: Mapping[str, Any]) -> Document:
    """`document` publishing the shared response every operation's `FAILURE_RESPONSES` refers to, and the bodies they carry.

    FastAPI publishes a model only where an operation names it, and these are named by reference.
    """

    components = document.get("components", {})
    bodies = models_json_schema([(body, "serialization") for body in set(FAILURE_BODIES.values())], ref_template=SCHEMA_REF)[1]["$defs"]
    # Sorted as FastAPI sorts what it generates, so a rewrite of `fl_backend/openapi.json` moves no schema.
    schemas = dict(sorted({**components.get("schemas", {}), **bodies}.items()))
    responses = {str(int(status)): failure_response(status) for status in FAILURE_STATUSES}

    return {**document, "components": {**components, "schemas": schemas, "responses": responses}}


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
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["*"],
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=config.api_trusted_hosts_list)

    app.include_router(system_router, responses=FAILURE_RESPONSES)
    for router in (*READ_ROUTERS, *WRITE_ROUTERS, *PUBLIC_ROUTERS, *SYSTEM_ROUTERS, *PERSON_ROUTERS):
        app.include_router(router, responses=FAILURE_RESPONSES)

    # The published prose is the decorator's rather than the docstring's: a docstring cannot
    # interpolate, so the version would reach `openapi.json` as the literal `{API_VERSION}`.
    @app.get(
        "/",
        responses=FAILURE_RESPONSES,
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
            with_failure_responses,
        ),
    )

    return app
