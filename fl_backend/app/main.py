from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.routing import APIRoute

from app.api.aktionen.admin_router import router as aktionen_admin_router
from app.api.bewerbungen.admin_router import router as bewerbungen_admin_router
from app.api.bewerbungen.einwilligung_router import router as bewerbungen_einwilligung_router
from app.api.bewerbungen.public_router import router as bewerbungen_public_router
from app.api.bewerbungen.router import router as bewerbungen_router
from app.api.bewerbungen.sweep_router import router as bewerbungen_sweep_router
from app.api.bewerbungen.zustellung_router import router as bewerbungen_zustellung_router
from app.api.kontakte.admin_router import router as kontakte_admin_router
from app.api.saisons.admin_router import router as saisons_admin_router
from app.api.saisons.router import router as saisons_router
from app.api.schiedsrichter.admin_router import router as schiedsrichter_admin_router
from app.api.schiedsrichter.router import router as schiedsrichter_router
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
from app.core.config import API_VERSION, BackendConfig, get_config
from app.core.db import lifespan
from app.core.exception_handlers import register_exception_handlers
from app.core.logging import setup_custom_logger
from app.core.middlewares import TraceContextMiddleware
from app.core.security import verify_access_admin, verify_access_base, verify_access_system

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
)
# Its own group because it belongs to neither: base-tier and mixed read/write, so either tuple's
# comment would go false about the tier or the methods.
PUBLIC_ROUTERS = (bewerbungen_public_router, bewerbungen_einwilligung_router)
# Its own group for the same reason: system-tier writes, made by the application to itself, which
# neither tuple above describes.
SYSTEM_WRITE_ROUTERS = (bewerbungen_sweep_router, bewerbungen_zustellung_router)

# Spelled as `fl_frontend/src/core/api.ts :: FetchOptions` spells its `authType`, the value being
# published so the two can be compared (`docs/backend/spec.md :: I190`).
KEY_TIER_EXTENSION = "x-fl-tier"
KEY_TIERS = {verify_access_base: "base", verify_access_admin: "admin", verify_access_system: "system"}
UNGUARDED_TIER = "none"


def publish_key_tiers(app: FastAPI) -> None:
    for entry in app.routes:
        # `include_router` appends a wrapper holding the original router rather than copying its
        # routes across, so a pass reading `app.routes` for `APIRoute` instances alone sees a
        # handful of routes and none of the API.
        original_router = getattr(entry, "original_router", None)

        for route in original_router.routes if original_router is not None else [entry]:
            if not isinstance(route, APIRoute):
                continue

            # The route object rather than the include context: `add_api_route` copies the router's
            # own dependencies into every route it builds, so both arrive here as one set.
            calls = {guard.call for guard in route.dependant.dependencies if guard.call is not None}
            tiers = sorted(KEY_TIERS[guard] for guard in calls & KEY_TIERS.keys())

            # Joined rather than picked: no single key satisfies two guards, so a value equal to no
            # declared tier fails the comparison rather than naming one of the two as the answer.
            route.openapi_extra = {**(route.openapi_extra or {}), KEY_TIER_EXTENSION: "+".join(tiers) or UNGUARDED_TIER}


def create_app(config: BackendConfig | None = None) -> FastAPI:
    """Build the application.

    A FUNCTION, so the composition root is a choice rather than an import side effect. Passing
    `config` also substitutes it for the request-scoped `Depends(get_config)`.
    """
    injected = config is not None
    config = config or get_config()

    # Before the app exists, so a failure while constructing it is logged in the right format.
    setup_custom_logger(config)

    app = FastAPI(lifespan=lifespan)

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
    for router in (*READ_ROUTERS, *WRITE_ROUTERS, *PUBLIC_ROUTERS, *SYSTEM_WRITE_ROUTERS):
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
    # caches what it builds, so an extension set afterwards never reaches a reader.
    publish_key_tiers(app)

    # Only when a caller supplied settings: installing this unconditionally would leave a test
    # unable to tell its own override from it.
    if injected:
        app.dependency_overrides[get_config] = lambda: config

    return app
