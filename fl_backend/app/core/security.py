import hashlib
import hmac
import secrets
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from http import HTTPStatus
from typing import Annotated, Any, Final, Literal, get_args
from urllib.parse import quote, unquote

from fastapi import Depends, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import SecretStr

from app.core import clock
from app.core.codes import Code
from app.core.config import BackendConfig, get_app_config
from app.core.exceptions import ACTOR_CHALLENGE, APIError
from app.core.recording import PUBLIC_ACTOR, SYSTEM_ACTOR, Actor, PersonActor, actor_var, request_var
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import ADMIN_WINDOW_HOURS, ENROLMENT_WINDOW_MINUTES, PERSON_WINDOW_DAYS, STEP_UP_WINDOW_HOURS
from app.shared.sub_keys import derive_sub_key

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

    The variable the log reads, so a decision and its `aktionen` row cannot name two people.
    """

    actor = actor_var.get()
    # Raised rather than answered with the pseudonym: a person's route has no administrator to
    # store, and a hash written into an address field would read as one.
    if isinstance(actor, PersonActor):
        raise LookupError("a person's route is attributed to no administrator")

    # `bind_actor` fails closed on any write, so the default system actor cannot reach one.
    return actor.email


# The session a request acts for, as the frontend's guard read it. Believed because only the
# frontend's server holds the admin key every route reading them takes, and only the private network
# reaches this service; a base or system route never reads them.
ACTOR_HEADER: Final = "X-FL-Actor"
AUTH_TIME_HEADER: Final = "X-FL-Auth-Time"
AUTH_FACTOR_HEADER: Final = "X-FL-Auth-Factor"

# The two factors the frontend's sessions are made by (`fl_frontend/src/core/auth.ts :: SESSION_FACTOR_BY_PATH`).
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

    The frontend's admin guard asks both (`fl_frontend/src/core/auth.ts :: isAdminSession`); asked here
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


def signed_in_since(auth_time: int, seit: datetime) -> bool:
    """Whether a sign-in at `auth_time` is no older than `seit`, for a grant's date and an owner's alike.

    Judged to the second `auth_time` is floored to, so nothing the frontend's guard admits is refused
    here.
    """

    return auth_time >= int(seit.timestamp())


def get_actor_auth_time(actor: Annotated[SessionActor, Depends(verify_admin_actor)]) -> int:
    """When the acting administrator signed in, which an owner's power is judged against inside the write."""

    return actor.auth_time


ENROLMENT_WINDOW_S: Final = ENROLMENT_WINDOW_MINUTES * 60
STEP_UP_WINDOW_S: Final = STEP_UP_WINDOW_HOURS * 3600


def confirmed_before(actor: SessionActor, window_s: int) -> bool:
    """Whether the actor's sign-in or confirmation is older than `window_s`, which `confirmation_required` refuses a write for."""

    return session_age_s(actor) > window_s


def confirmation_required(window_s: int) -> APIError:
    """`confirmation_required`'s refusal of a write asking a sign-in or confirmation inside `window_s`, every raise of it built here."""

    # RFC 9470 §3's error and parameter, under the actor's own scheme.
    challenge = f'{ACTOR_CHALLENGE} error="insufficient_user_authentication", max_age="{window_s}"'
    return APIError(HTTPStatus.UNAUTHORIZED, Code.CONFIRMATION_REQUIRED, headers={"WWW-Authenticate": challenge})


def verify_recent_confirmation(actor: Annotated[SessionActor, Depends(verify_admin_actor)]) -> None:
    """Refuse a write the page steps up to the enrolment window from an older sign-in or confirmation.

    A write stepped up on some calls alone declares the actor and calls this on exactly those calls.
    """

    if confirmed_before(actor, ENROLMENT_WINDOW_S):
        raise confirmation_required(ENROLMENT_WINDOW_S)


def verify_step_up(actor: Annotated[SessionActor, Depends(verify_admin_actor)]) -> None:
    """Refuse a write stepped up from a sign-in or confirmation older than the step-up window.

    A write stepped up on some calls alone declares the actor and calls this on exactly those calls.
    """

    if confirmed_before(actor, STEP_UP_WINDOW_S):
        raise confirmation_required(STEP_UP_WINDOW_S)


def verify_person_passkey_confirmation(actor: SessionActor) -> None:
    """Refuse a person's write ending or handing over their grant without a fresh passkey, as a revoke does.

    The person's lane admits a sign-in by code, so the handler calls this on exactly the calls it judges to reach a grant.
    """

    if actor.factor != PASSKEY_FACTOR or confirmed_before(actor, ENROLMENT_WINDOW_S):
        raise confirmation_required(ENROLMENT_WINDOW_S)


def verify_recent_person_confirmation(actor: Annotated[SessionActor, Depends(verify_person_actor)]) -> None:
    """Refuse a person's address change from a sign-in or confirmation older than the enrolment window.

    Either factor: a code reaches the address on file, which OWASP asks to confirm before it is replaced.
    """

    if confirmed_before(actor, ENROLMENT_WINDOW_S):
        raise confirmation_required(ENROLMENT_WINDOW_S)


@dataclass(frozen=True)
class Attribution[T]:
    """Who a request's writes are recorded under, and what its binder hands a handler."""

    actor: Actor | PersonActor
    value: T


def actor_binder[T](attribute: Callable[..., Attribution[T] | Awaitable[Attribution[T]]]) -> Callable[..., AsyncIterator[T]]:
    """The one binder: `attribute`'s actor set for the length of the request, beside the route it came through.

    Every method, a read included, at router level, so a later operation cannot miss it.
    """

    async def bind(request: Request, attribution: Annotated[Attribution[Any], Depends(attribute)]) -> AsyncIterator[T]:
        actor_token = actor_var.set(attribution.actor)
        # The route's template, not `request.url.path`: an id baked into the stored path would make one
        # row per document where the page wants one row per kind of action.
        route = request.scope.get("route")
        request_token = request_var.set((request.method, getattr(route, "path", request.url.path)))

        try:
            # Yielded rather than set on a variable: a handler declaring this same binder is answered
            # from this run, and a handler asking for the value cannot run unbound.
            yield attribution.value
        finally:
            # Reset, or the actor bleeds onto whichever request the loop runs next -- the same hazard
            # `TraceContextMiddleware` resets its own ids for.
            actor_var.reset(actor_token)
            request_var.reset(request_token)

    return bind


def attribute_the_administrator(actor: Annotated[SessionActor, Depends(verify_admin_actor)]) -> Attribution[None]:
    # Folded, as the grant check read it: one administrator is one spelling in every stored actor
    # field, whatever case the session's address was typed in.
    return Attribution(Actor(kind="admin_session", email=sign_in_identifier(actor.email)), None)


def _the_public() -> Attribution[None]:
    # No session at all: the headers are never read, so a forged one names nobody.
    return Attribution(PUBLIC_ACTOR, None)


def _the_application() -> Attribution[None]:
    # The sweep holds no session, and an invented address for a machine is what `SYSTEM_ACTOR` exists to avoid.
    return Attribution(SYSTEM_ACTOR, None)


# Module-level objects, as the three key guards are, so a handler declaring its router's binder is
# answered from the run the router started.
bind_actor = actor_binder(attribute_the_administrator)
bind_public_actor = actor_binder(_the_public)
bind_system_actor = actor_binder(_the_application)


# The action log's label under the `sperrliste_schluessel` secret file's key, beside the ban list's
# (`app/api/sperrliste/services.py :: SPERRLISTE_SCHLUESSEL_VERSION`); one label per purpose.
AKTEUR_PSEUDONYM_VERSION: Final = "akteur-v1"


def _keyed_fold(address: str, *, key: SecretStr, label: str) -> str:
    # Folded here rather than by each caller, as `app/api/sperrliste/services.py :: adresse_hash` folds its own: a
    # stored spelling handed in unfolded would hash to a value no other spelling of the mailbox matches.
    return hmac.new(derive_sub_key(key, label), sign_in_identifier(address).encode("utf-8"), hashlib.sha256).hexdigest()


def akteur_pseudonym(identifier: str, *, key: SecretStr) -> str:
    """What the log records for a signed-in person: a keyed hash of the identifier as `sign_in_identifier` folds it.

    Never `adresse_hash`, whose label would make this EQUAL the person's ban-row digest and whose
    address rule raises inside a binder.
    """

    return _keyed_fold(identifier, key=key, label=AKTEUR_PSEUDONYM_VERSION)


# The erasure journal's label, a third beside the ban list's and the log's: under theirs a line would name a ban
# row's digest or, on a choice, its person's log pseudonym, which an erasure's line alone names.
LOESCHUNG_JOURNAL_VERSION: Final = "loeschung-v1"


def loeschung_journal_hash(identifier: str, *, key: SecretStr) -> str:
    """What the erasure journal records for a person: a keyed hash of the identifier as `sign_in_identifier` folds it."""

    return _keyed_fold(identifier, key=key, label=LOESCHUNG_JOURNAL_VERSION)
