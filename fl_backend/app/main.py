from collections.abc import Mapping
from http import HTTPStatus
from typing import Any

from fastapi import APIRouter, FastAPI
from fastapi.openapi.utils import get_openapi
from fastapi.routing import APIRoute
from pydantic.json_schema import models_json_schema

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
from app.api.einwilligung.router import router as einwilligung_router
from app.api.identitaet.admin_router import router as identitaet_admin_router
from app.api.identitaet.person_router import router as identitaet_person_router
from app.api.identitaet.router import router as identitaet_router
from app.api.identitaet.sweep_router import router as identitaet_sweep_router
from app.api.konto.router import router as konto_router
from app.api.postausgang.router import router as postausgang_router
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
from app.api.system.router import root_router
from app.api.system.router import router as system_router
from app.api.teams.admin_router import router as teams_admin_router
from app.api.teams.person_router import router as teams_person_router
from app.api.teams.router import router as teams_router
from app.core.config import BackendConfig
from app.core.db import lifespan
from app.core.exception_handlers import FAILURE_RESPONSES, FAILURE_STATUSES, register_exception_handlers
from app.core.logging import setup_logging
from app.core.middlewares import TracedApp
from app.shared.schemas.responses import FLFailureBody, FLRefusedPayloadBody

# Every router under its slice's tag, the first segment of each path it serves, so an operation's id
# is `<tag>_<handler>`: a handler's name is unique within its slice. Which key a router takes its
# guard publishes, as the operation's `security`.
ROUTERS: Mapping[str, tuple[APIRouter, ...]] = {
    "adresswechsel": (adresswechsel_router, adresswechsel_admin_router, adresswechsel_sweep_router),
    "aktionen": (aktionen_admin_router,),
    "berechtigungen": (berechtigungen_admin_router, berechtigungen_sweep_router),
    "bewerbungen": (
        bewerbungen_router,
        bewerbungen_admin_router,
        bewerbungen_public_router,
        bewerbungen_einwilligung_router,
        bewerbungen_person_router,
        bewerbungen_sweep_router,
    ),
    "einwilligung": (einwilligung_router,),
    "identitaet": (identitaet_router, identitaet_admin_router, identitaet_person_router, identitaet_sweep_router),
    "konto": (konto_router,),
    "postausgang": (postausgang_router,),
    "registrierungen": (
        registrierungen_router,
        registrierungen_public_router,
        registrierungen_einwilligung_router,
        registrierungen_person_router,
        registrierungen_selbst_router,
        registrierungen_sweep_router,
    ),
    "saisons": (saisons_router, saisons_admin_router),
    "schiedsrichter": (schiedsrichter_router, schiedsrichter_admin_router, schiedsrichter_bestaetigung_router, schiedsrichter_person_router),
    "sperrliste": (sperrliste_admin_router,),
    "spielberichte": (spielberichte_admin_router, spielberichte_person_router),
    "spielbestaetigungen": (
        spielbestaetigungen_router,
        spielbestaetigungen_admin_router,
        spielbestaetigungen_person_router,
        spielbestaetigungen_sweep_router,
    ),
    "spiele": (spiele_router, spiele_admin_router),
    "spieler": (spieler_router, spieler_admin_router, spieler_person_router, spieler_selbst_router),
    "spielorte": (spielorte_router, spielorte_admin_router),
    "spieltage": (spieltage_router, spieltage_admin_router),
    "system": (root_router, system_router),
    "teams": (teams_router, teams_admin_router, teams_person_router),
}


def operation_id(route: APIRoute) -> str:
    """FastAPI's documented id for a generated client: the route's tag, then its handler's name."""

    return f"{route.tags[0]}_{route.name}"


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


def with_failure_responses(document: Mapping[str, Any]) -> dict[str, Any]:
    """`document` publishing the shared response every operation's `FAILURE_RESPONSES` refers to, and the bodies they carry.

    FastAPI publishes a model only where an operation names it, and these are named by reference.
    """

    components = document.get("components", {})
    bodies = models_json_schema([(body, "serialization") for body in set(FAILURE_BODIES.values())], ref_template=SCHEMA_REF)[1]["$defs"]
    # Sorted as FastAPI sorts what it generates, so a rewrite of `fl_backend/openapi.json` moves no schema.
    schemas = dict(sorted({**components.get("schemas", {}), **bodies}.items()))
    responses = {str(int(status)): failure_response(status) for status in FAILURE_STATUSES}

    return {**document, "components": {**components, "schemas": schemas, "responses": responses}}


# The document's name, which a client generated from it carries in each file's header.
DOCUMENT_TITLE = "Frankfurt League API"


def publish_document(app: FastAPI) -> None:
    """FastAPI's documented override, the shared failure responses added to what it generates and the result stored once."""

    def openapi() -> dict[str, Any]:
        if not app.openapi_schema:
            document = get_openapi(title=DOCUMENT_TITLE, version=app.version, openapi_version=app.openapi_version, routes=app.routes)
            app.openapi_schema = with_failure_responses(document)

        return app.openapi_schema

    app.openapi = openapi


def mount_api(app: FastAPI) -> None:
    """Every router, and the document they publish.

    Apart from `create_app`, since nothing here reads the configuration: the document is built from
    the routes alone, with no settings to supply.
    """

    for tag, routers in ROUTERS.items():
        for router in routers:
            app.include_router(router, tags=[tag], responses=FAILURE_RESPONSES, generate_unique_id_function=operation_id)

    # After the last route is mounted and before anything asks for the document: `app.openapi()`
    # caches what it builds, so a route mounted afterwards never reaches a reader.
    publish_document(app)


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
    setup_logging()

    app = TracedApp(lifespan=lifespan)
    app.state.config = config

    register_exception_handlers(app)
    mount_api(app)

    return app
