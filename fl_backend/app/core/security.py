"""
CORE · request authorization

Three shared bearer keys, not user identities: `base` for reads, `admin` for every mutation,
`system` for diagnostics. The only client is the Next.js container, which authenticates its own
users before ever calling this service.

Invariants:
- Keys are compared with `secrets.compare_digest`, never `==`.
- A resource router guards at router level, so its endpoints inherit it (ADR-0027); the system
  router guards per endpoint, and an endpoint added there is public unless it declares otherwise.
- The expected key is read per request through `Depends(get_config)`, never captured at import.
- `/system/is_live` is deliberately unguarded — it is the container healthcheck.

See:
- docs/backend/spec.md — invariants I7, I8, and the error-code table
"""

import secrets
from typing import Annotated, Callable

from fastapi import Depends, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import SecretStr

from app.core.config import BackendConfig, get_config
from app.core.exceptions import RequestAuthorizationException

# `auto_error=False` so a missing header reaches `get_token` and answers `REQ-AUTH-001`; FastAPI's
# own 403 would carry none of the error-code contract.
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

    The key is selected from the settings PER REQUEST. Capturing its value here instead would read
    the environment at import time, which is the side effect `app/asgi.py` exists to confine.
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
