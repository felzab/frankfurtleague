import hashlib
import hmac
import re
import secrets
from collections.abc import AsyncIterator, Callable, Mapping
from typing import Annotated, Final, TypeIs, get_args

from fastapi import Depends, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import SecretStr

from app.core.config import BackendConfig, get_app_config
from app.core.exceptions import ActorForbiddenException, MalformedRequestException, RequestAuthorizationException
from app.core.recording import PUBLIC_ACTOR, SYSTEM_ACTOR, Actor, AktorFunktion, PersonActor, actor_var, request_var
from app.shared.folding import sign_in_identifier
from app.shared.sub_keys import derive_sub_key

# Named once, as `app/core/exceptions.py` names its codes, so a test asserts the core's code rather
# than a copy a rename leaves behind.
MISSING_TOKEN = "REQ-AUTH-001"
WRONG_BASE_KEY = "REQ-AUTH-002"
WRONG_SYSTEM_KEY = "REQ-AUTH-003"
WRONG_ADMIN_KEY = "REQ-AUTH-004"

# `auto_error=False` so a missing header reaches `get_token` and answers `MISSING_TOKEN`; FastAPI's
# own 403 would carry none of the error-code contract.
bearer_scheme = HTTPBearer(auto_error=False)


def get_token(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
) -> str:
    if credentials is None:
        raise RequestAuthorizationException(error_code=MISSING_TOKEN)

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
        config: Annotated[BackendConfig, Depends(get_app_config)],
    ) -> str:
        if not secrets.compare_digest(token, select_key(config).get_secret_value()):
            raise RequestAuthorizationException(error_code=error_code)
        return token

    return dependency


# Module-level objects, so a router declares the same callable every time and a test can compare
# guards by identity (`fl_backend/tests/api/test_admin_guard.py`).
verify_access_base = verify_api_key(lambda config: config.internal_api_key_base, error_code=WRONG_BASE_KEY)
verify_access_system = verify_api_key(lambda config: config.internal_api_key_system, error_code=WRONG_SYSTEM_KEY)
verify_access_admin = verify_api_key(lambda config: config.internal_api_key_admin, error_code=WRONG_ADMIN_KEY)


def get_actor_email() -> str:
    """The administrator this request is attributed to, for a field that STORES who acted.

    The variable the log reads, so a decision and its `aktionen` row cannot name two people.
    """

    actor = actor_var.get()
    # Raised rather than answered with the pseudonym: a person's route has no administrator to
    # store, and a hash written into an address field would read as one.
    if isinstance(actor, PersonActor):
        raise LookupError("a person's route is attributed to no administrator")

    # `bind_actor` fails closed on any write, so the default system actor cannot reach one.
    return actor.email


ACTOR_HEADER = "X-FL-Actor"

MISSING_ACTOR = "REQ-AUTH-005"
ACTOR_NOT_ADMIN = "REQ-AUTH-006"

# Deliberately loose: this is a shape check on a value the frontend composed from its own session,
# not an address validation. The bound is what stops an arbitrarily long header reaching the log.

# C0 is excluded explicitly because `\s` does not cover all of it: 23 controls, NUL among them,
# otherwise reach `aktionen.actor.email` -- the value an erasure is audited against.
WELL_FORMED_ACTOR = re.compile(r"[^@\s\x00-\x1f]+@[^@\s\x00-\x1f]+\.[^@\s\x00-\x1f]+\Z")
ACTOR_MAX_LENGTH = 254

# The methods that record nothing (`app/core/exception_handlers.py` reads them).
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def is_well_formed_actor(header_value: str | None) -> TypeIs[str]:
    """One reading of a malformed header for every dependency here: `verify_actor_is_admin` passes exactly what `bind_actor` refuses."""

    return header_value is not None and len(header_value) <= ACTOR_MAX_LENGTH and WELL_FORMED_ACTOR.fullmatch(header_value) is not None


async def verify_actor_is_admin(request: Request, config: Annotated[BackendConfig, Depends(get_app_config)]) -> None:
    """Refuse an actor an admin-tier route names who is not on the allowlist.

    An absent or malformed header passes here and meets `bind_actor`, declared after it on every
    admin-tier router, which refuses either on every method.
    """

    header_value = request.headers.get(ACTOR_HEADER)
    if not is_well_formed_actor(header_value):
        return

    # Both sides folded, or a mixed-case header locks an administrator out of the panel.
    if sign_in_identifier(header_value) not in config.allowed_admin_emails_list:
        # The address stays out of the message, which reaches the log line.
        raise ActorForbiddenException(error_code=ACTOR_NOT_ADMIN, message=f"the {ACTOR_HEADER} this request names is not an administrator")


async def bind_actor(request: Request) -> AsyncIterator[None]:
    """Attribute this request's writes to their administrator, and refuse a request naming nobody.

    Every method, a read included: the allowlist judges who asks off this header. At router level, so
    a later operation cannot miss it (`docs/backend/spec.md :: I41`).
    """

    header_value = request.headers.get(ACTOR_HEADER)

    if not is_well_formed_actor(header_value):
        raise MalformedRequestException(error_code=MISSING_ACTOR, message=f"an admin-tier request carries no well-formed {ACTOR_HEADER}")

    actor_token = actor_var.set(Actor(kind="admin_session", email=header_value))
    # The route's template, not `request.url.path`: an id baked into the stored path would make one
    # row per document where the page wants one row per kind of action.
    route = request.scope.get("route")
    request_token = request_var.set((request.method, getattr(route, "path", request.url.path)))

    try:
        yield
    finally:
        # Reset, or the actor bleeds onto whichever request the loop runs next -- the same hazard
        # `TraceContextMiddleware` resets its own ids for.
        actor_var.reset(actor_token)
        request_var.reset(request_token)


# The action log's label under `SPERRLISTE_SCHLUESSEL`, beside the ban list's
# (`app/api/sperrliste/services.py :: SPERRLISTE_SCHLUESSEL_VERSION`); one label per purpose.
AKTEUR_PSEUDONYM_VERSION: Final = "akteur-v1"


def akteur_pseudonym(identifier: str, *, schluessel: SecretStr) -> str:
    """What the log records for a signed-in person: a keyed hash of the folded identifier.

    Never `adresse_hash`, whose label would make this EQUAL the person's ban-row digest and whose
    address rule raises inside a binder.
    """

    return hmac.new(derive_sub_key(schluessel, AKTEUR_PSEUDONYM_VERSION), identifier.encode("utf-8"), hashlib.sha256).hexdigest()


def person_actor_binder(funktion: AktorFunktion) -> Callable[..., AsyncIterator[str]]:
    """Build the binder a person's router declares, fixing the Funktion its writes are recorded under.

    Never read off the request: the handler re-derives that the person holds it before writing, so
    the record names what was checked.
    """

    async def bind_person(request: Request, config: Annotated[BackendConfig, Depends(get_app_config)]) -> AsyncIterator[str]:
        """Attribute this request's writes to the signed-in person it names, and yield their folded identifier.

        Refuses on EVERY method, as `bind_actor` does: a person's route serves nothing anonymous.
        """

        header_value = request.headers.get(ACTOR_HEADER)
        if not is_well_formed_actor(header_value):
            raise MalformedRequestException(
                error_code=MISSING_ACTOR, message=f"a request to a person's route carries no well-formed {ACTOR_HEADER}"
            )

        # What the handler authorises against, so one mailbox's two spellings cannot hold two answers.
        identifier = sign_in_identifier(header_value)

        pseudonym = akteur_pseudonym(identifier, schluessel=config.sperrliste_schluessel)
        actor_token = actor_var.set(PersonActor(pseudonym=pseudonym, funktion=funktion))
        # The route's template, as `bind_actor` binds it and for the same reason.
        route = request.scope.get("route")
        request_token = request_var.set((request.method, getattr(route, "path", request.url.path)))

        try:
            # Yielded rather than set on a variable: a handler declaring this same binder is answered
            # from this run, and a handler asking for the identifier cannot run unbound.
            yield identifier
        finally:
            # Reset for `bind_actor`'s reason: the next request on this loop is somebody else's.
            actor_var.reset(actor_token)
            request_var.reset(request_token)

    return bind_person


# Module-level objects, as the three key guards are, so a router declares the same callable every
# time and a test compares binders by identity.
PERSON_ACTOR_BINDERS: Final[Mapping[AktorFunktion, Callable[..., AsyncIterator[str]]]] = {
    funktion: person_actor_binder(funktion) for funktion in get_args(AktorFunktion)
}


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
