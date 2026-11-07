import secrets
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import datetime
from http import HTTPStatus
from typing import Annotated, Final, Literal, get_args
from urllib.parse import quote, unquote

from fastapi import Depends, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import SecretStr

from app.core import clock
from app.core.codes import Code
from app.core.config import BackendConfig, get_app_config
from app.core.exceptions import ACTOR_CHALLENGE, APIError
from app.core.recording import actor_var
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import ADMIN_WINDOW_HOURS, PERSON_WINDOW_DAYS

# RFC 9110's 401 carries a challenge naming the scheme the key is presented under.
BEARER_CHALLENGE: Final = {"WWW-Authenticate": "Bearer"}


# A lookup on the settings, not the value: taking the `SecretStr` out only inside `dependency`
# keeps it off this module's import path.
KeySelector = Callable[[BackendConfig], SecretStr]


def verify_api_key(select_key: KeySelector, *, scheme_name: str) -> Callable:
    """Build a guard that compares the bearer token against one configured key.

    The key is selected PER REQUEST: capturing its value here would read the environment at import
    time, the side effect `app/asgi.py` exists to confine.
    """

    # A scheme per tier, so each operation's published `security` names the key it takes.
    # `auto_error=False` so a missing header answers `access_key_refused`, where FastAPI's own 403 carries no code.
    scheme = HTTPBearer(scheme_name=scheme_name, auto_error=False)

    def dependency(
        credentials: Annotated[HTTPAuthorizationCredentials | None, Security(scheme)],
        config: Annotated[BackendConfig, Depends(get_app_config)],
    ) -> str:
        if credentials is None or not secrets.compare_digest(credentials.credentials, select_key(config).get_secret_value()):
            raise APIError(HTTPStatus.UNAUTHORIZED, Code.ACCESS_KEY_REFUSED, headers=BEARER_CHALLENGE)
        return credentials.credentials

    return dependency


# Module-level objects, so every router declares the same callable: FastAPI caches a dependency per
# request by its callable, and runs a guard declared twice once.
verify_access_base = verify_api_key(lambda config: config.internal_api_key_base, scheme_name="BaseKey")
verify_access_system = verify_api_key(lambda config: config.internal_api_key_system, scheme_name="SystemKey")
verify_access_admin = verify_api_key(lambda config: config.internal_api_key_admin, scheme_name="AdminKey")


def get_actor_email() -> str:
    """The administrator this request is attributed to, for a field that STORES who acted.

    The variable the log reads, so a decision and its `action_log` row cannot name two people.
    """

    address = actor_var.get()
    if address is None:
        raise LookupError("a route binding no administrator stores no administrator")

    return address


# The session a request acts for, as the frontend's guard read it. Believed because only the
# frontend's server holds the admin key every route reading them takes, and only the private network
# reaches this service; a base or system route never reads them.
ACTOR_HEADER: Final = "X-FL-Actor"
AUTH_TIME_HEADER: Final = "X-FL-Auth-Time"
AUTH_FACTOR_HEADER: Final = "X-FL-Auth-Factor"

# The two factors the frontend's sessions are made by (`fl_frontend/src/core/auth/library.ts :: SESSION_FACTOR_BY_PATH`).
Factor = Literal["passkey", "code"]
FACTORS: Final[tuple[Factor, ...]] = get_args(Factor)
PASSKEY_FACTOR: Final = "passkey"


# The actor's own scheme on every 401 the session's facts earn, beside the tier key's `Bearer`.
ACTOR_REFUSAL_HEADERS: Final = {"WWW-Authenticate": ACTOR_CHALLENGE}


@dataclass(frozen=True, kw_only=True)
class SessionActor:
    # The sign-in identifier as the header spells it once decoded; every reader folds it before keying on it.
    email: str
    # When the session was made, in whole seconds since the epoch.
    auth_time: int
    factor: Factor


# What ECMAScript's `encodeURIComponent` leaves unescaped beyond the letters, digits and `_.-~` `quote` always keeps.
_URI_COMPONENT_SAFE: Final = "!'()*"


def actor_header_value(email: str) -> str:
    """The address as `X-FL-Actor` carries it: UTF-8, percent-encoded as `encodeURIComponent` spells it.

    A field value is ASCII (RFC 9110 §5.5), and the frontend's fetch takes only a ByteString, so an address beyond
    ASCII travels encoded (`fl_frontend/src/core/api.ts :: sendToBackend`).
    """

    return quote(email, safe=_URI_COMPONENT_SAFE)


def _decoded_actor(value: str) -> str | None:
    """The address `value` encodes, or `None` where it is not the one spelling `actor_header_value` gives that address."""

    email = unquote(value)
    # The round trip refuses every other spelling: a value sent unencoded, which would read `%41` as `A` and name
    # someone else; a malformed or lower-case escape; an escape of no UTF-8, which decodes to U+FFFD; and a byte past
    # ASCII, which Starlette decodes as Latin-1.
    return email if actor_header_value(email) == value else None


def get_session_actor(request: Request) -> SessionActor:
    """The three headers as one session, 400 where any is missing or unreadable: such a request names nobody."""

    email = _decoded_actor(request.headers.get(ACTOR_HEADER, ""))
    auth_time = request.headers.get(AUTH_TIME_HEADER, "")
    factor = request.headers.get(AUTH_FACTOR_HEADER, "")
    # ASCII digits alone: `int` also takes a sign, spaces, underscores and other scripts' digits.
    if not email or not (auth_time.isascii() and auth_time.isdigit()) or factor not in FACTORS:
        raise APIError(HTTPStatus.BAD_REQUEST, Code.MISSING_ACTOR)
    return SessionActor(email=email, auth_time=int(auth_time), factor=factor)


def session_age_s(actor: SessionActor) -> int:
    """How long ago the session was made, to the second `auth_time` is floored to."""

    return int(clock.now().timestamp()) - actor.auth_time


def refused_session() -> APIError:
    return APIError(HTTPStatus.UNAUTHORIZED, Code.SESSION_REFUSED, headers=ACTOR_REFUSAL_HEADERS)


def verify_admin_actor(actor: Annotated[SessionActor, Depends(get_session_actor)]) -> SessionActor:
    """The administrator an admin-tier request is attributed to: a passkey session inside the administrator's window.

    The frontend's admin guard asks both (`fl_frontend/src/core/auth/guards.ts :: isAdminSession`); asked here
    too because person and admin routes take the same key, so a person's session sent to an admin route
    by mistake meets this rather than acting on the grant alone. One dependency `verify_actor_is_admin`
    and `bind_actor` share, so FastAPI reads it once a request.
    """

    if actor.factor != PASSKEY_FACTOR or session_age_s(actor) > ADMIN_WINDOW_HOURS * 3600:
        raise refused_session()
    return actor


def verify_person_actor(actor: Annotated[SessionActor, Depends(get_session_actor)]) -> SessionActor:
    """The signed-in person a person's route is attributed to: either factor, inside the person's own window."""

    if session_age_s(actor) > PERSON_WINDOW_DAYS * 86400:
        raise refused_session()
    return actor


def signed_in_since(auth_time: int, since: datetime) -> bool:
    """Whether a sign-in at `auth_time` is no older than `since`, for a grant's date and an owner's alike.

    Judged to the second `auth_time` is floored to, so nothing the frontend's guard admits is refused
    here.
    """

    return auth_time >= int(since.timestamp())


async def bind_actor(actor: Annotated[SessionActor, Depends(verify_admin_actor)]) -> AsyncIterator[None]:
    """The acting administrator's address set for the length of the request, at router level so a later operation cannot miss it."""

    # Folded, as the grant check read it: one administrator is one spelling in every stored field, whatever case the
    # session's address was typed in.
    token = actor_var.set(sign_in_identifier(actor.email))

    try:
        yield
    finally:
        # Reset, or the address bleeds onto whichever request the loop runs next, the hazard `TraceContextMiddleware`
        # resets its own ids for.
        actor_var.reset(token)


def get_person_identifier(actor: Annotated[SessionActor, Depends(verify_person_actor)]) -> str:
    """The folded address a person's router authorises against, declared for every method at router level."""

    return sign_in_identifier(actor.email)


PersonIdentifier = Annotated[str, Depends(get_person_identifier)]
