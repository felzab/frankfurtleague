"""
TESTS · actor tokens signed as the frontend's server signs them, under a pair made for this run

The pair is generated when the suite imports this module, so no signing key is ever committed, and
`tests/config.py :: build_test_config` configures its public half exactly as a deployment would. What
a token states is read from the table the frontend's suite mints against, never from the verifier's
own constants, so a verifier that stops admitting the frontend's tokens refuses every signed case here.
"""

import json
import secrets
import time
from base64 import urlsafe_b64encode
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any, Final

import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from app.core.actor_token import ActorClaims, Lane, jwk_thumbprint
from app.core.security import ACTOR_HEADER, get_step_up_check

ACTOR_TOKEN_CONTRACT_PATH: Final = Path(__file__).resolve().parent / "shared" / "actor_token_contract.json"
ACTOR_TOKEN_CONTRACT: Final[Mapping[str, Any]] = json.loads(ACTOR_TOKEN_CONTRACT_PATH.read_bytes().decode("utf-8"))


def public_key_of(private_key: Ed25519PrivateKey) -> str:
    """The public half as `ACTOR_TOKEN_PUBLIC_KEY` spells it: RFC 8037's `x`."""

    raw = private_key.public_key().public_bytes(encoding=Encoding.Raw, format=PublicFormat.Raw)
    return urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


SIGNING_KEY = Ed25519PrivateKey.generate()
ACTOR_TOKEN_PUBLIC_KEY = public_key_of(SIGNING_KEY)

# A pair no configuration names: what a token signed by anyone but the frontend is signed under.
FOREIGN_SIGNING_KEY = Ed25519PrivateKey.generate()

# How long before its token a session was made: inside the administrator's window, and not the token's own instant.
SESSION_AGE_S = 60


def actor_claims(email: str, *, lane: Lane = "admin", signed_in_before_s: int = SESSION_AGE_S) -> dict[str, Any]:
    """Every claim the contract requires, as a session of `lane`'s guard would carry them: an administrator's by passkey, a person's by code."""

    now = int(time.time())
    admin_factor = ACTOR_TOKEN_CONTRACT["admin_factor"]
    return {
        "iss": ACTOR_TOKEN_CONTRACT["iss"],
        "aud": ACTOR_TOKEN_CONTRACT["aud"],
        "iat": now,
        "exp": now + ACTOR_TOKEN_CONTRACT["lifetime_s"],
        "jti": secrets.token_urlsafe(16),
        "sub": f"user-{email}",
        "email": email,
        "sid": f"session-{email}",
        "amr": [admin_factor] if lane == "admin" else [next(factor for factor in ACTOR_TOKEN_CONTRACT["factors"] if factor != admin_factor)],
        "auth_time": now - signed_in_before_s,
        "lane": lane,
    }


def protected_header(private_key: Ed25519PrivateKey = SIGNING_KEY) -> dict[str, Any]:
    """`alg` aside, which `jwt.encode` writes from its argument."""

    return {"typ": ACTOR_TOKEN_CONTRACT["typ"], "kid": jwk_thumbprint(public_key_of(private_key))}


def sign(claims: Mapping[str, Any], *, private_key: Ed25519PrivateKey = SIGNING_KEY, header: Mapping[str, Any] | None = None) -> str:
    return jwt.encode(
        dict(claims),
        private_key,
        algorithm=ACTOR_TOKEN_CONTRACT["alg"],
        headers=dict(protected_header(private_key) if header is None else header),
    )


def actor_token(email: str, *, lane: Lane = "admin", signed_in_before_s: int = SESSION_AGE_S) -> str:
    return sign(actor_claims(email, lane=lane, signed_in_before_s=signed_in_before_s))


def verified_actor(email: str, *, signed_in_before_s: int = SESSION_AGE_S) -> ActorClaims:
    """An administrator's claims as the verifier yields them, for a handler called without a request."""

    claims = actor_claims(email, signed_in_before_s=signed_in_before_s)
    return ActorClaims(
        sub=claims["sub"],
        email=email,
        sid=claims["sid"],
        amr=tuple(claims["amr"]),
        auth_time=claims["auth_time"],
        iat=claims["iat"],
        lane="admin",
        jti=claims["jti"],
    )


# What a handler called without a request is handed: confirmed a minute before its token, inside every
# window a write asks for, which is judged against the token's own `iat` and so never lapses.
FRESH_ADMIN_ACTOR = verified_actor("admin@example.com")

# The check a handler stepping up some of its calls is handed, over that actor: it refuses none.
FRESH_STEP_UP_CHECK = get_step_up_check(FRESH_ADMIN_ACTOR)


class SignedActor(Mapping[str, str]):
    """`base` beside an `X-FL-Actor` signed when the header is read.

    A token signed at import expires a minute into a suite whose cases were collected long before they run.
    """

    def __init__(
        self, email: str, base: Mapping[str, str] | None = None, *, lane: Lane = "admin", signed_in_before_s: int = SESSION_AGE_S
    ) -> None:
        self.email = email
        self.base = dict(base or {})
        self.lane: Lane = lane
        self.signed_in_before_s = signed_in_before_s

    def __getitem__(self, name: str) -> str:
        if name != ACTOR_HEADER:
            return self.base[name]
        return actor_token(self.email, lane=self.lane, signed_in_before_s=self.signed_in_before_s)

    def __iter__(self) -> Iterator[str]:
        return iter((*self.base, ACTOR_HEADER))

    def __len__(self) -> int:
        return len(self.base) + 1
