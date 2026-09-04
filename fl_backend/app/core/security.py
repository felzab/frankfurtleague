import re
import secrets
from typing import Annotated, AsyncIterator, Callable

from fastapi import Depends, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import SecretStr

from app.core.config import BackendConfig, get_config
from app.core.exceptions import RequestAuthorizationException
from app.core.recording import PUBLIC_ACTOR, SYSTEM_ACTOR, Actor, actor_var, request_var

# `auto_error=False` so a missing header reaches `get_token` and answers `REQ-AUTH-001`; FastAPI's
# own 403 would carry none of the error-code contract.
bearer_scheme = HTTPBearer(auto_error=False)


def get_token(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
) -> str:
    if credentials is None:
        raise RequestAuthorizationException(error_code="REQ-AUTH-001")

    return credentials.credentials


# A lookup on the settings, not the value: taking the `SecretStr` out only inside `dependency`
# keeps it off this module's import path.
KeySelector = Callable[[BackendConfig], SecretStr]


def verify_api_key(select_key: KeySelector, error_code: str) -> Callable:
    """Build a guard that compares the bearer token against one configured key.

    The key is selected PER REQUEST: capturing its value here would read the environment at import
    time, the side effect `app/asgi.py` exists to confine.
    """

    def dependency(
        token: Annotated[str, Security(get_token)],
        config: Annotated[BackendConfig, Depends(get_config)],
    ) -> str:
        if not secrets.compare_digest(token, select_key(config).get_secret_value()):
            raise RequestAuthorizationException(error_code=error_code)
        return token

    return dependency


# Module-level objects, so a router declares the same callable every time and a test can compare
# guards by identity (`fl_backend/tests/api/test_admin_guard.py`).
verify_access_base = verify_api_key(lambda config: config.internal_api_key_base, error_code="REQ-AUTH-002")
verify_access_system = verify_api_key(lambda config: config.internal_api_key_system, error_code="REQ-AUTH-003")
verify_access_admin = verify_api_key(lambda config: config.internal_api_key_admin, error_code="REQ-AUTH-004")


def get_actor_email() -> str:
    """The administrator this request is attributed to, for a field that STORES who acted.

    The variable the log reads, so a decision and its `aktionen` row cannot name two people.
    """

    # `bind_actor` fails closed on any write, so the default system actor cannot reach one.
    return actor_var.get().email


ACTOR_HEADER = "X-FL-Actor"

# Named, not inlined like the codes above it: `docs/logging/error-codes.md` is kept in step by a grep
# for the literal, and the guard below is the one place this code is raised.
MISSING_ACTOR = "REQ-AUTH-005"

# Deliberately loose: this is a shape check on a value the frontend composed from its own session,
# not an address validation. The bound is what stops an arbitrarily long header reaching the log.

# C0 is excluded explicitly because `\s` does not cover all of it: 23 controls, NUL among them,
# otherwise reach `aktionen.actor.email` -- the value an erasure is audited against.
WELL_FORMED_ACTOR = re.compile(r"[^@\s\x00-\x1f]+@[^@\s\x00-\x1f]+\.[^@\s\x00-\x1f]+\Z")
ACTOR_MAX_LENGTH = 254

# The methods that record nothing. Admin routers serve reads as well as writes, so demanding an
# actor of every method would refuse those reads to buy an attribution no row would carry.
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


async def bind_actor(request: Request) -> AsyncIterator[None]:
    """Attribute every write this request makes to the administrator who made it.

    Fail closed on a write, exempt on a read, and declared at router level so a write added later
    cannot miss it (`docs/backend/spec.md :: I41`).
    """

    header_value = request.headers.get(ACTOR_HEADER)

    # Tested inline rather than through a boolean: the narrowing to `str` has to be one the type
    # checker can follow into the `Actor` below.
    if header_value is None or len(header_value) > ACTOR_MAX_LENGTH or WELL_FORMED_ACTOR.fullmatch(header_value) is None:
        if request.method not in SAFE_METHODS:
            raise RequestAuthorizationException(error_code=MISSING_ACTOR)

        yield
        return

    actor_token = actor_var.set(Actor(kind="admin_session", email=header_value))
    # The route's template, not `request.url.path`: an id baked into the stored path would make one
    # row per document where the page wants one row per kind of action.
    route = request.scope.get("route")
    request_token = request_var.set((request.method, getattr(route, "path", request.url.path)))

    try:
        yield
    finally:
        # Reset, or the actor bleeds onto whichever request the loop runs next -- the same hazard
        # `CorrelationIdMiddleware` resets its own id for.
        actor_var.reset(actor_token)
        request_var.reset(request_token)


async def bind_public_actor(request: Request) -> AsyncIterator[None]:
    """Attribute a write nobody signed in for to the public, and name the route it came through.

    Never `bind_actor`: no browser sends `X-FL-Actor`, so it answers `REQ-AUTH-005` for every
    public write. An insert logs no `before`.
    """

    actor_token = actor_var.set(PUBLIC_ACTOR)
    # The route's template, as `bind_actor` binds it and for the same reason.
    route = request.scope.get("route")
    request_token = request_var.set((request.method, getattr(route, "path", request.url.path)))

    try:
        yield
    finally:
        # Reset for `bind_actor`'s reason: the actor would otherwise bleed onto whichever request
        # the loop runs next -- and this one names no administrator at all.
        actor_var.reset(actor_token)
        request_var.reset(request_token)


async def bind_system_actor(request: Request) -> AsyncIterator[None]:
    """Attribute a write the application made to itself, and name the route it came through.

    The sweep holds no session, so `bind_actor` would answer `REQ-AUTH-005`, and an invented
    address for a machine is what `SYSTEM_ACTOR` exists to avoid.
    """

    actor_token = actor_var.set(SYSTEM_ACTOR)
    # The route's template, as `bind_actor` binds it and for the same reason.
    route = request.scope.get("route")
    request_token = request_var.set((request.method, getattr(route, "path", request.url.path)))

    try:
        yield
    finally:
        # Reset for `bind_actor`'s reason: the next request on this loop is somebody's own.
        actor_var.reset(actor_token)
        request_var.reset(request_token)
