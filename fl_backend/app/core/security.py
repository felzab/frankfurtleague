"""
CORE · request authorization

Three shared bearer keys, not user identities: `base` for the read routers, `admin` for every mutation,
`system` for readiness and diagnostics. There are no user sessions here -- the only client is the Next.js
container, which authenticates its own users before ever calling this service.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • Keys are compared with `secrets.compare_digest`, never `==`.
  • Guards are attached at ROUTER level, so a new endpoint inherits its router's protection instead of
    needing its own decorator. Adding an endpoint to a router is therefore safe by default.
  • The expected key is read PER REQUEST, through `Depends(get_config)`, never captured at import. That
    is what lets a test import this module without configuration, and what lets one override the key
    through `app.dependency_overrides` instead of through the environment.
  • `/system/is_live` is deliberately unguarded: it is the container healthcheck, and a healthcheck
    that needs a secret fails for the wrong reasons.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/backend/spec.md -- invariants I7, I8, and the error-code table
"""

import secrets
from typing import Annotated, Callable

from fastapi import Depends, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import SecretStr

from app.core.config import BackendConfig, get_config
from app.core.exceptions import RequestAuthorizationException

# Tell FastAPI to look for the "Authorization" header
bearer_scheme = HTTPBearer(auto_error=False)


def get_token(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
) -> str:
    if credentials is None:
        raise RequestAuthorizationException(error_code="REQ-AUTH-001")

    return credentials.credentials


# Which key a guard checks, as a lookup on the settings rather than the value itself. Taking the
# SecretStr out of the config only inside `dependency` is what keeps it off this module's import path.
KeySelector = Callable[[BackendConfig], SecretStr]


def verify_api_key(select_key: KeySelector, error_code: str) -> Callable:
    """
    Build a guard that compares the bearer token against one configured key.

    The key is selected from the settings PER REQUEST. Capturing its value here instead would read the
    environment at import time, which is what made importing a router require a populated `.env`.
    """

    def dependency(
        token: Annotated[str, Security(get_token)],
        config: Annotated[BackendConfig, Depends(get_config)],
    ) -> str:
        if not secrets.compare_digest(token, select_key(config).get_secret_value()):
            raise RequestAuthorizationException(error_code=error_code)
        return token

    return dependency


# Dependencies used in Routers. Module-level objects, so a router declares the same callable every
# time and a test can compare guards by identity (`tests/api/test_admin_guard.py`).
verify_access_base = verify_api_key(lambda config: config.internal_api_key_base, error_code="REQ-AUTH-002")
verify_access_system = verify_api_key(lambda config: config.internal_api_key_system, error_code="REQ-AUTH-003")
verify_access_admin = verify_api_key(lambda config: config.internal_api_key_admin, error_code="REQ-AUTH-004")
