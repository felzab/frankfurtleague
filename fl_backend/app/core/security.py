import hashlib
import hmac
import secrets
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from http import HTTPStatus
from typing import Annotated, Any, Final, Literal, get_args

from bson import ObjectId
from fastapi import Depends, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import SecretStr
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.berechtigungen.crud import anchor_the_actors_grant, live_unbarred_grant_in, live_unbarred_grant_since
from app.api.berechtigungen.services import signed_in_since
from app.api.sperrliste.lookup import BanList, SperrlisteLookup, adressen_gesperrt, get_ban_list
from app.core import clock
from app.core.adressanker import anchor_the_addresses
from app.core.codes import Code  # Session 2: the sweep moves every use onto Code and deletes these aliases.
from app.core.collections import Collection
from app.core.config import BackendConfig, get_app_config
from app.core.crud import a_write_may_stand
from app.core.dependencies import BerechtigungenCollection
from app.core.exceptions import ACTOR_TOKEN_CHALLENGE, APIError
from app.core.recording import PUBLIC_ACTOR, SYSTEM_ACTOR, Actor, AktorFunktion, PersonActor, actor_var, request_var
from app.core.transactions import ActorJudge, actor_judge_var
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import ADMIN_WINDOW_HOURS, ENROLMENT_WINDOW_MINUTES, PERSON_WINDOW_DAYS, STEP_UP_WINDOW_HOURS
from app.shared.sub_keys import derive_sub_key

# Named once, as `app/core/exceptions.py` names its codes, so a test asserts the core's code rather
# than a copy a rename leaves behind.
MISSING_TOKEN = Code.MISSING_TOKEN
WRONG_BASE_KEY = Code.WRONG_BASE_KEY
WRONG_SYSTEM_KEY = Code.WRONG_SYSTEM_KEY
WRONG_ADMIN_KEY = Code.WRONG_ADMIN_KEY

# RFC 9110's 401 carries a challenge naming the scheme the key is presented under.
BEARER_CHALLENGE: Final = {"WWW-Authenticate": "Bearer"}


# A lookup on the settings, not the value: taking the `SecretStr` out only inside `dependency`
# keeps it off this module's import path.
KeySelector = Callable[[BackendConfig], SecretStr]


def verify_api_key(select_key: KeySelector, error_code: Code, *, scheme_name: str) -> Callable:
    """Build a guard that compares the bearer token against one configured key.

    The key is selected PER REQUEST: capturing its value here would read the environment at import
    time, the side effect `app/asgi.py` exists to confine.
    """

    # A scheme per tier, so each operation's published `security` names the key it takes.
    # `auto_error=False` so a missing header answers `MISSING_TOKEN`, where FastAPI's own 403 carries no code.
    scheme = HTTPBearer(scheme_name=scheme_name, auto_error=False)

    def dependency(
        credentials: Annotated[HTTPAuthorizationCredentials | None, Security(scheme)],
        config: Annotated[BackendConfig, Depends(get_app_config)],
    ) -> str:
        if credentials is None:
            raise APIError(HTTPStatus.UNAUTHORIZED, MISSING_TOKEN, headers=BEARER_CHALLENGE)
        if not secrets.compare_digest(credentials.credentials, select_key(config).get_secret_value()):
            raise APIError(HTTPStatus.UNAUTHORIZED, error_code, headers=BEARER_CHALLENGE)
        return credentials.credentials

    return dependency


# Module-level objects, so a router declares the same callable every time and a test can compare
# guards by identity (`fl_backend/tests/api/test_admin_guard.py`).
verify_access_base = verify_api_key(lambda config: config.internal_api_key_base, error_code=WRONG_BASE_KEY, scheme_name="BaseKey")
verify_access_system = verify_api_key(lambda config: config.internal_api_key_system, error_code=WRONG_SYSTEM_KEY, scheme_name="SystemKey")
verify_access_admin = verify_api_key(lambda config: config.internal_api_key_admin, error_code=WRONG_ADMIN_KEY, scheme_name="AdminKey")


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

MISSING_ACTOR = Code.MISSING_ACTOR
ACTOR_NOT_ADMIN = Code.ACTOR_NOT_ADMIN
ACTOR_TOKEN_REFUSED = Code.ACTOR_TOKEN_REFUSED
PERSON_BARRED = Code.PERSON_BARRED
CONFIRMATION_REQUIRED = Code.CONFIRMATION_REQUIRED

# The actor's own scheme on every 401 the session's facts earn, beside the tier key's `Bearer`.
ACTOR_REFUSAL_HEADERS: Final = {"WWW-Authenticate": ACTOR_TOKEN_CHALLENGE}


@dataclass(frozen=True, kw_only=True)
class SessionActor:
    # The sign-in identifier as the header spells it; every reader folds it before keying on it.
    email: str
    # When the session was made, in whole seconds since the epoch.
    auth_time: int
    factor: Factor


def get_session_actor(request: Request) -> SessionActor:
    """The three headers as one session, 400 where any is missing or unreadable: such a request names nobody."""

    email = request.headers.get(ACTOR_HEADER, "")
    auth_time = request.headers.get(AUTH_TIME_HEADER, "")
    factor = request.headers.get(AUTH_FACTOR_HEADER, "")
    # ASCII digits alone: `int` also takes a sign, spaces, underscores and other scripts' digits.
    if email == "" or not (auth_time.isascii() and auth_time.isdigit()) or factor not in FACTORS:
        raise APIError(HTTPStatus.BAD_REQUEST, MISSING_ACTOR)
    return SessionActor(email=email, auth_time=int(auth_time), factor=factor)


def session_age_s(actor: SessionActor) -> int:
    """How long ago the session was made, to the second `auth_time` is floored to."""

    return int(clock.now().timestamp()) - actor.auth_time


def refused_session() -> APIError:
    return APIError(HTTPStatus.UNAUTHORIZED, ACTOR_TOKEN_REFUSED, headers=ACTOR_REFUSAL_HEADERS)


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


# When the live grant a folded identifier holds took effect, `None` for none: the one question the actor check asks.
GrantLookup = Callable[[str], Awaitable[datetime | None]]


def get_grant_lookup(berechtigungen_collection: BerechtigungenCollection, sperrliste: SperrlisteLookup) -> GrantLookup:
    """The actor check's read: a live grant, and no ban on its address."""

    async def grant_since(identifier: str) -> datetime | None:
        return await live_unbarred_grant_since(identifier, berechtigungen_collection=berechtigungen_collection, sperrliste=sperrliste)

    return grant_since


async def verify_actor_is_admin(
    # First, so a request naming nobody is refused before the grant read opens the database.
    actor: Annotated[SessionActor, Depends(verify_admin_actor)],
    grant_since: Annotated[GrantLookup, Depends(get_grant_lookup)],
) -> None:
    """Refuse an actor who holds no live grant, read per request, or signed in before it."""

    # Folded, as every grant is stored, or a mixed-case identifier locks an administrator out of the
    # panel. Either tier admits: `owner` holds every power `administration` does.
    seit = await grant_since(sign_in_identifier(actor.email))
    if seit is None:
        raise APIError(HTTPStatus.FORBIDDEN, ACTOR_NOT_ADMIN)

    if not signed_in_since(actor.auth_time, seit):
        raise refused_session()


def _lists_on(session: AsyncClientSession, config: BackendConfig) -> tuple[AsyncCollection, BanList]:
    """The grants and the ban list on the transaction's own client.

    Not the request's collection dependencies: resolved at binding, they would open the database
    ahead of every refusal a request meets before its handler.
    """

    database = session.client[config.db_base_name]

    return database[Collection.BERECHTIGUNGEN], get_ban_list(database[Collection.SPERRLISTE], database[Collection.SAISONS], config)


def admin_judge(actor: SessionActor, config: BackendConfig) -> ActorJudge:
    """The actor check asked again in each attempt of every transaction the request opens."""

    @asynccontextmanager
    async def judging_the_administrator(session: AsyncClientSession) -> AsyncIterator[None]:
        berechtigungen_collection, sperrliste = _lists_on(session, config)
        # The row answering, for the anchor: one at most, the actor's own.
        answering: list[ObjectId] = []

        async def grant_since(identifier: str) -> datetime | None:
            grant = await live_unbarred_grant_in(
                identifier, berechtigungen_collection=berechtigungen_collection, sperrliste=sperrliste, session=session
            )
            if grant is None:
                return None

            answering.append(grant[0])
            return grant[1]

        # The very check the request passed before its handler, over this attempt's reads, so it
        # refuses under the codes every admin-tier operation already publishes.
        await verify_actor_is_admin(actor, grant_since)

        yield

        # Nothing sent by this request is an attempt that wrote nothing, which takes part in no write
        # skew: its answer holds as of its snapshot, so a no-op logs no anchor.
        if not a_write_may_stand():
            return

        # Last rather than first: written early, this row would stall every rival writing it -- a revoke,
        # any judgement of the whole list -- until this attempt ends; written last, a rival committing
        # meanwhile makes this attempt retry instead.
        await anchor_the_actors_grant(berechtigungen_collection=berechtigungen_collection, berechtigung_id=answering[0], session=session)

    return judging_the_administrator


def get_actor_auth_time(actor: Annotated[SessionActor, Depends(verify_admin_actor)]) -> int:
    """When the acting administrator signed in, which an owner's power is judged against inside the write."""

    return actor.auth_time


ENROLMENT_WINDOW_S: Final = ENROLMENT_WINDOW_MINUTES * 60
STEP_UP_WINDOW_S: Final = STEP_UP_WINDOW_HOURS * 3600


def confirmed_before(actor: SessionActor, window_s: int) -> bool:
    """Whether the actor's sign-in or confirmation is older than `window_s`, which `REQ-AUTH-009` refuses a write for."""

    return session_age_s(actor) > window_s


def confirmation_required(window_s: int) -> APIError:
    """`REQ-AUTH-009`'s refusal of a write asking a sign-in or confirmation inside `window_s`, every raise of it built here."""

    # RFC 9470 §3's error and parameter, under the actor's own scheme.
    challenge = f'{ACTOR_TOKEN_CHALLENGE} error="insufficient_user_authentication", max_age="{window_s}"'
    return APIError(HTTPStatus.UNAUTHORIZED, CONFIRMATION_REQUIRED, headers={"WWW-Authenticate": challenge})


def verify_recent_confirmation(actor: Annotated[SessionActor, Depends(verify_admin_actor)]) -> None:
    """Refuse a write the page steps up to the enrolment window from an older sign-in or confirmation."""

    if confirmed_before(actor, ENROLMENT_WINDOW_S):
        raise confirmation_required(ENROLMENT_WINDOW_S)


def get_recent_confirmation_check(actor: Annotated[SessionActor, Depends(verify_admin_actor)]) -> Callable[[], None]:
    """`verify_recent_confirmation`'s window on the calls a handler judges to end a grant."""

    def refuse_unconfirmed() -> None:
        if confirmed_before(actor, ENROLMENT_WINDOW_S):
            raise confirmation_required(ENROLMENT_WINDOW_S)

    return refuse_unconfirmed


def verify_step_up(actor: Annotated[SessionActor, Depends(verify_admin_actor)]) -> None:
    """Refuse a write stepped up on every call from a sign-in or confirmation older than the step-up window.

    One stepped up on some calls takes `get_step_up_check` instead, and its handler judges the call.
    """

    if confirmed_before(actor, STEP_UP_WINDOW_S):
        raise confirmation_required(STEP_UP_WINDOW_S)


# Called by a handler on exactly the calls it judges a step-up write, it refuses one from a sign-in or
# confirmation older than the step-up window.
StepUpCheck = Callable[[], None]


def get_step_up_check(actor: Annotated[SessionActor, Depends(verify_admin_actor)]) -> StepUpCheck:
    """The step-up of a write stepped up on some calls alone."""

    def refuse_unconfirmed() -> None:
        if confirmed_before(actor, STEP_UP_WINDOW_S):
            raise confirmation_required(STEP_UP_WINDOW_S)

    return refuse_unconfirmed


def get_person_confirmation_check(actor: Annotated[SessionActor, Depends(verify_person_actor)]) -> StepUpCheck:
    """A grant holder's own erasure asks a fresh passkey, as a revoke does: the person's lane admits a sign-in by code."""

    def refuse_unconfirmed() -> None:
        if actor.factor != PASSKEY_FACTOR or confirmed_before(actor, ENROLMENT_WINDOW_S):
            raise confirmation_required(ENROLMENT_WINDOW_S)

    return refuse_unconfirmed


def verify_recent_person_confirmation(actor: Annotated[SessionActor, Depends(verify_person_actor)]) -> None:
    """Refuse a person's address change from a sign-in or confirmation older than the enrolment window.

    Either factor: a code reaches the address on file, which OWASP asks to confirm before it is replaced.
    """

    if confirmed_before(actor, ENROLMENT_WINDOW_S):
        raise confirmation_required(ENROLMENT_WINDOW_S)


# Whether a folded identifier is on the ban list: what a person's route asks beside the session.
BanLookup = Callable[[str], Awaitable[bool]]


def get_ban_lookup(sperrliste: SperrlisteLookup) -> BanLookup:
    """The person check's read, keyed as the grant check keys its own ban read."""

    async def is_gesperrt(identifier: str) -> bool:
        return bool(await adressen_gesperrt(sperrliste, [identifier]))

    return is_gesperrt


async def verify_person_is_unbarred(
    # First, so a request naming nobody is refused before the ban read opens the database.
    actor: Annotated[SessionActor, Depends(verify_person_actor)],
    is_gesperrt: Annotated[BanLookup, Depends(get_ban_lookup)],
) -> SessionActor:
    """Refuse a person the ban list holds, read per request: the frontend's guard misses a ban entered since."""

    if await is_gesperrt(sign_in_identifier(actor.email)):
        raise APIError(HTTPStatus.FORBIDDEN, PERSON_BARRED)

    return actor


def person_judge(actor: SessionActor, config: BackendConfig) -> ActorJudge:
    """The ban check asked again in each attempt of every transaction a person's request opens."""

    @asynccontextmanager
    async def judging_the_person(session: AsyncClientSession) -> AsyncIterator[None]:
        _, sperrliste = _lists_on(session, config)

        async def is_gesperrt(identifier: str) -> bool:
            return bool(await adressen_gesperrt(sperrliste, [identifier], session=session))

        # The binder's own check over this attempt's read, as the administrator's judge asks its own.
        await verify_person_is_unbarred(actor, is_gesperrt)

        yield

        # Last, and only where a write may stand, for the administrator's judge's reasons. The write may hold
        # the person's address or pseudonym on a record their erasure, running now, never read.
        if not a_write_may_stand():
            return

        # On the transaction's own client, for `_lists_on`'s reason.
        await anchor_the_addresses(
            [actor.email],
            adressanker_collection=session.client[config.db_base_name][Collection.ADRESSANKER],
            schluessel=config.sperrliste_schluessel,
            session=session,
        )

    return judging_the_person


@dataclass(frozen=True)
class Attribution[T]:
    """Who a request's writes are recorded under, the judge its transactions ask, and what its binder hands a handler."""

    actor: Actor | PersonActor
    judge: ActorJudge | None
    value: T


def actor_binder[T](attribute: Callable[..., Attribution[T] | Awaitable[Attribution[T]]]) -> Callable[..., AsyncIterator[T]]:
    """The one binder: `attribute`'s actor and judge set for the length of the request, beside the route it came through.

    Every method, a read included, at router level, so a later operation cannot miss it.
    """

    async def bind(request: Request, attribution: Annotated[Attribution[Any], Depends(attribute)]) -> AsyncIterator[T]:
        actor_token = actor_var.set(attribution.actor)
        # Beside the actor, so no transaction this request opens runs unjudged.
        judge_token = actor_judge_var.set(attribution.judge)
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
            actor_judge_var.reset(judge_token)
            request_var.reset(request_token)

    return bind


def attribute_the_administrator(
    actor: Annotated[SessionActor, Depends(verify_admin_actor)], config: Annotated[BackendConfig, Depends(get_app_config)]
) -> Attribution[None]:
    # Folded, as the grant check read it: one administrator is one spelling in every stored actor
    # field, whatever case the session's address was typed in.
    return Attribution(Actor(kind="admin_session", email=sign_in_identifier(actor.email)), admin_judge(actor, config), None)


def _the_public() -> Attribution[None]:
    # No session at all: the headers are never read, so a forged one names nobody.
    return Attribution(PUBLIC_ACTOR, None, None)


def _the_application() -> Attribution[None]:
    # The sweep holds no session, and an invented address for a machine is what `SYSTEM_ACTOR` exists to avoid.
    return Attribution(SYSTEM_ACTOR, None, None)


# Module-level objects, as the three key guards are, so a router declares the same callable every
# time and a test compares binders by identity.
bind_actor = actor_binder(attribute_the_administrator)
bind_public_actor = actor_binder(_the_public)
bind_system_actor = actor_binder(_the_application)


# The action log's label under the `sperrliste_schluessel` secret file's key, beside the ban list's
# (`app/api/sperrliste/services.py :: SPERRLISTE_SCHLUESSEL_VERSION`); one label per purpose.
AKTEUR_PSEUDONYM_VERSION: Final = "akteur-v1"


def _keyed_fold(address: str, *, schluessel: SecretStr, label: str) -> str:
    # Folded here rather than by each caller, as `app/api/sperrliste/services.py :: adresse_hash` folds its own: a
    # stored spelling handed in unfolded would hash to a value no other spelling of the mailbox matches.
    return hmac.new(derive_sub_key(schluessel, label), sign_in_identifier(address).encode("utf-8"), hashlib.sha256).hexdigest()


def akteur_pseudonym(identifier: str, *, schluessel: SecretStr) -> str:
    """What the log records for a signed-in person: a keyed hash of the identifier as `sign_in_identifier` folds it.

    Never `adresse_hash`, whose label would make this EQUAL the person's ban-row digest and whose
    address rule raises inside a binder.
    """

    return _keyed_fold(identifier, schluessel=schluessel, label=AKTEUR_PSEUDONYM_VERSION)


# The erasure journal's label, a third beside the ban list's and the log's: under theirs a line would name a ban
# row's digest or, on a choice, its person's log pseudonym, which an erasure's line alone names.
LOESCHUNG_JOURNAL_VERSION: Final = "loeschung-v1"


def loeschung_journal_hash(identifier: str, *, schluessel: SecretStr) -> str:
    """What the erasure journal records for a person: a keyed hash of the identifier as `sign_in_identifier` folds it."""

    return _keyed_fold(identifier, schluessel=schluessel, label=LOESCHUNG_JOURNAL_VERSION)


def person_actor_binder(funktion: AktorFunktion) -> Callable[..., AsyncIterator[str]]:
    """The binder a person's router declares, fixing the Funktion its writes are recorded under and yielding the folded identifier.

    The Funktion is never read off the request: the handler re-derives that the person holds it before
    writing, so the record names what was checked.
    """

    def the_person(
        # The ban check rides the binder, so a router declaring it cannot serve a barred person.
        actor: Annotated[SessionActor, Depends(verify_person_is_unbarred)],
        config: Annotated[BackendConfig, Depends(get_app_config)],
    ) -> Attribution[str]:
        # What the handler authorises against, so one mailbox's two spellings cannot hold two answers.
        identifier = sign_in_identifier(actor.email)
        pseudonym = akteur_pseudonym(identifier, schluessel=config.sperrliste_schluessel)

        return Attribution(PersonActor(pseudonym=pseudonym, funktion=funktion), person_judge(actor, config), identifier)

    return actor_binder(the_person)


PERSON_ACTOR_BINDERS: Final[Mapping[AktorFunktion, Callable[..., AsyncIterator[str]]]] = {
    funktion: person_actor_binder(funktion) for funktion in get_args(AktorFunktion)
}

# A handler's folded address, from the binder its router declares, which FastAPI then runs once a
# request; another Funktion's alias runs a second binder, recording the writes under that Funktion.
KontaktIdentifier = Annotated[str, Depends(PERSON_ACTOR_BINDERS["kontakt"])]
SpielerIdentifier = Annotated[str, Depends(PERSON_ACTOR_BINDERS["spieler"])]
SchiedsrichterIdentifier = Annotated[str, Depends(PERSON_ACTOR_BINDERS["schiedsrichter"])]
