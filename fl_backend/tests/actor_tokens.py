"""
TESTS · the session headers the frontend's server sends beside the admin key

What `app/core/security.py :: get_session_actor` reads, stated as a session of either guard would
state it: an administrator's by passkey, a person's by code.
"""

import time
from collections.abc import Iterator, Mapping
from typing import Final, Literal

from app.core.security import ACTOR_HEADER, AUTH_FACTOR_HEADER, AUTH_TIME_HEADER, PASSKEY_FACTOR, Factor, SessionActor, get_step_up_check

Lane = Literal["admin", "person"]

# How long before the request a session was made: inside every window a write asks for.
SESSION_AGE_S: Final = 60

SESSION_HEADERS: Final = (ACTOR_HEADER, AUTH_TIME_HEADER, AUTH_FACTOR_HEADER)


def factor_of(lane: Lane) -> Factor:
    return PASSKEY_FACTOR if lane == "admin" else "code"


def session_headers(email: str, *, auth_time: int, factor: Factor) -> dict[str, str]:
    return {ACTOR_HEADER: email, AUTH_TIME_HEADER: str(auth_time), AUTH_FACTOR_HEADER: factor}


def actor_headers(email: str, *, lane: Lane = "admin", signed_in_before_s: int = SESSION_AGE_S, factor: Factor | None = None) -> dict[str, str]:
    """The three headers of a session made `signed_in_before_s` ago, by `lane`'s factor unless `factor` names another."""

    return session_headers(email, auth_time=int(time.time()) - signed_in_before_s, factor=factor or factor_of(lane))


def verified_actor(email: str, *, signed_in_before_s: int = SESSION_AGE_S, factor: Factor = PASSKEY_FACTOR) -> SessionActor:
    """An administrator's session as the binder reads it, for a handler called without a request."""

    return SessionActor(email=email, auth_time=int(time.time()) - signed_in_before_s, factor=factor)


# What a handler called without a request is handed. Judged at the clock, so it stays inside the
# enrolment window for the first minutes of a run and inside the step-up window for its first hours.
FRESH_ADMIN_ACTOR = verified_actor("admin@example.com")

# The check a handler stepping up some of its calls is handed, over that actor: it refuses none.
FRESH_STEP_UP_CHECK = get_step_up_check(FRESH_ADMIN_ACTOR)


class SignedActor(Mapping[str, str]):
    """`base` beside the session headers, stamped when they are read.

    Stamped at the read, not at construction: a case collected long before it runs would otherwise
    send a session older than its name says.
    """

    def __init__(
        self,
        email: str,
        base: Mapping[str, str] | None = None,
        *,
        lane: Lane = "admin",
        signed_in_before_s: int = SESSION_AGE_S,
        factor: Factor | None = None,
    ) -> None:
        self.email = email
        self.base = dict(base or {})
        self.lane: Lane = lane
        self.signed_in_before_s = signed_in_before_s
        self.factor: Factor | None = factor

    def __getitem__(self, name: str) -> str:
        if name not in SESSION_HEADERS:
            return self.base[name]
        return actor_headers(self.email, lane=self.lane, signed_in_before_s=self.signed_in_before_s, factor=self.factor)[name]

    def __iter__(self) -> Iterator[str]:
        return iter((*self.base, *SESSION_HEADERS))

    def __len__(self) -> int:
        return len(self.base) + len(SESSION_HEADERS)
