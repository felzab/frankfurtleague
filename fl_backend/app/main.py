"""
APP · the application factory

Builds the FastAPI application: logging, exception handlers, the middlewares, and every router —
`system`, then a read and a write router per resource (ADR-0027). `create_app()` is a function so
the composition root is a choice rather than an import side effect: `app/asgi.py` is the entry
point, tests build their own app, and importing this module needs no environment.

Invariants:
- Middleware runs in reverse registration order — `CorrelationIdMiddleware`, last, runs first.
- `setup_custom_logger` runs before the app is constructed, so a construction failure logs right.
- Every router is registered here — an unmounted router serves nothing and fails silently.

See:
- app/asgi.py — the process entry point
- docs/backend/overview.md
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

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
from app.core.config import BackendConfig, get_config
from app.core.db import lifespan
from app.core.exception_handlers import register_exception_handlers
from app.core.logging import setup_custom_logger
from app.core.middlewares import CorrelationIdMiddleware

# Reads under `verify_access_base`, writes under `verify_access_admin`. Order between the groups is not
# significant: the `objectid` convertor keeps `/spiele/action_required` out of `/spiele/{spiel_id}`
# (ADR-0027).
READ_ROUTERS = (spiele_router, teams_router, spieltage_router, spieler_router, saisons_router, spielorte_router, schiedsrichter_router)
WRITE_ROUTERS = (
    spiele_admin_router,
    teams_admin_router,
    spieltage_admin_router,
    spieler_admin_router,
    saisons_admin_router,
    spielorte_admin_router,
    schiedsrichter_admin_router,
)


def create_app(config: BackendConfig | None = None) -> FastAPI:
    """
    Build the application.

    `config` is injectable so a test can supply its own settings object rather than arranging the
    environment and hoping about import order. Passing one also substitutes it for the request-scoped
    `Depends(get_config)`, so the guards in `core/security.py` and the database name in `core/db.py`
    all agree with what this app was built from.
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
        # Every method the routers actually serve. No impact today -- the only client calls
        # server-side, where CORS does not apply -- but a list that omits a served method is a
        # preflight rejection waiting for the first browser call.
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["*"],
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=config.api_trusted_hosts_list)
    app.add_middleware(CorrelationIdMiddleware)

    app.include_router(system_router)
    for router in (*READ_ROUTERS, *WRITE_ROUTERS):
        app.include_router(router)

    @app.get("/")
    def root():
        """Confirm the service is answering. The versioned API lives under `/api/v{API_VERSION}`; use `/system/is_live` for a probe."""
        return "Hello World"

    # Only when a caller supplied settings: `dependency_overrides` is FastAPI's test seam, so
    # installing it unconditionally would spend it in production replacing `get_config` with itself,
    # and leave a test unable to tell its override from the factory's.
    if injected:
        app.dependency_overrides[get_config] = lambda: config

    return app
