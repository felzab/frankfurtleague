from collections.abc import Mapping
from http import HTTPStatus
from typing import Any, Final

from fastapi import APIRouter, FastAPI
from fastapi.openapi.utils import get_openapi
from fastapi.routing import APIRoute
from pydantic.json_schema import models_json_schema

from app.api.adresswechsel.admin_router import router as address_change_admin_router
from app.api.adresswechsel.public_router import router as address_change_public_router
from app.api.adresswechsel.system_router import router as address_change_system_router
from app.api.aktionen.admin_router import router as action_log_admin_router
from app.api.berechtigungen.admin_router import router as grants_admin_router
from app.api.berechtigungen.system_router import router as grants_system_router
from app.api.bewerbungen.admin_router import router as bewerbungen_admin_router
from app.api.bewerbungen.person_router import router as bewerbungen_person_router
from app.api.bewerbungen.public_router import router as bewerbungen_public_router
from app.api.bewerbungen.system_router import router as bewerbungen_system_router
from app.api.einwilligung.public_router import router as einwilligung_public_router
from app.api.identitaet.admin_router import router as identity_admin_router
from app.api.identitaet.person_router import router as identity_person_router
from app.api.identitaet.system_router import router as identity_system_router
from app.api.konto.person_router import router as account_person_router
from app.api.outbox.system_router import router as outbox_system_router
from app.api.registrierungen.admin_router import router as registrierungen_admin_router
from app.api.registrierungen.person_router import router as registrierungen_person_router
from app.api.registrierungen.person_router import spieler_router as registrierungen_person_spieler_router
from app.api.registrierungen.public_router import router as registrierungen_public_router
from app.api.registrierungen.system_router import router as registrierungen_system_router
from app.api.saisons.admin_router import router as saisons_admin_router
from app.api.saisons.public_router import router as saisons_public_router
from app.api.schiedsrichter.admin_router import router as schiedsrichter_admin_router
from app.api.schiedsrichter.person_router import router as schiedsrichter_person_router
from app.api.schiedsrichter.public_router import router as schiedsrichter_public_router
from app.api.sperrliste.admin_router import router as sperrliste_admin_router
from app.api.spielberichte.admin_router import router as spielberichte_admin_router
from app.api.spielberichte.person_router import router as spielberichte_person_router
from app.api.spielbestaetigungen.admin_router import router as spielbestaetigungen_admin_router
from app.api.spielbestaetigungen.person_router import router as spielbestaetigungen_person_router
from app.api.spielbestaetigungen.public_router import router as spielbestaetigungen_public_router
from app.api.spielbestaetigungen.system_router import router as spielbestaetigungen_system_router
from app.api.spiele.admin_router import router as spiele_admin_router
from app.api.spiele.public_router import router as spiele_public_router
from app.api.spieler.admin_router import router as spieler_admin_router
from app.api.spieler.person_router import router as spieler_person_router
from app.api.spieler.person_router import spieler_router as spieler_person_spieler_router
from app.api.spieler.public_router import router as spieler_public_router
from app.api.spielorte.admin_router import router as spielorte_admin_router
from app.api.spieltage.admin_router import router as spieltage_admin_router
from app.api.spieltage.public_router import router as spieltage_public_router
from app.api.system.router import router as system_router
from app.api.teams.admin_router import router as teams_admin_router
from app.api.teams.person_router import router as teams_person_router
from app.api.teams.public_router import router as teams_public_router
from app.core.config import BackendConfig
from app.core.db import lifespan
from app.core.exception_handlers import FAILURE_RESPONSES, FAILURE_STATUSES, register_exception_handlers
from app.core.logging import fl_logger, setup_logging
from app.core.middlewares import TracedApp
from app.shared.schemas.responses import FLFailureBody, FLRefusedPayloadBody

# Every router under its slice's tag, the first segment of each path it serves, so an operation's id
# is `<tag>_<handler>`: a handler's name is unique within its slice. Which key a router takes its
# guard publishes, as the operation's `security`.
ROUTERS: Mapping[str, tuple[APIRouter, ...]] = {
    "address_change": (address_change_public_router, address_change_admin_router, address_change_system_router),
    "action_log": (action_log_admin_router,),
    "grants": (grants_admin_router, grants_system_router),
    "bewerbungen": (bewerbungen_admin_router, bewerbungen_public_router, bewerbungen_person_router, bewerbungen_system_router),
    "einwilligung": (einwilligung_public_router,),
    "identity": (identity_system_router, identity_admin_router, identity_person_router),
    "account": (account_person_router,),
    "outbox": (outbox_system_router,),
    "registrierungen": (
        registrierungen_admin_router,
        registrierungen_public_router,
        registrierungen_person_router,
        registrierungen_person_spieler_router,
        registrierungen_system_router,
    ),
    "saisons": (saisons_public_router, saisons_admin_router),
    "schiedsrichter": (schiedsrichter_admin_router, schiedsrichter_public_router, schiedsrichter_person_router),
    "sperrliste": (sperrliste_admin_router,),
    "spielberichte": (spielberichte_admin_router, spielberichte_person_router),
    "spielbestaetigungen": (
        spielbestaetigungen_public_router,
        spielbestaetigungen_admin_router,
        spielbestaetigungen_person_router,
        spielbestaetigungen_system_router,
    ),
    "spiele": (spiele_public_router, spiele_admin_router),
    "spieler": (spieler_public_router, spieler_admin_router, spieler_person_router, spieler_person_spieler_router),
    "spielorte": (spielorte_admin_router,),
    "spieltage": (spieltage_public_router, spieltage_admin_router),
    "system": (system_router,),
    "teams": (teams_public_router, teams_admin_router, teams_person_router),
}


def operation_id(route: APIRoute) -> str:
    """FastAPI's documented id for a generated client: the route's tag, then its handler's name."""

    return f"{route.tags[0]}_{route.name}"


# A 422 alone carries `fields` (`app/core/exception_handlers.py :: error_response`'s callers), so it
# alone answers with the refused payload's body.
FAILURE_BODIES = {status: FLRefusedPayloadBody if status is HTTPStatus.UNPROCESSABLE_CONTENT else FLFailureBody for status in FAILURE_STATUSES}
# The unavailable database's 503 is the one failure naming when to come back.
RETRY_AFTER_HEADER = {"Retry-After": {"description": "Seconds to wait before asking again", "schema": {"type": "integer"}}}
SCHEMA_REF = "#/components/schemas/{model}"


def failure_response(status: HTTPStatus) -> dict[str, Any]:
    response: dict[str, Any] = {
        "description": status.phrase,
        "content": {"application/json": {"schema": {"$ref": SCHEMA_REF.format(model=FAILURE_BODIES[status].__name__)}}},
    }
    if status is HTTPStatus.SERVICE_UNAVAILABLE:
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


# The exit a settings refusal ends the boot with, the code the frontend's boot refusal and
# `scripts/lib/_lib.sh :: BACKEND_BOOT_CHECK` take, apart from a fault's 1.
BOOT_REFUSED: Final = 3


def create_app(config: BackendConfig | None = None) -> FastAPI:
    """Build the application.

    A FUNCTION, so the composition root is a choice rather than an import side effect. `config` is
    what every request reads (`app/core/config.py :: get_app_config`), the environment's and the
    secret files' where none is passed.
    """
    # Here rather than at module scope, so `app.main` holds no `get_config` for a caller to import;
    # the ruff ban names that path too, since ruff matches the path an import spells.
    from app.core.config import EnvironmentValidationError, get_config  # noqa: TID251

    # Before the settings are read, so their refusal is logged in the right format.
    setup_logging()

    try:
        config = config or get_config()
    except EnvironmentValidationError as refusal:
        # Its message names variables, files and failure types, never a value. An exit rather than
        # the error, whose traceback uvicorn would print as plain text beside the JSON lines.
        fl_logger.critical("system.config_refused", extra={"refusal": str(refusal)})
        raise SystemExit(BOOT_REFUSED) from None

    # FastAPI's `openapi_url=None` serves no document and so no `/docs` or `/redoc` page: the published
    # contract is the committed one `app/openapi_document.py` builds, and no route here answers unguarded but the probe.
    app = TracedApp(lifespan=lifespan, openapi_url=None)
    app.state.config = config

    register_exception_handlers(app)
    mount_api(app)

    return app
