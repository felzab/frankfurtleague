from collections.abc import Iterator, Mapping
from collections.abc import Set as AbstractSet
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.routing import APIRoute
from pydantic import BaseModel
from pydantic.json_schema import models_json_schema

from app.api.aktionen.admin_router import router as aktionen_admin_router
from app.api.bewerbungen.admin_router import router as bewerbungen_admin_router
from app.api.bewerbungen.einwilligung_router import router as bewerbungen_einwilligung_router
from app.api.bewerbungen.public_router import router as bewerbungen_public_router
from app.api.bewerbungen.router import router as bewerbungen_router
from app.api.bewerbungen.sweep_router import router as bewerbungen_sweep_router
from app.api.bewerbungen.zustellung_router import router as bewerbungen_zustellung_router
from app.api.identitaet.router import router as identitaet_router
from app.api.kontakte.admin_router import router as kontakte_admin_router
from app.api.registrierungen.einwilligung_router import router as registrierungen_einwilligung_router
from app.api.registrierungen.public_router import router as registrierungen_public_router
from app.api.registrierungen.router import router as registrierungen_router
from app.api.registrierungen.sweep_router import router as registrierungen_sweep_router
from app.api.saisons.admin_router import router as saisons_admin_router
from app.api.saisons.router import router as saisons_router
from app.api.schiedsrichter.admin_router import router as schiedsrichter_admin_router
from app.api.schiedsrichter.bestaetigung_router import router as schiedsrichter_bestaetigung_router
from app.api.schiedsrichter.router import router as schiedsrichter_router
from app.api.sperrliste.admin_router import router as sperrliste_admin_router
from app.api.spiele.admin_router import router as spiele_admin_router
from app.api.spiele.router import router as spiele_router
from app.api.spieler.admin_router import router as spieler_admin_router
from app.api.spieler.router import router as spieler_router
from app.api.spielorte.admin_router import router as spielorte_admin_router
from app.api.spielorte.router import router as spielorte_router
from app.api.spieltage.admin_router import router as spieltage_admin_router
from app.api.spieltage.router import router as spieltage_router
from app.api.system.router import router as system_router
from app.api.teams.admin_router import router as teams_admin_router
from app.api.teams.router import router as teams_router
from app.api.zustellung.router import router as zustellung_router
from app.core.config import API_VERSION, BackendConfig
from app.core.db import lifespan
from app.core.domain import OPERATION_SEPARATOR, RULES
from app.core.exception_handlers import (
    COMPONENT_REF,
    STORES_NOTHING_WHEN,
    refusal_response,
    refused_codes,
    register_exception_handlers,
    stores_nothing,
)
from app.core.logging import setup_custom_logger
from app.core.middlewares import TraceContextMiddleware
from app.core.security import verify_access_admin, verify_access_base, verify_access_system
from app.shared.schemas.responses import FLFailureBody, FLRefusedPayloadBody

# Split by tier and by `bind_actor`, never by method: `spielorte`, `schiedsrichter` and the ADMIN
# `bewerbungen` router read under `verify_access_admin`, the rest under `verify_access_base`. Order
# carries nothing here (`app/core/routing.py`).
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
)
# Its own group because it belongs to neither: base-tier and mixed read/write, so either tuple's
# comment would go false about the tier or the methods.
PUBLIC_ROUTERS = (
    bewerbungen_public_router,
    bewerbungen_einwilligung_router,
    registrierungen_public_router,
    registrierungen_einwilligung_router,
    schiedsrichter_bestaetigung_router,
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
)

# Spelled as `fl_frontend/src/core/api.ts :: FetchOptions` spells its `authType`, the value being
# published so the two can be compared (`docs/backend/spec.md :: I190`).
KEY_TIER_EXTENSION = "x-fl-tier"
KEY_TIERS = {verify_access_base: "base", verify_access_admin: "admin", verify_access_system: "system"}
UNGUARDED_TIER = "none"

STORES_NOTHING_EXTENSION = "x-fl-stores-nothing"


# Every failure an operation answers is `app/core/exception_handlers.py :: error_response`'s body, and
# a refused payload's adds `fields`; FastAPI's default 422, `HTTPValidationError`, is a body this API
# never sends (`docs/backend/spec.md :: I345`).
FAILURE_BODIES = (FLFailureBody, FLRefusedPayloadBody)
FASTAPI_VALIDATION_BODIES = ("HTTPValidationError", "ValidationError")


def api_routes(app: FastAPI) -> Iterator[APIRoute]:
    for entry in app.routes:
        # `include_router` appends a wrapper holding the original router rather than copying its
        # routes across, so a pass reading `app.routes` for `APIRoute` instances alone sees a
        # handful of routes and none of the API.
        original_router = getattr(entry, "original_router", None)

        for route in original_router.routes if original_router is not None else [entry]:
            if isinstance(route, APIRoute):
                yield route


def publish_key_tiers(app: FastAPI) -> None:
    for route in api_routes(app):
        # The route object rather than the include context: `add_api_route` copies the router's
        # own dependencies into every route it builds, so both arrive here as one set.
        calls = {guard.call for guard in route.dependant.dependencies if guard.call is not None}
        tiers = sorted(KEY_TIERS[guard] for guard in calls & KEY_TIERS.keys())

        # Joined rather than picked: no single key satisfies two guards, so a value equal to no
        # declared tier fails the comparison rather than naming one of the two as the answer.
        route.openapi_extra = {**(route.openapi_extra or {}), KEY_TIER_EXTENSION: "+".join(tiers) or UNGUARDED_TIER}


def publish_stores_nothing(app: FastAPI) -> None:
    for route in api_routes(app):
        calls = {guard.call for guard in route.dependant.dependencies if guard.call is not None}
        # `true`, or the query flag under which it holds: the frontend marks each call it makes to
        # such an operation a read, and is compared against this (`docs/backend/spec.md :: I327`).
        declared = True if stores_nothing in calls else next((STORES_NOTHING_WHEN[call] for call in calls if call in STORES_NOTHING_WHEN), None)
        if declared is not None:
            route.openapi_extra = {**(route.openapi_extra or {}), STORES_NOTHING_EXTENSION: declared}


def body_response(body: type[BaseModel], description: str) -> dict[str, Any]:
    return {"description": description, "content": {"application/json": {"schema": {"$ref": COMPONENT_REF.format(model=body.__name__)}}}}


def publish_failure_bodies(app: FastAPI) -> None:
    generate = app.openapi

    def openapi() -> dict[str, Any]:
        # `generate` caches the document it builds on the app, so the edit below is made once and
        # every later call reads it.
        if app.openapi_schema:
            return app.openapi_schema

        document = generate()
        schemas = document.setdefault("components", {}).setdefault("schemas", {})
        for name in FASTAPI_VALIDATION_BODIES:
            schemas.pop(name, None)
        schemas.update(models_json_schema([(body, "serialization") for body in FAILURE_BODIES], ref_template=COMPONENT_REF)[1]["$defs"])
        # Sorted as FastAPI sorts what it generates, so a rewrite of `fl_backend/openapi.json` moves no schema.
        document["components"]["schemas"] = dict(sorted(schemas.items()))

        for operations in document["paths"].values():
            for operation in operations.values():
                # FastAPI's own placement, on every operation taking input, is what is kept: a
                # `default` declared to FastAPI instead suppresses it everywhere.
                if "422" in operation["responses"]:
                    operation["responses"]["422"] = body_response(FLRefusedPayloadBody, "Validation Error")
                operation["responses"]["default"] = body_response(FLFailureBody, "Failure")

        return document

    app.openapi = openapi


CONFLICT = "409"


def declared_refusals() -> dict[tuple[str, str], set[str]]:
    """Each operation's rule codes, keyed as the document keys an operation: its path, then its lower-case method."""

    declared: dict[tuple[str, str], set[str]] = {}
    for rule in RULES:
        for token in rule.operation.split(OPERATION_SEPARATOR):
            method, route = token.split(" ", 1)
            declared.setdefault((f"/api/v{API_VERSION}{route}", method.lower()), set()).add(rule.code)

    return declared


def refusal_codes(app: FastAPI) -> dict[tuple[str, str], set[str]]:
    """Each operation's 409 codes: its rules', merged with the codes its route's own 409 declaration names."""

    codes = declared_refusals()
    unnamed: list[str] = []
    for route in api_routes(app):
        for status_code, response in route.responses.items():
            if str(status_code) != CONFLICT:
                continue
            # Read off the declaration and never assumed from it, so a route conflicting for a
            # second reason publishes that reason's code rather than the duplicate key's.
            if not (named := refused_codes(response)):
                unnamed.extend(f"{method} {route.path_format}" for method in sorted(route.methods or ()))
            for method in route.methods or ():
                codes.setdefault((route.path_format, method.lower()), set()).update(named)

    if unnamed:
        raise ValueError(f"these declare a 409 naming no code, so the document would publish none: {sorted(unnamed)}")

    return codes


def publish_refusals(app: FastAPI) -> None:
    """Each operation's refusals as its 409, derived rather than listed, so the document cannot drift from `RULES` or a route's declaration."""

    # At build rather than when the document is asked for: FastAPI caches what it generated before
    # this wrapper runs, so a raise there fails only the first request and serves the gap after it.
    codes = refusal_codes(app)
    served = {(route.path_format, method.lower()) for route in api_routes(app) for method in route.methods or ()}
    if unserved := sorted(codes.keys() - served):
        raise LookupError(f"RULES names operations the application does not serve: {unserved}")

    generate = app.openapi

    def openapi() -> dict[str, Any]:
        if app.openapi_schema:
            return app.openapi_schema

        # Stored, as FastAPI's "Extending OpenAPI" override stores its own: the wrapped call cached
        # the document before this edit, and every later call answers with the cache.
        app.openapi_schema = with_refusals(generate(), codes)

        return app.openapi_schema

    app.openapi = openapi


def with_refusals(document: Mapping[str, Any], codes: Mapping[tuple[str, str], AbstractSet[str]]) -> dict[str, Any]:
    """`document` with each operation's 409 replaced by one publishing exactly its `codes`, whatever 409 it carried."""

    return {
        **document,
        "paths": {
            path: {
                method: {**operation, "responses": {**operation["responses"], CONFLICT: refusal_response(found)}}
                if (found := codes.get((path, method)))
                else operation
                for method, operation in operations.items()
            }
            for path, operations in document["paths"].items()
        },
    }


def create_app(config: BackendConfig | None = None) -> FastAPI:
    """Build the application.

    A FUNCTION, so the composition root is a choice rather than an import side effect. `config` is
    what every request reads (`app/core/config.py :: get_app_config`), the environment's where none
    is passed.
    """
    # Here rather than at module scope, so `app.main` holds no `get_config` for a caller to import;
    # the ruff ban names that path too, since ruff matches the path an import spells.
    from app.core.config import get_config  # noqa: TID251

    config = config or get_config()

    # Before the app exists, so a failure while constructing it is logged in the right format.
    setup_custom_logger(config)

    app = FastAPI(lifespan=lifespan)
    app.state.config = config

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
    app.add_middleware(TraceContextMiddleware)

    app.include_router(system_router)
    for router in (*READ_ROUTERS, *WRITE_ROUTERS, *PUBLIC_ROUTERS, *SYSTEM_ROUTERS):
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
    # caches what it builds, so an extension or an edit made afterwards never reaches a reader.
    publish_key_tiers(app)
    publish_stores_nothing(app)
    publish_failure_bodies(app)
    publish_refusals(app)

    return app
