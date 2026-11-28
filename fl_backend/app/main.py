from collections.abc import Mapping
from typing import Any, Final

from fastapi import APIRouter, FastAPI
from fastapi.openapi.utils import get_openapi
from fastapi.routing import APIRoute
from pydantic import TypeAdapter
from pydantic.json_schema import JsonSchemaMode, models_json_schema

from app.api.account.person_router import router as account_person_router
from app.api.action_log.admin_router import router as action_log_admin_router
from app.api.address_change.admin_router import router as address_change_admin_router
from app.api.address_change.public_router import router as address_change_public_router
from app.api.address_change.system_router import router as address_change_system_router
from app.api.aufstellungen.admin_router import router as aufstellungen_admin_router
from app.api.aufstellungen.person_router import router as aufstellungen_person_router
from app.api.ban_list.admin_router import router as ban_list_admin_router
from app.api.bewerbungen.admin_router import router as bewerbungen_admin_router
from app.api.bewerbungen.person_router import router as bewerbungen_person_router
from app.api.bewerbungen.public_router import router as bewerbungen_public_router
from app.api.bewerbungen.system_router import router as bewerbungen_system_router
from app.api.grants.admin_router import router as grants_admin_router
from app.api.grants.system_router import router as grants_system_router
from app.api.identity.admin_router import router as identity_admin_router
from app.api.identity.person_router import router as identity_person_router
from app.api.identity.system_router import router as identity_system_router
from app.api.outbox.services import FLDeliveryDeadlineDays, FLOutboxRetentionDays
from app.api.outbox.system_router import router as outbox_system_router
from app.api.registrierungen.person_router import router as registrierungen_person_router
from app.api.registrierungen.person_router import spieler_router as registrierungen_person_spieler_router
from app.api.registrierungen.public_router import router as registrierungen_public_router
from app.api.registrierungen.system_router import router as registrierungen_system_router
from app.api.saisons.admin_router import router as saisons_admin_router
from app.api.saisons.public_router import router as saisons_public_router
from app.api.saisons.system_router import router as saisons_system_router
from app.api.schiedsrichter.admin_router import router as schiedsrichter_admin_router
from app.api.schiedsrichter.person_router import router as schiedsrichter_person_router
from app.api.schiedsrichter.public_router import router as schiedsrichter_public_router
from app.api.schiedsrichter.system_router import router as schiedsrichter_system_router
from app.api.spielberichte.person_router import router as spielberichte_person_router
from app.api.spielbestaetigungen.admin_router import router as spielbestaetigungen_admin_router
from app.api.spielbestaetigungen.person_router import router as spielbestaetigungen_person_router
from app.api.spielbestaetigungen.system_router import router as spielbestaetigungen_system_router
from app.api.spiele.admin_router import router as spiele_admin_router
from app.api.spieler.admin_router import router as spieler_admin_router
from app.api.spieler.person_router import router as spieler_person_router
from app.api.spieler.person_router import spieler_router as spieler_person_spieler_router
from app.api.spielorte.admin_router import router as spielorte_admin_router
from app.api.spieltage.admin_router import router as spieltage_admin_router
from app.api.system.router import router as system_router
from app.api.teams.admin_router import router as teams_admin_router
from app.api.teams.person_router import router as teams_person_router
from app.core.codes import FieldCode, Rule
from app.core.config import BackendConfig
from app.core.db import lifespan
from app.core.exception_handlers import register_exception_handlers
from app.core.logging import fl_logger
from app.core.middlewares import TracedApp
from app.core.recording import FLActorRole, FLErasedActorMarker
from app.core.security import FLAuthFactor
from app.shared.schemas.bounds import (
    ADDRESS_CHANGE_BOUNDS,
    CONSENT_BOUNDS,
    GRANT_BOUNDS,
    RETENTION_BOUNDS,
    SESSION_BOUNDS,
    FLActionLogPageSize,
    FLAufstellungStartersMax,
    FLBanDurationSaisons,
    FLKontaktEmailMaxLength,
    FLTeamShorthandLength,
)
from app.shared.schemas.responses import FLFailureBody

# Every router under its slice's tag, the first segment of each path it serves, so an operation's id
# is `<tag>_<handler>`: a handler's name is unique within its slice. Which key a router takes its
# guard publishes, as the operation's `security`.
ROUTERS: Mapping[str, tuple[APIRouter, ...]] = {
    "address_change": (address_change_public_router, address_change_admin_router, address_change_system_router),
    "action_log": (action_log_admin_router,),
    "aufstellungen": (aufstellungen_admin_router, aufstellungen_person_router),
    "grants": (grants_admin_router, grants_system_router),
    "bewerbungen": (bewerbungen_admin_router, bewerbungen_public_router, bewerbungen_person_router, bewerbungen_system_router),
    "identity": (identity_system_router, identity_admin_router, identity_person_router),
    "account": (account_person_router,),
    "outbox": (outbox_system_router,),
    "registrierungen": (
        registrierungen_public_router,
        registrierungen_person_router,
        registrierungen_person_spieler_router,
        registrierungen_system_router,
    ),
    # The public and system routers first: the administration's `/{saison_id}` would take their `/frame`, `/landing` and
    # `/sweep` as season ids.
    "saisons": (saisons_public_router, saisons_system_router, saisons_admin_router),
    "schiedsrichter": (schiedsrichter_admin_router, schiedsrichter_public_router, schiedsrichter_person_router, schiedsrichter_system_router),
    "ban_list": (ban_list_admin_router,),
    "spielberichte": (spielberichte_person_router,),
    "spielbestaetigungen": (spielbestaetigungen_admin_router, spielbestaetigungen_person_router, spielbestaetigungen_system_router),
    "spiele": (spiele_admin_router,),
    "spieler": (spieler_admin_router, spieler_person_router, spieler_person_spieler_router),
    "spielorte": (spielorte_admin_router,),
    "spieltage": (spieltage_admin_router,),
    "system": (system_router,),
    "teams": (teams_admin_router, teams_person_router),
}


def operation_id(route: APIRoute) -> str:
    """FastAPI's documented id for a generated client: the route's tag, then its handler's name."""

    return f"{route.tags[0]}_{route.name}"


SCHEMA_REF = "#/components/schemas/{model}"

# The one response every operation's failures share: the body is `FLFailureBody` whatever the status, and its
# `error_code` is `Code`, so the document lists every code once rather than per operation or per status.
FAILURE_RESPONSE: Final = "Failure"
FAILURE_DESCRIPTION: Final = "A refusal or a fault, its status naming which"
# Under `default`, never left out: an operation declaring neither a 422 nor a `default` is published with FastAPI's
# own `HTTPValidationError`, a body this API never sends.
FAILURE_RESPONSES: Final[dict[int | str, dict[str, Any]]] = {
    "default": {"$ref": f"#/components/responses/{FAILURE_RESPONSE}", "description": FAILURE_DESCRIPTION}
}


def with_failure_responses(document: Mapping[str, Any]) -> dict[str, Any]:
    """`document` publishing the shared response every operation's `FAILURE_RESPONSES` refers to, and the bodies it carries.

    FastAPI publishes a model only where an operation names it, and this one is named by reference.
    """

    components = document.get("components", {})
    bodies = models_json_schema([(FLFailureBody, "serialization")], ref_template=SCHEMA_REF)[1]["$defs"]
    # Sorted as FastAPI sorts what it generates, so a rewrite of the committed document moves no schema.
    schemas = dict(sorted({**components.get("schemas", {}), **bodies}.items()))
    failure = {
        "description": FAILURE_DESCRIPTION,
        "content": {"application/json": {"schema": {"$ref": SCHEMA_REF.format(model=FLFailureBody.__name__)}}},
    }

    return {**document, "components": {**components, "schemas": schemas, "responses": {FAILURE_RESPONSE: failure}}}


# Every alias a frontend constant is checked against: a value a page, a mail or a control states, and the domain
# rules' kinds and the field codes, which the catalogue's phrases are keyed by. No model names `Rule` or `FieldCode`: a
# refused field's `kind` is one of Pydantic's own error types as often.
MIRRORED_CONSTANTS: Final = (
    *ADDRESS_CHANGE_BOUNDS,
    *GRANT_BOUNDS,
    *CONSENT_BOUNDS,
    *RETENTION_BOUNDS,
    *SESSION_BOUNDS,
    FLActionLogPageSize,
    FLActorRole,
    FLAufstellungStartersMax,
    FLAuthFactor,
    FLBanDurationSaisons,
    FLDeliveryDeadlineDays,
    FLErasedActorMarker,
    FLKontaktEmailMaxLength,
    FLOutboxRetentionDays,
    FLTeamShorthandLength,
    FieldCode,
    Rule,
)


def with_mirrored_constants(document: Mapping[str, Any]) -> dict[str, Any]:
    """`document` publishing each of `MIRRORED_CONSTANTS` as a schema of its own, which the frontend's constants are checked against.

    No operation names one alone, and Pydantic inlines an alias that a model references only once.
    """

    components = document.get("components", {})
    adapters: list[tuple[str, JsonSchemaMode, TypeAdapter[Any]]] = [
        (alias.__name__, "validation", TypeAdapter(alias)) for alias in MIRRORED_CONSTANTS
    ]
    constants = TypeAdapter.json_schemas(adapters, ref_template=SCHEMA_REF)[1]["$defs"]
    schemas = dict(sorted({**components.get("schemas", {}), **constants}.items()))

    return {**document, "components": {**components, "schemas": schemas}}


# The document's name, which a client generated from it carries in each file's header.
DOCUMENT_TITLE = "Frankfurt League API"


def publish_document(app: FastAPI) -> None:
    """FastAPI's documented override, the shared failure responses added to what it generates and the result stored once."""

    def openapi() -> dict[str, Any]:
        if not app.openapi_schema:
            document = get_openapi(title=DOCUMENT_TITLE, version=app.version, openapi_version=app.openapi_version, routes=app.routes)
            app.openapi_schema = with_mirrored_constants(with_failure_responses(document))

        return app.openapi_schema

    app.openapi = openapi


def mount_api(app: FastAPI) -> None:
    """Every router under `/api`, and the document they publish.

    Apart from `create_app`, since nothing here reads the configuration: the document is built from
    the routes alone, with no settings to supply.
    """

    for tag, routers in ROUTERS.items():
        for router in routers:
            app.include_router(router, prefix="/api", tags=[tag], responses=FAILURE_RESPONSES, generate_unique_id_function=operation_id)

    # After the last route is mounted and before anything asks for the document: `app.openapi()`
    # caches what it builds, so a route mounted afterwards never reaches a reader.
    publish_document(app)


# The exit a settings refusal ends the boot with, raised in place of the refusal, whose traceback uvicorn would print as
# plain text beside the JSON lines. Uvicorn exits 3 for any start that fails, a lifespan's included, so the code says
# only that the boot never served, and the `system.config_refused` line says why. The frontend's boot refusal takes
# the same code.
BOOT_REFUSED: Final = 3


def create_shell() -> FastAPI:
    """The application every route is served inside: the trace layer, the failure handlers and the lifespan, with no route.

    Apart from `create_app`, which mounts the routers into it, so the stack a request passes through
    is assembled in one place.
    """

    # FastAPI's `openapi_url=None` serves no document and so no `/docs` or `/redoc` page: the published
    # contract is the committed one, built from the routes alone, and no route here answers unguarded but the two probes.
    app = TracedApp(lifespan=lifespan, openapi_url=None)
    register_exception_handlers(app)

    return app


def create_app(config: BackendConfig | None = None) -> FastAPI:
    """Build the application.

    A function, so the composition root is a choice rather than an import side effect. `config` is
    what every request reads, the environment's and the secret files' where none is passed. The caller
    sets up logging first, so a refusal of those settings is logged in the service's format.
    """
    # Here rather than at module scope, so `app.main` holds no `get_config` for a caller to import;
    # the ruff ban names that path too, since ruff matches the path an import spells.
    from app.core.config import EnvironmentValidationError, get_config  # noqa: TID251

    try:
        config = config or get_config()
    except EnvironmentValidationError as refusal:
        # Its message names variables, files and failure types, never a value. An exit rather than
        # the error, whose traceback uvicorn would print as plain text beside the JSON lines.
        fl_logger.critical("system.config_refused", extra={"refusal": str(refusal)})
        raise SystemExit(BOOT_REFUSED) from None

    app = create_shell()
    app.state.config = config
    mount_api(app)

    return app
